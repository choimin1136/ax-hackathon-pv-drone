import json
import random
import time
from dataclasses import asdict
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader

from .calibration import calibrated_probabilities, fit_temperature
from .config import ModelConfig
from .data import ThermalDataset, assert_disjoint, collate_samples
from .losses import stage_loss
from .metadata import MetadataScaler
from .model import HotspotModel


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def move_batch(batch, device):
    return {k: v.to(device) if torch.is_tensor(v) else v for k, v in batch.items()}


def make_loader(records, scaler, batch_size=1, workers=0, shuffle=False):
    return DataLoader(ThermalDataset(records, scaler), batch_size=batch_size, shuffle=shuffle,
                      num_workers=workers, collate_fn=collate_samples)


def record_refs(records):
    return [{k: r[k] for k in ("image_id", "image_path", "group_id")} for r in records]


def load_checkpoint(path, device="cpu"):
    payload = torch.load(path, map_location="cpu", weights_only=True)
    model = HotspotModel(ModelConfig(**payload["model_config"]))
    model.load_state_dict(payload["model"])
    model.to(device)
    model.fusion_enabled = "fusion" in payload.get("trained_stages", [])
    model.eval()
    scaler = MetadataScaler(**payload["metadata_scaler"])
    return model, scaler, payload


def require_stage(payload, stage):
    trained = set(payload.get("trained_stages", []))
    required = {"image": {"seg"}, "fusion": {"seg", "image"}, "joint": {"seg", "image", "fusion"}}.get(stage, set())
    if not required <= trained:
        raise ValueError(f"Stage {stage} requires completed stages {sorted(required)}; got {sorted(trained)}")


def forward_batch(model, batch, stage=None, training=False):
    return model(batch["image"], batch["metadata"], batch["observed"],
                 labels=batch["mask"] if stage in {"seg", "joint"} else None,
                 metadata_dropout=.15 if training and stage in {"fusion", "joint"} else 0.,
                 compute_seg_loss=stage in {"seg", "joint"})


@torch.no_grad()
def evaluate(model, loader, device, stage=None, calibration=None, image_threshold=.5, seg_threshold=.5):
    model.eval()
    totals = {"samples": 0, "top1_correct": 0, "tp": 0, "fp": 0, "tn": 0, "fn": 0,
              "intersection": 0, "pred_pixels": 0, "true_pixels": 0, "brier_sum": 0., "nll_sum": 0., "loss_sum": 0.}
    for batch in loader:
        batch = move_batch(batch, device)
        out = forward_batch(model, batch, stage)
        _, prob, _ = calibrated_probabilities(out, calibration)
        target, pred = batch["target"].bool(), prob >= image_threshold
        # Binary top-1 compares normal (1-p) against hotspot (p).
        # Keep its decision boundary fixed even if an operating threshold is supplied.
        totals["top1_correct"] += int(((prob >= .5) == target).sum())
        totals["tp"] += int((pred & target).sum())
        totals["fp"] += int((pred & ~target).sum())
        totals["tn"] += int((~pred & ~target).sum())
        totals["fn"] += int((~pred & target).sum())
        totals["brier_sum"] += float(((prob - batch["target"]) ** 2).sum())
        clipped = prob.clamp(1e-7, 1 - 1e-7)
        totals["nll_sum"] += float(torch.nn.functional.binary_cross_entropy(clipped, batch["target"], reduction="sum"))
        pmask, ymask = out["probability_map"][:, 0] >= seg_threshold, batch["mask"] == 1
        totals["intersection"] += int((pmask & ymask).sum())
        totals["pred_pixels"] += int(pmask.sum())
        totals["true_pixels"] += int(ymask.sum())
        count = len(target)
        if stage:
            totals["loss_sum"] += float(stage_loss(out, batch["target"], stage)["loss"]) * count
        totals["samples"] += count
    n = totals["samples"]
    inter, pp, yy = totals["intersection"], totals["pred_pixels"], totals["true_pixels"]
    return {"samples": n, "top1_accuracy": totals["top1_correct"] / n,
            "decision_accuracy": (totals["tp"] + totals["tn"]) / n, "decision_threshold": image_threshold,
            "top1_correct": totals["top1_correct"], "top1_threshold": .5, "loss": totals["loss_sum"] / n if stage else None,
            "dice": 2 * inter / (pp + yy) if pp + yy else 1.,
            "iou": inter / (pp + yy - inter) if pp + yy - inter else 1.,
            "recall": totals["tp"] / (totals["tp"] + totals["fn"]) if totals["tp"] + totals["fn"] else None,
            "normal_false_positive_rate": totals["fp"] / (totals["fp"] + totals["tn"]) if totals["fp"] + totals["tn"] else None,
            "brier": totals["brier_sum"] / n, "nll": totals["nll_sum"] / n,
            "tp": totals["tp"], "fp": totals["fp"], "tn": totals["tn"], "fn": totals["fn"]}


