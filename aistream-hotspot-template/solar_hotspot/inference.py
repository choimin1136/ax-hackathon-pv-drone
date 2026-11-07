from collections import deque

import numpy as np

from .calibration import calibrated_probabilities
from .metadata import FEATURE_NAMES


def connected_regions(probability, threshold=.5, min_area=1):
    """8-connected components; scores are explicitly NOT calibrated object probabilities."""
    p = np.asarray(probability, dtype=np.float32)
    binary = p >= threshold
    visited = np.zeros_like(binary, dtype=bool)
    height, width = binary.shape
    regions = []
    for y, x in np.argwhere(binary):
        if visited[y, x]:
            continue
        visited[y, x] = True
        queue, pixels = deque([(int(y), int(x))]), []
        while queue:
            cy, cx = queue.popleft()
            pixels.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < height and 0 <= nx < width and binary[ny, nx] and not visited[ny, nx]:
                        visited[ny, nx] = True
                        queue.append((ny, nx))
        if len(pixels) < min_area:
            continue
        yy, xx = np.asarray(pixels).T
        regions.append({"region_id": len(regions) + 1,
                        "bbox_xywh": [int(xx.min()), int(yy.min()), int(xx.max() - xx.min() + 1), int(yy.max() - yy.min() + 1)],
                        "centroid_xy": [float(xx.mean()), float(yy.mean())],
                        "area_px": len(pixels), "mean_segmentation_score": float(p[yy, xx].mean())})
    return regions


def build_results(output, image_ids, observed, calibration=None, image_threshold=.5, seg_threshold=.5,
                  checkpoint_version="unversioned"):
    image_p, final_p, calibrated = calibrated_probabilities(output, calibration)
    results = []
    for i, image_id in enumerate(image_ids):
        p = output["probability_map"][i, 0].detach().cpu().numpy()
        regions = connected_regions(p, seg_threshold)
        positive = bool(final_p[i, 0] >= image_threshold)
        status = ("hotspot_localized" if regions else "hotspot_suspected_location_unresolved") if positive else (
            "low_confidence_candidate" if regions else "no_hotspot_detected")
        available = bool(output["metadata_available"][i, 0])
        valid = observed[i].bool().cpu().tolist()
        results.append({"schema_version": "1.0", "image_id": str(image_id),
                        "prediction": {"target": "at_least_one_hotspot_in_image",
                                       "image_only_probability": float(image_p[i, 0]),
                                       "final_probability": float(final_p[i, 0]),
                                       "calibrated": bool(calibrated[i, 0]),
                                       "decision_threshold": image_threshold, "decision_status": status,
                                       "inference_path": "fusion" if available else "image_only"},
                        "localization": {"coordinate_system": "image_pixels", "image_size": [p.shape[1], p.shape[0]],
                                         "segmentation_threshold": seg_threshold, "regions": regions},
                        "data_quality": {"available_features": [n for n, v in zip(FEATURE_NAMES, valid) if v],
                                         "missing_or_untrained_features": [n for n, v in zip(FEATURE_NAMES, valid) if not v],
                                         "temperature_measurement_available": False},
                        "provenance": {"checkpoint_version": checkpoint_version},
                        "limitations": ["Image-level probability is not an individual-region probability.",
                                        "Pixel positions are not geographic coordinates.",
                                        "Temperature, cause and power loss are not measured."]})
    return results
