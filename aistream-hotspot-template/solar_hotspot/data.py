import json
from datetime import datetime
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch.utils.data import Dataset

from .metadata import MetadataScaler


def read_label(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def image_target(label):
    """Reject unknown/missing annotations rather than silently declaring normal."""
    qa = label.get("visionqa", {})
    answer = qa.get("defect_detection_a")
    options = qa.get("defect_detection_option", {})
    text = options.get(f"detection_option_{answer}", "").strip()
    target = {"예": 1, "아니오": 0, "yes": 1, "no": 0}.get(text.lower())
    db_target = {"PositiveDB": 1, "NormalDB": 0}.get(label.get("info", {}).get("db_name"))
    if target is not None and db_target is not None and target != db_target:
        raise ValueError("QA and database normal/positive labels disagree")
    target = target if target is not None else db_target
    annotations = label.get("annotations")
    if target == 0 and annotations:
        raise ValueError("Normal image has positive annotations")
    if annotations:
        return 1
    if target == 0:
        return 0
    raise ValueError("Missing/empty annotations do not establish a normal segmentation label")


def polygons_for(annotation):
    seg = annotation.get("segmentation")
    if not isinstance(seg, list) or not seg:
        raise ValueError("Expected polygon segmentation, not missing polygons/RLE")
    polygons = [seg] if isinstance(seg[0], (int, float)) else seg
    for polygon in polygons:
        if len(polygon) < 6 or len(polygon) % 2:
            raise ValueError("Polygon needs at least three x,y pairs")
        if not np.isfinite(np.asarray(polygon, dtype=float)).all():
            raise ValueError("Polygon has non-finite coordinates")
    return polygons


def rasterize(label):
    width, height = label["image"]["width"], label["image"]["height"]
    image_target(label)
    mask = Image.new("L", (width, height), 0)
    draw = ImageDraw.Draw(mask)
    categories = {c["id"]: c["name"] for c in label.get("categories", [])}
    for ann in label.get("annotations", []):
        if categories.get(ann["category_id"], "").lower().replace(" ", "") != "hotspot":
            raise ValueError(f"Unsupported category: {ann['category_id']}")
        if ann.get("image_id") != label["image"]["id"]:
            raise ValueError("Annotation image_id mismatch")
        for poly in polygons_for(ann):
            points = list(zip(poly[::2], poly[1::2]))
            if any(not (0 <= x <= width and 0 <= y <= height) for x, y in points):
                raise ValueError("Polygon outside image bounds")
            draw.polygon(points, fill=1)
    array = np.array(mask, dtype=np.int64)
    if image_target(label) and not array.any():
        raise ValueError("Positive label rasterized to an empty mask")
    return array


def load_manifest(path):
    path = Path(path).resolve()
    records = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        record = json.loads(line)
        for field in ("image_path", "label_path"):
            p = Path(record[field])
            record[field] = str((path.parent / p).resolve() if not p.is_absolute() else p.resolve())
        if not record.get("group_id"):
            raise ValueError("Every record requires an explicit group_id")
        records.append(record)
    if not records:
        raise ValueError(f"Empty manifest: {path}")
    return records


def save_manifest(path, records):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in records), encoding="utf-8")


def capture_group(label):
    """Group by location and capture timestamp, to whole-second precision."""
    collection = label.get("collection", {})
    location = str(collection.get("location", "")).strip()
    timestamp = str(collection.get("datetime", "")).strip()
    if not location or not timestamp:
        raise ValueError("Capture group requires location and datetime")
    captured = datetime.fromisoformat(timestamp)
    return f"{location}:{captured.isoformat(sep=' ', timespec='seconds')}"


def discover_records(label_root, image_root):
    """Strict filename join; callers must supply a SolarPanel-only label root."""
    index = {}
    for path in Path(image_root).rglob("*"):
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}:
            index.setdefault(path.name, []).append(path.resolve())
    records = []
    for path in sorted(Path(label_root).rglob("*.json")):
        label = read_label(path)
        filename = label["image"]["filename"]
        matches = index.get(filename, [])
        if len(matches) != 1:
            raise ValueError(f"Expected one image for {filename}, found {len(matches)}")
        image_target(label)
        group = capture_group(label)
        records.append({"image_id": str(label["image"]["id"]),
                        "image_path": str(matches[0]), "label_path": str(path.resolve()),
                        "group_id": group, "metadata": {}, "synthetic": False})
    if not records:
        raise ValueError("No label JSON files found")
    return records


def assert_disjoint(*record_sets):
    """Prevent group, file and ID overlap across training/validation/calibration/test."""
    seen = [set(), set(), set()]
    for records in record_sets:
        current = [set(), set(), set()]
        for r in records:
            current[0].add(str(r["group_id"]))
            current[1].add(str(Path(r["image_path"]).resolve()).casefold())
            current[2].add(str(r["image_id"]))
        for known, now in zip(seen, current):
            if known & now:
                raise ValueError(f"Data leakage across manifests: {sorted(known & now)[:3]}")
            known.update(now)


class ThermalDataset(Dataset):
    def __init__(self, records, scaler=None):
        self.records = records
        self.scaler = scaler or MetadataScaler([0.] * 16, [1.] * 16, [True] * 16)

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        label = read_label(record["label_path"])
        with Image.open(record["image_path"]) as im:
            im = im.convert("RGB")
            expected = (label["image"]["width"], label["image"]["height"])
            if im.size != expected:
                raise ValueError(f"Image/label dimensions disagree: {record['image_path']}")
            x = torch.from_numpy(np.array(im, dtype=np.float32) / 255).permute(2, 0, 1)
        values, observed = self.scaler.transform(record.get("metadata"))
        return {"image": x, "mask": torch.from_numpy(rasterize(label)),
                "target": torch.tensor([image_target(label)], dtype=torch.float32),
                "metadata": torch.from_numpy(values), "observed": torch.from_numpy(observed),
                "image_id": str(record["image_id"]), "group_id": str(record["group_id"])}


def collate_samples(samples):
    shapes = {tuple(s["image"].shape) for s in samples}
    if len(shapes) != 1:
        raise ValueError("Batch images must have equal original dimensions; use batch_size=1")
    return {key: torch.stack([s[key] for s in samples]) if torch.is_tensor(samples[0][key])
            else [s[key] for s in samples] for key in samples[0]}