def train_stage(train_records, val_records, stage, output_dir, config=None, initial_checkpoint=None,
                pretrained=None, epochs=20, patience=5, batch_size=1, workers=0, device="cpu", seed=42,
                smoke=False):
    seed_everything(seed)
    if epochs < 1:
        raise ValueError("epochs must be >=1")
    if patience < 1:
        raise ValueError("patience must be >=1")
    assert_disjoint(train_records, val_records)
    if any(r.get("synthetic", False) for r in val_records):
        raise ValueError("Validation must contain real observations only")
    if initial_checkpoint:
        model, scaler, history = load_checkpoint(initial_checkpoint, device)
        require_stage(history, stage)
    else:
        if stage != "seg":
            raise ValueError("Start with seg stage or provide --init checkpoint")
        if not pretrained and not smoke:
            raise ValueError("Supply --pretrained for real training; --smoke explicitly permits random initialization")
        model = HotspotModel(config or ModelConfig(), pretrained).to(device)
        scaler = MetadataScaler.fit(train_records)
        history = {"trained_stages": [], "training_records": [], "selection_records": [], "smoke": smoke}
    if history.get("smoke", False) and not smoke:
        raise ValueError("A smoke checkpoint cannot be promoted to a real training run")
    assert_disjoint(history.get("training_records", []), val_records)
    assert_disjoint(history.get("selection_records", []), train_records)
    assert_disjoint(history.get("calibration_records", []), train_records)
    assert_disjoint(history.get("calibration_records", []), val_records)
    if stage in {"image", "fusion"} and not smoke:
        # Stacking on in-sample upstream predictions is forbidden by default.
        assert_disjoint(history.get("training_records", []), train_records)
    if stage == "fusion":
        scaler = MetadataScaler.fit(train_records)
        if not any(scaler.observed):
            raise ValueError("Fusion training needs real synchronized metadata; use image-only prediction until logs exist")
        if any(r.get("synthetic", False) for r in train_records):
            raise ValueError("Fusion stage currently requires real paired observations")
    if stage == "joint" and any(r.get("synthetic", False) for r in train_records):
        raise ValueError("Joint fusion fine-tuning currently requires real paired observations")
    model.set_stage(stage)
    train_loader = make_loader(train_records, scaler, batch_size, workers, True)
    val_loader = make_loader(val_records, scaler, batch_size, workers)
    groups = []
    encoder_params, other_params = [], []
    for name, p in model.named_parameters():
        if p.requires_grad:
            (encoder_params if name.startswith("segmenter.net.segformer.") else other_params).append(p)
    if encoder_params:
        groups.append({"params": encoder_params, "lr": 1e-5})
    if other_params:
        groups.append({"params": other_params, "lr": 1e-4 if stage in {"seg", "joint"} else 1e-3})
    optimizer = torch.optim.AdamW(groups, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    best, stale = float("inf"), 0
    best_accuracy = (-float("inf"), -float("inf"))
    all_training = history.get("training_records", []) + record_refs(train_records)
    selections = history.get("selection_records", []) + record_refs(val_records)
    stage_started = time.monotonic()
    for epoch in range(1, epochs + 1):
        epoch_started = time.monotonic()
        model.train()
        sums, count = {}, 0
        for batch_index, batch in enumerate(train_loader, 1):
            batch = move_batch(batch, device)
            optimizer.zero_grad(set_to_none=True)
            out = forward_batch(model, batch, stage, True)
            losses = stage_loss(out, batch["target"], stage)
            if not torch.isfinite(losses["loss"]):
                raise FloatingPointError("Non-finite training loss")
            losses["loss"].backward()
            torch.nn.utils.clip_grad_norm_([p for p in model.parameters() if p.requires_grad], 1.)
            optimizer.step()
            for name, value in losses.items():
                sums[name] = sums.get(name, 0.) + float(value.detach()) * len(batch["target"])
            count += len(batch["target"])
            if batch_index == 1 or batch_index % 25 == 0 or batch_index == len(train_loader):
                elapsed = time.monotonic() - epoch_started
                progress = {"event": "train_progress", "stage": stage, "epoch": epoch,
                            "epochs": epochs, "batch": batch_index, "batches": len(train_loader),
                            "seconds_per_batch": elapsed / batch_index,
                            "epoch_train_elapsed_seconds": elapsed,
                            "stage_elapsed_seconds": time.monotonic() - stage_started,
                            "loss": float(losses["loss"].detach()),
                            "gpu_peak_memory_gib": torch.cuda.max_memory_allocated() / 2**30
                            if str(device).startswith("cuda") else None}
                print(json.dumps(progress), flush=True)
                with (output_dir / "progress.jsonl").open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(progress) + "\n")
        scheduler.step()
        train_seconds = time.monotonic() - epoch_started
        print(json.dumps({"event": "validation_started", "stage": stage, "epoch": epoch}), flush=True)
        validation_started = time.monotonic()
        metrics = evaluate(model, val_loader, device, stage)
        validation_seconds = time.monotonic() - validation_started
        row = {"epoch": epoch, "stage": stage, "train": {k: v / count for k, v in sums.items()}, "val": metrics, "train_seconds": train_seconds, "validation_seconds": validation_seconds}
        print(json.dumps(row), flush=True)
        with (output_dir / "metrics.jsonl").open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(row) + "\n")
        # Persist every epoch and the last weights independently of selection.
        order = ["seg", "image", "fusion", "joint"]
        completed = set(history.get("trained_stages", []) + [stage])
        completed &= set(order[:order.index(stage) + 1])
        payload = {"model": model.state_dict(), "model_config": asdict(model.config),
                   "metadata_scaler": scaler.to_dict(), "stage": stage,
                   "trained_stages": sorted(completed),
                   "training_records": all_training, "selection_records": selections,
                   "calibration": {}, "calibration_records": [], "epoch": epoch,
                   "validation": metrics, "smoke": smoke, "seed": seed}

        def save_epoch_checkpoint(name):
            target = output_dir / name
            temporary = target.with_suffix(".tmp")
            torch.save(payload, temporary)
            temporary.replace(target)

        save_epoch_checkpoint(f"epoch_{epoch:03d}.pt")
        save_epoch_checkpoint("last.pt")
        if stage in {"image", "fusion", "joint"}:
            accuracy_score = (metrics["top1_accuracy"], metrics["recall"] or 0.)
            if accuracy_score > best_accuracy:
                best_accuracy = accuracy_score
                save_epoch_checkpoint("best_accuracy.pt")
        score = metrics["loss"]
        if score < best:
            best, stale = score, 0
            save_epoch_checkpoint("best.pt")
        else:
            stale += 1
        if stale >= patience:
            break
    return output_dir / "best.pt"


