"""Explicit units, missingness and train-only normalization. No invented flight data."""
import math
from dataclasses import dataclass

import numpy as np


FEATURE_NAMES = (
    "height_agl_m", "horizontal_speed_mps", "vertical_speed_mps",
    "roll_sin", "roll_cos", "pitch_sin", "pitch_cos", "yaw_sin", "yaw_cos",
    "gimbal_pitch_sin", "gimbal_pitch_cos", "gimbal_yaw_sin", "gimbal_yaw_cos",
    "time_sin", "time_cos", "exposure_ms",
)
FIELD_GROUPS = ((0,), (1,), (2,), (3, 4), (5, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15,))


def encode_metadata(raw):
    """Angles are degrees; local_time_seconds requires an explicitly known timezone.

    synchronized=False invalidates the entire row. Absence of that key means the
    caller has already joined/validated this per-image record, not raw flight logs.
    """
    raw = raw or {}
    x = np.zeros(16, dtype=np.float32)
    mask = np.zeros(16, dtype=np.float32)
    if raw.get("synchronized") is False:
        return x, mask

    def number(key):
        value = raw.get(key)
        if value is None or isinstance(value, bool):
            return None
        try:
            value = float(value)
        except (TypeError, ValueError):
            raise ValueError(f"Metadata {key} must be numeric or null") from None
        return value if math.isfinite(value) else None

    for key, index in (("height_agl_m", 0), ("horizontal_speed_mps", 1),
                       ("vertical_speed_mps", 2), ("exposure_ms", 15)):
        value = number(key)
        if value is not None:
            if key != "vertical_speed_mps" and value < 0:
                raise ValueError(f"Metadata {key} cannot be negative")
            x[index], mask[index] = value, 1
    for key, index in (("roll_deg", 3), ("pitch_deg", 5), ("yaw_deg", 7),
                       ("gimbal_pitch_deg", 9), ("gimbal_yaw_deg", 11)):
        value = number(key)
        if value is not None:
            angle = math.radians(value)
            x[index:index + 2] = (math.sin(angle), math.cos(angle))
            mask[index:index + 2] = 1
    seconds = number("local_time_seconds")
    if seconds is not None:
        if not 0 <= seconds < 86400:
            raise ValueError("local_time_seconds must be in [0, 86400)")
        angle = 2 * math.pi * seconds / 86400
        x[13:15] = (math.sin(angle), math.cos(angle))
        mask[13:15] = 1
    return x, mask


@dataclass
class MetadataScaler:
    mean: list
    scale: list
    observed: list

    @classmethod
    def fit(cls, records):
        if not records:
            raise ValueError("Cannot fit metadata scaler on an empty training set")
        pairs = [encode_metadata(r.get("metadata")) for r in records]
        x, mask = np.stack([p[0] for p in pairs]), np.stack([p[1] for p in pairs])
        count = mask.sum(0)
        mean = (x * mask).sum(0) / np.maximum(count, 1)
        var = (((x - mean) ** 2) * mask).sum(0) / np.maximum(count, 1)
        scale = np.sqrt(var)
        scale[scale < 1e-6] = 1
        return cls(mean.tolist(), scale.tolist(), (count > 0).tolist())

    def transform(self, raw):
        x, mask = encode_metadata(raw)
        # A feature never observed while training must not activate a random branch.
        mask *= np.asarray(self.observed, dtype=np.float32)
        x = ((x - np.asarray(self.mean)) / np.asarray(self.scale)) * mask
        return x.astype(np.float32), mask.astype(np.float32)

    def to_dict(self):
        return {"mean": self.mean, "scale": self.scale, "observed": self.observed}
