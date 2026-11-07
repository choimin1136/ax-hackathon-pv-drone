import base64
import io
import json
import os
from pathlib import Path
from threading import Lock

import numpy as np
from PIL import Image, UnidentifiedImageError
import torch

from solar_hotspot.engine import load_checkpoint
from solar_hotspot.inference import build_results
from .model_inputs import load_model_input

MAX_BYTES = 20 * 1024 * 1024
MAX_PIXELS = 4_000_000


class InvalidImage(ValueError):
    pass


class ImageTooLarge(ValueError):
    pass


def resolve_checkpoint(checkpoint='hotspot.pt'):
    raw = os.environ.get('MODEL_INPUTS_JSON')
    if raw is not None:
        mount = load_model_input('model', raw)['mountPath']
        root = Path(mount).resolve()
    else:
        root = Path(__file__).resolve().parents[1] / 'models'
    relative = Path(checkpoint)
    path = (root / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(root):
        raise ValueError('checkpoint must be a relative path inside the model mount')
    if not path.is_file():
        raise FileNotFoundError(f'Checkpoint not found: {path}; model mount={root}. '
                                'Match --checkpoint to the registered model file layout.')
    with path.open('rb') as stream:
        if not stream.read(1):
            raise ValueError(f'Empty checkpoint: {path}')
    return path


class HotspotRuntime:
    def __init__(self, path, device='cuda', image_threshold=0.5, seg_threshold=0.5):
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA requested but unavailable in this container')
        self.path = Path(path)
        self.device = device
        self.image_threshold = image_threshold
        self.seg_threshold = seg_threshold
        self.lock = Lock()
        self.model, self.scaler, self.payload = load_checkpoint(path, device)
        if not {'seg', 'image'} <= set(self.payload.get('trained_stages', [])):
            raise ValueError('Checkpoint requires trained segmentation and image heads')
        if self.payload.get('smoke', False):
            raise ValueError('Smoke checkpoint is not a deployment model')
        self.model.fusion_enabled = False

    def predict(self, content, filename='image'):
        if len(content) > MAX_BYTES:
            raise ImageTooLarge('Image exceeds 20 MiB')
        try:
            with Image.open(io.BytesIO(content)) as image:
                if image.width * image.height > MAX_PIXELS:
                    raise ImageTooLarge('Image exceeds 4,000,000 pixels')
                pixels = np.array(image.convert('RGB'), dtype=np.float32) / 255.0
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            if isinstance(exc, ImageTooLarge):
                raise
            raise InvalidImage('Unable to decode image') from exc
        values, observed = self.scaler.transform({})
        x = torch.from_numpy(pixels).permute(2, 0, 1)[None].to(self.device)
        metadata = torch.from_numpy(values)[None].to(self.device)
        observed_tensor = torch.from_numpy(observed)[None].to(self.device)
        with self.lock, torch.inference_mode():
            output = self.model(x, metadata, observed_tensor)
            result = build_results(
                output, [Path(filename or 'image').stem], torch.zeros_like(observed_tensor),
                self.payload.get('calibration'), self.image_threshold, self.seg_threshold,
                self.path.name,
            )[0]
            probability = output['probability_map'][0, 0].cpu().numpy()
            mask = Image.fromarray((probability >= self.seg_threshold).astype(np.uint8) * 255)
            buffer = io.BytesIO()
            mask.save(buffer, format='PNG')
        result['provenance']['trained_stages'] = self.payload['trained_stages']
        result['provenance']['smoke'] = False
        rgb = (pixels * 255).round().clip(0, 255).astype(np.uint8)
        active = probability >= self.seg_threshold
        overlay = rgb.copy()
        overlay[active] = (0.5 * rgb[active] + 0.5 * np.array([255, 0, 0])).astype(np.uint8)
        visualized = io.BytesIO()
        Image.fromarray(overlay).save(visualized, format='JPEG')
        boxes = []
        for region in result['localization']['regions']:
            x, y, width, height = region['bbox_xywh']
            boxes.append({'cx': x + width / 2, 'cy': y + height / 2,
                          'w': width, 'h': height, 'label': 1})
        prediction = result['prediction']
        image_probability = prediction['final_probability']
        return {'probability': image_probability,
                'is_hotspot': image_probability >= prediction['decision_threshold'],
                'decision_threshold': prediction['decision_threshold'],
                'calibrated': prediction['calibrated'],
                'result': result, 'mask_png_base64': base64.b64encode(buffer.getvalue()).decode('ascii'),
                'bboxes': boxes,
                'output': 'data:image/jpeg;charset=utf-8;base64,' +
                          base64.b64encode(visualized.getvalue()).decode('ascii')}
