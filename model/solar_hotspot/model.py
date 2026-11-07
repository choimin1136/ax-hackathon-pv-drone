from contextlib import nullcontext

import torch
from torch import nn
import torch.nn.functional as F
from transformers import SegformerConfig, SegformerForSemanticSegmentation

from .config import ModelConfig
from .losses import segmentation_loss
from .metadata import FIELD_GROUPS
from .views import make_specs, pooled_view_features, prepare_view, probability_summary, restore_view


class SegFormerFeatures(nn.Module):
    """Explicit decoder features; no mutable forward hooks or ground-truth pooling."""
    def __init__(self, config, pretrained=None):
        super().__init__()
        if config.backbone == "tiny":
            hidden, depths, heads, sr = [8, 16, 32, 64], [1] * 4, [1, 2, 4, 8], [8, 4, 2, 1]
        elif config.backbone == "b0":
            hidden, depths, heads, sr = [32, 64, 160, 256], [2] * 4, [1, 2, 5, 8], [8, 4, 2, 1]
        else:
            hidden, depths, heads, sr = [64, 128, 320, 512], [2] * 4, [1, 2, 5, 8], [8, 4, 2, 1]
        hf_config = SegformerConfig(hidden_sizes=hidden, depths=depths, num_attention_heads=heads,
                                    sr_ratios=sr, decoder_hidden_size=config.decoder_dim,
                                    num_labels=2, reshape_last_stage=True,
                                    id2label={0: "background", 1: "hotspot"},
                                    label2id={"background": 0, "hotspot": 1})
        if pretrained:
            source_config = SegformerConfig.from_pretrained(pretrained)
            if list(source_config.hidden_sizes) != hidden:
                raise ValueError("Pretrained checkpoint backbone does not match --backbone")
            self.net = SegformerForSemanticSegmentation.from_pretrained(
                pretrained, config=hf_config, ignore_mismatched_sizes=True)
        else:
            self.net = SegformerForSemanticSegmentation(hf_config)

    def forward(self, pixels):
        states = self.net.segformer(pixels, output_hidden_states=True, return_dict=True).hidden_states
        head = self.net.decode_head
        projected = []
        projections = head.linear_projections if hasattr(head, "linear_projections") else head.linear_c
        for state, projection in zip(states, projections):
            b, _, h, w = state.shape
            f = projection(state).permute(0, 2, 1).reshape(b, -1, h, w)
            projected.append(F.interpolate(f, states[0].shape[-2:], mode="bilinear", align_corners=False))
        features = head.activation(head.batch_norm(head.linear_fuse(torch.cat(projected[::-1], dim=1))))
        logits = head.classifier(head.dropout(features))
        return features, logits


class ImageClassifier(nn.Module):
    def __init__(self, feature_dim, embedding_dim=128):
        super().__init__()
        self.project = nn.Sequential(nn.Linear(feature_dim, embedding_dim), nn.LayerNorm(embedding_dim),
                                     nn.GELU(), nn.Dropout(.1))
        self.head = nn.Sequential(nn.Linear(embedding_dim, 64), nn.GELU(), nn.Linear(64, 1))

    def forward(self, features):
        v = self.project(features)
        return v, self.head(v)


class ResidualFusion(nn.Module):
    def __init__(self, config):
        super().__init__()
        m = config.metadata_embedding_dim
        self.metadata_encoder = nn.Sequential(nn.Linear(2 * config.metadata_dim, m), nn.LayerNorm(m),
                                              nn.GELU(), nn.Linear(m, m), nn.GELU())
        n = config.image_dim + m + 1
        self.delta_head = nn.Sequential(nn.Linear(n, 64), nn.GELU(), nn.Dropout(.1), nn.Linear(64, 1))
        self.gate_head = nn.Sequential(nn.Linear(n, 32), nn.GELU(), nn.Linear(32, 1))
        self.delta_max = config.delta_max
        nn.init.zeros_(self.delta_head[-1].weight)
        nn.init.zeros_(self.delta_head[-1].bias)

    def forward(self, v, image_logit, values, observed):
        observed = observed.bool() & torch.isfinite(values)
        clean = torch.where(observed, values, torch.zeros_like(values))
        e = self.metadata_encoder(torch.cat([clean, observed.to(values.dtype)], dim=1))
        c = torch.cat([v, e, image_logit], dim=1)
        delta = self.delta_max * torch.tanh(self.delta_head(c))
        available = observed.any(1, keepdim=True)
        gate = torch.sigmoid(self.gate_head(c)) * available
        applied = gate * delta
        return {"final_logit": image_logit + applied, "delta": delta, "gate": gate,
                "applied_delta": applied, "metadata_available": available}


