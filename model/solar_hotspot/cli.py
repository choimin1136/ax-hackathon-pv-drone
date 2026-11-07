import argparse
import json
from pathlib import Path

import numpy as np
import torch
from PIL import Image

from .config import ModelConfig
from .data import (ThermalDataset, assert_disjoint, discover_records, load_manifest, save_manifest)
from .engine import (calibrate_checkpoint, evaluate, forward_batch, load_checkpoint,
                     make_loader, move_batch, require_stage, train_stage)
from .inference import build_results
from .metadata import encode_metadata
from .reporting import qwen_messages


def json_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


def validate_threshold(value):
    value = float(value)
    if not 0 <= value <= 1:
        raise argparse.ArgumentTypeError("Threshold must be in [0,1]")
    return value


def main(argv=None):
    parser = argparse.ArgumentParser(description="Thermal SegFormer + metadata residual fusion")
    parser.add_argument("--threads", type=int, default=4, help="CPU threads; limits tiny-test overhead")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare", help="Index image/JSON pairs; does not make unsafe random splits")
    prepare.add_argument("--label-root", required=True)
    prepare.add_argument("--image-root", required=True)
    prepare.add_argument("--output", required=True)
    inspect = sub.add_parser("inspect", help="Validate every image, mask, target and metadata row")
    inspect.add_argument("--manifest", required=True)

    train = sub.add_parser("train")
    train.add_argument("--stage", choices=["seg", "image", "fusion", "joint"], required=True)
    train.add_argument("--train", required=True)
    train.add_argument("--val", required=True)
    train.add_argument("--output", required=True)
    train.add_argument("--init", dest="initial_checkpoint")
    train.add_argument("--pretrained", help="HF model name or local checkpoint directory (seg only)")
    train.add_argument("--backbone", choices=["b0", "b1", "tiny"], default="b1")
    train.add_argument("--view-size", type=int, default=640)
    train.add_argument("--tile-size", type=int, default=320)
    train.add_argument("--no-tiles", action="store_true")
    train.add_argument("--view-chunk-size", type=int, default=1)
    train.add_argument("--epochs", type=int, default=20)
    train.add_argument("--patience", type=int, default=5)
    train.add_argument("--batch-size", type=int, default=1)
    train.add_argument("--workers", type=int, default=0)
    train.add_argument("--device", default="cpu")
    train.add_argument("--seed", type=int, default=42)
    train.add_argument("--smoke", action="store_true", help="Random-init wiring checks only, not performance claims")

    calibrate = sub.add_parser("calibrate")
    calibrate.add_argument("--checkpoint", required=True)
    calibrate.add_argument("--manifest", required=True)
    calibrate.add_argument("--output", required=True)
    calibrate.add_argument("--device", default="cpu")

    evaluate_parser = sub.add_parser("evaluate")
    evaluate_parser.add_argument("--checkpoint", required=True)
    evaluate_parser.add_argument("--manifest", required=True)
    evaluate_parser.add_argument("--output")
    evaluate_parser.add_argument("--device", default="cpu")
    evaluate_parser.add_argument("--image-threshold", type=validate_threshold, default=.5)
    evaluate_parser.add_argument("--seg-threshold", type=validate_threshold, default=.5)

    predict = sub.add_parser("predict")
    predict.add_argument("--checkpoint", required=True)
    source = predict.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest")
    source.add_argument("--image", help="Unlabelled image; no JSON annotation is needed")
    predict.add_argument("--metadata-json", help="One pre-joined metadata object, only with --image")
    predict.add_argument("--output", required=True, help="Output directory for JSON, probability map, mask, overlay")
    predict.add_argument("--device", default="cpu")
    predict.add_argument("--image-threshold", type=validate_threshold, default=.5)
    predict.add_argument("--seg-threshold", type=validate_threshold, default=.5)

    args = parser.parse_args(argv)
    torch.set_num_threads(max(1, args.threads))
    if args.command == "prepare":
        records = discover_records(args.label_root, args.image_root)
        save_manifest(args.output, records)
        print(json.dumps({"images": len(records), "groups": sorted({r["group_id"] for r in records}),
                          "next": "Review group_id, join real metadata, then create disjoint manifests."}, ensure_ascii=False))
    elif args.command == "inspect":
        records = load_manifest(args.manifest)
        dataset = ThermalDataset(records)
        positives, pixels = 0, 0
        for sample in dataset:
            positives += int(sample["target"].item())
            pixels += int(sample["mask"].sum())
        print(json.dumps({"images": len(dataset), "positive": positives, "normal": len(dataset) - positives,
                          "hotspot_mask_pixels": pixels, "groups": sorted({r["group_id"] for r in records}),
                          "images_with_metadata": sum(bool(encode_metadata(r.get("metadata"))[1].any()) for r in records)}, ensure_ascii=False))
    elif args.command == "train":
        if args.initial_checkpoint and args.pretrained:
            parser.error("--init and --pretrained cannot be combined")
        config = ModelConfig(backbone=args.backbone, view_size=args.view_size, tile_size=args.tile_size,
                             tiles=not args.no_tiles, decoder_dim=16 if args.backbone == "tiny" else 256,
                             view_chunk_size=args.view_chunk_size)
        result = train_stage(load_manifest(args.train), load_manifest(args.val), args.stage, args.output,
                             config, args.initial_checkpoint, args.pretrained, args.epochs, args.patience,
                             args.batch_size, args.workers, args.device, args.seed, args.smoke)
        print(f"Saved: {result}")
    elif args.command == "calibrate":
        print(json.dumps(calibrate_checkpoint(args.checkpoint, load_manifest(args.manifest), args.output, args.device)))
    elif args.command == "evaluate":
        model, scaler, payload = load_checkpoint(args.checkpoint, args.device)
        records = load_manifest(args.manifest)
        for key in ("training_records", "selection_records", "calibration_records"):
            assert_disjoint(payload.get(key, []), records)
        if any(r.get("synthetic", False) for r in records):
            raise ValueError("Real-world evaluation requires real test observations")
        metrics = evaluate(model, make_loader(records, scaler), args.device,
                           calibration=payload.get("calibration"), image_threshold=args.image_threshold,
                           seg_threshold=args.seg_threshold)
        metrics["trained_stages"] = payload["trained_stages"]
        metrics["smoke"] = payload.get("smoke", False)
        metrics["image_classifier_trained"] = "image" in payload["trained_stages"]
        metrics["calibration"] = payload.get("calibration", {})
        if args.output:
            json_write(args.output, metrics)
        print(json.dumps(metrics, indent=2))
    elif args.command == "predict":
        if args.metadata_json and not args.image:
            parser.error("--metadata-json is only valid with --image")
        model, scaler, payload = load_checkpoint(args.checkpoint, args.device)
        require_stage(payload, "fusion")  # Requires trained seg + image heads.
        if args.manifest:
            records = load_manifest(args.manifest)
            loader = make_loader(records, scaler)
            image_paths = {str(r["image_id"]): r["image_path"] for r in records}
        else:
            raw = json.loads(Path(args.metadata_json).read_text(encoding="utf-8-sig")) if args.metadata_json else {}
            values, observed = scaler.transform(raw)
            with Image.open(args.image) as im:
                image = torch.from_numpy(np.array(im.convert("RGB"), dtype=np.float32) / 255).permute(2, 0, 1)
            image_id = Path(args.image).stem
            loader = [{"image": image[None], "metadata": torch.from_numpy(values)[None],
                       "observed": torch.from_numpy(observed)[None], "image_id": [image_id]}]
            image_paths = {image_id: args.image}
        output_dir = Path(args.output)
        output_dir.mkdir(parents=True, exist_ok=True)
        results = []
        model.eval()
        with torch.no_grad():
            for batch in loader:
                batch = move_batch(batch, args.device)
                out = model(batch["image"], batch["metadata"], batch["observed"])
                observed = batch["observed"] if model.fusion_enabled else torch.zeros_like(batch["observed"])
                rows = build_results(out, batch["image_id"], observed, payload.get("calibration"),
                                     args.image_threshold, args.seg_threshold, Path(args.checkpoint).name)
                for i, row in enumerate(rows):
                    name = f"image_{len(results):06d}"
                    p = out["probability_map"][i, 0].cpu().numpy()
                    np.save(output_dir / f"{name}_probability.npy", p)
                    binary = p >= args.seg_threshold
                    Image.fromarray((binary * 255).astype(np.uint8)).save(output_dir / f"{name}_mask.png")
                    with Image.open(image_paths[row["image_id"]]) as im:
                        rgb = np.array(im.convert("RGB"), dtype=np.float32)
                    rgb[binary] = .5 * rgb[binary] + .5 * np.array([255, 0, 0])
                    Image.fromarray(rgb.astype(np.uint8)).save(output_dir / f"{name}_overlay.png")
                    row["localization"]["mask_reference"] = f"{name}_mask.png"
                    row["localization"]["probability_map_reference"] = f"{name}_probability.npy"
                    row["provenance"]["trained_stages"] = payload["trained_stages"]
                    row["provenance"]["smoke"] = payload.get("smoke", False)
                    results.append(row)
        json_write(output_dir / "results.json", results)
        json_write(output_dir / "qwen_messages.json", qwen_messages(results))
        print(f"Saved {len(results)} predictions to {output_dir}")


if __name__ == "__main__":
    main()