def calibrate_checkpoint(checkpoint, records, output, device="cpu", batch_size=1):
    model, scaler, payload = load_checkpoint(checkpoint, device)
    require_stage(payload, "fusion")  # seg + image; fusion itself is optional
    if payload.get("smoke"):
        raise ValueError("Smoke checkpoints cannot support calibrated probability claims")
    assert_disjoint(payload.get("training_records", []), records)
    assert_disjoint(payload.get("selection_records", []), records)
    if any(r.get("synthetic", False) for r in records):
        raise ValueError("Calibration requires real observations")
    model.eval()
    image, final, targets, available = [], [], [], []
    with torch.no_grad():
        for batch in make_loader(records, scaler, batch_size):
            batch = move_batch(batch, device)
            out = forward_batch(model, batch)
            image.append(out["image_logit"].cpu())
            final.append(out["final_logit"].cpu())
            targets.append(batch["target"].cpu())
            available.append(out["metadata_available"].cpu())
    image, final, targets, available = map(torch.cat, (image, final, targets, available))
    calibration = {"image_temperature": fit_temperature(image, targets)}
    if "fusion" in payload["trained_stages"] and available.any():
        # Refuse a one-class fusion subset instead of claiming it is calibrated.
        calibration["fusion_temperature"] = fit_temperature(final[available], targets[available])
    payload["calibration"] = calibration
    payload["calibration_records"] = record_refs(records)
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    torch.save(payload, output)
    return calibration