class HotspotModel(nn.Module):
    def __init__(self, config=None, pretrained=None):
        super().__init__()
        self.config = config or ModelConfig()
        self.segmenter = SegFormerFeatures(self.config, pretrained)
        self.classifier = ImageClassifier(4 * self.config.decoder_dim + 8, self.config.image_dim)
        self.fusion = ResidualFusion(self.config)
        self.stage = "joint"
        self.fusion_enabled = True

    def set_stage(self, stage):
        if stage not in {"seg", "image", "fusion", "joint"}:
            raise ValueError(stage)
        self.stage = stage
        self.fusion_enabled = stage in {"fusion", "joint"}
        for p in self.parameters():
            p.requires_grad_(False)
        modules = {"seg": [self.segmenter], "image": [self.classifier], "fusion": [self.fusion],
                   "joint": [self.segmenter.net.decode_head, self.classifier, self.fusion]}[stage]
        for module in modules:
            for p in module.parameters():
                p.requires_grad_(True)
        if stage == "joint":
            # Only last encoder stage is unfrozen; earlier stages remain fixed.
            base = self.segmenter.net.segformer
            if hasattr(base, "stages"):
                modules = [base.stages[-1]]
            else:
                encoder = base.encoder
                modules = (encoder.patch_embeddings[-1], encoder.block[-1], encoder.layer_norm[-1])
            for module in modules:
                for p in module.parameters():
                    p.requires_grad_(True)
        self.train(self.training)

    def train(self, mode=True):
        super().train(mode)
        if mode:
            if self.stage in {"image", "fusion"}:
                self.segmenter.eval()  # Freeze BN, dropout and drop-path too.
            if self.stage == "fusion":
                self.classifier.eval()
            if self.stage == "joint":
                self.segmenter.net.segformer.eval()
        return self

    @staticmethod
    def drop_metadata_groups(observed, probability):
        result = observed.clone()
        for indices in FIELD_GROUPS:
            keep = torch.rand(result.shape[0], 1, device=result.device) >= probability
            result[:, list(indices)] *= keep
        return result

    def forward(self, images, metadata=None, observed=None, labels=None,
                metadata_dropout=0., compute_seg_loss=True):
        b, _, h, w = images.shape
        if metadata is None:
            metadata = images.new_zeros((b, self.config.metadata_dim))
        if observed is None:
            observed = torch.zeros_like(metadata)
        if not self.fusion_enabled:
            observed = torch.zeros_like(observed)
        if self.training and metadata_dropout:
            observed = self.drop_metadata_groups(observed, metadata_dropout)
        specs = make_specs(h, w, self.config.view_size, self.config.tile_size, self.config.tiles)
        embeddings, numerator, denominator, seg_losses = [], None, None, []
        frozen_segmenter = not any(p.requires_grad for p in self.segmenter.parameters())
        for start in range(0, len(specs), self.config.view_chunk_size):
            chunk = specs[start:start + self.config.view_chunk_size]
            prepared = [prepare_view(images, labels, s, self.config.view_size) for s in chunk]
            pixels = torch.cat([p[0] for p in prepared])
            context = torch.no_grad() if frozen_segmenter else nullcontext()
            with context:
                features, low_logits = self.segmenter(pixels)
                logits = F.interpolate(low_logits, (self.config.view_size,) * 2,
                                       mode="bilinear", align_corners=False)
                probabilities = logits.float().softmax(1)[:, 1:2]
                if labels is not None and compute_seg_loss:
                    targets = torch.cat([p[2] for p in prepared])
                    seg_losses.append((len(chunk), segmentation_loss(logits, targets)))
            for i, (spec, (_, valid, _)) in enumerate(zip(chunk, prepared)):
                f, p = features[i * b:(i + 1) * b], probabilities[i * b:(i + 1) * b]
                embeddings.append(pooled_view_features(f, p, valid))
                num, den = restore_view(p, spec, (h, w))
                numerator = num if numerator is None else numerator + num
                denominator = den if denominator is None else denominator + den
        probability = numerator / denominator.clamp_min(1e-6)
        stacked = torch.stack(embeddings, dim=1)
        combined = torch.cat([stacked.mean(1), stacked.max(1).values, probability_summary(probability)], dim=1)
        if self.stage == "fusion" and not any(p.requires_grad for p in self.classifier.parameters()):
            with torch.no_grad():
                v, image_logit = self.classifier(combined)
        else:
            v, image_logit = self.classifier(combined)
        result = self.fusion(v, image_logit, metadata, observed)
        result.update({"image_logit": image_logit, "probability_map": probability,
                       "image_embedding": v, "image_features": combined,
                       "segmentation_loss": sum(n * loss for n, loss in seg_losses) / len(specs)
                       if seg_losses else images.new_zeros(())})
        return result
