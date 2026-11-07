"""Differentiable multiview preparation and original-coordinate probability merging."""
from dataclasses import dataclass

import torch
import torch.nn.functional as F


@dataclass(frozen=True)
class ViewSpec:
    x: int
    y: int
    width: int
    height: int
    resized_width: int
    resized_height: int
    left: int
    top: int


def make_specs(height, width, size, tile_size, tiles=True):
    scale = min(size / width, size / height)
    rw, rh = max(1, round(width * scale)), max(1, round(height * scale))
    specs = [ViewSpec(0, 0, width, height, rw, rh, (size - rw) // 2, (size - rh) // 2)]
    if tiles:
        tw, th = min(tile_size, width), min(tile_size, height)
        xs = sorted({0, (width - tw) // 2, width - tw})
        ys = sorted({0, height - th})
        for y in ys:
            for x in xs:
                scale = min(size / tw, size / th)
                rw, rh = max(1, round(tw * scale)), max(1, round(th * scale))
                specs.append(ViewSpec(x, y, tw, th, rw, rh, (size - rw) // 2, (size - rh) // 2))
    return specs


def prepare_view(images, labels, spec, size):
    crop = images[:, :, spec.y:spec.y + spec.height, spec.x:spec.x + spec.width]
    resized = F.interpolate(crop, (spec.resized_height, spec.resized_width), mode="bilinear", align_corners=False)
    pad = (spec.left, size - spec.resized_width - spec.left,
           spec.top, size - spec.resized_height - spec.top)
    # Padding in normalized space is zero; do not introduce false black borders.
    mean = images.new_tensor([.485, .456, .406]).view(1, 3, 1, 1)
    std = images.new_tensor([.229, .224, .225]).view(1, 3, 1, 1)
    pixels = F.pad((resized - mean) / std, pad)
    valid = F.pad(torch.ones_like(resized[:, :1]), pad)
    target = None
    if labels is not None:
        crop_y = labels[:, None, spec.y:spec.y + spec.height, spec.x:spec.x + spec.width].float()
        target = F.pad(F.interpolate(crop_y, (spec.resized_height, spec.resized_width), mode="nearest"), pad, value=255)
        target = target[:, 0].long()
    return pixels, valid, target


def restore_view(probability, spec, original_shape):
    """Return weighted sum/weight, with nonzero weight at original frame boundaries."""
    h, w = original_shape
    p = probability[:, :, spec.top:spec.top + spec.resized_height, spec.left:spec.left + spec.resized_width]
    p = F.interpolate(p, (spec.height, spec.width), mode="bilinear", align_corners=False)
    wy = torch.hann_window(spec.height, periodic=False, device=p.device, dtype=p.dtype).clamp_min(.1)
    wx = torch.hann_window(spec.width, periodic=False, device=p.device, dtype=p.dtype).clamp_min(.1)
    weight = (wy[:, None] * wx[None, :])[None, None]
    pad = (spec.x, w - spec.width - spec.x, spec.y, h - spec.height - spec.y)
    return F.pad(p * weight, pad), F.pad(weight, pad)


def pooled_view_features(features, probability, valid):
    valid = F.interpolate(valid, features.shape[-2:], mode="nearest")
    p = F.interpolate(probability, features.shape[-2:], mode="bilinear", align_corners=False) * valid
    global_v = (features * valid).sum((-2, -1)) / valid.sum((-2, -1)).clamp_min(1)
    hotspot_v = (features * p).sum((-2, -1)) / p.sum((-2, -1)).clamp_min(1e-6)
    return torch.cat([global_v, hotspot_v], dim=1)


def probability_summary(probability):
    p = probability.float().flatten(1)
    h, w = probability.shape[-2:]
    xx = torch.linspace(0, 1, w, device=p.device).view(1, 1, w)
    yy = torch.linspace(0, 1, h, device=p.device).view(1, h, 1)
    mass = probability[:, 0].float()
    den = mass.sum((1, 2)).clamp_min(1e-6)
    top_small = p.topk(max(1, round(p.shape[1] * .001)), dim=1).values.mean(1)
    top_large = p.topk(max(1, round(p.shape[1] * .01)), dim=1).values.mean(1)
    return torch.stack([p.mean(1), p.std(1, correction=0), p.max(1).values, top_small, top_large,
                        torch.sigmoid((p - .5) / .05).mean(1),
                        (mass * xx).sum((1, 2)) / den, (mass * yy).sum((1, 2)) / den], dim=1)
