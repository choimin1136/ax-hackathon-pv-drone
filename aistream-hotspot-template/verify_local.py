"""CPU model + HTTP contract check. Requires httpx for TestClient."""
import base64
import io
import json
import os
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image

from src.hotspot_runtime import HotspotRuntime, resolve_checkpoint
from src.serving_runtime import create_app


def main():
    root = Path(__file__).resolve().parent
    # Platform paths are POSIX absolute; a rooted Windows path resolves on the current drive.
    mount = (root / 'models').as_posix().split(':')[-1]
    environment = {'MODEL_INPUTS_JSON': json.dumps({'schemaVersion': 1, 'inputs': {'model': {
        'mode': 'FROM_VERSION', 'registeredModelId': 'test-model',
        'registeredModelVersionId': 'test-version', 'mlflowRegisteredModelName': 'hotspot',
        'mlflowModelVersion': '1', 'mountPath': mount}}})}
    with patch.dict(os.environ, environment):
        assert resolve_checkpoint() == root / 'models' / 'hotspot.pt'
        try:
            resolve_checkpoint('iter_140000_wind.pth')
        except FileNotFoundError:
            pass
        else:
            raise AssertionError('Missing checkpoint must fail')
        with patch.dict(os.environ, {'MODEL_INPUTS_JSON': '{}'}):
            try:
                resolve_checkpoint()
            except ValueError:
                pass
            else:
                raise AssertionError('Invalid platform input must not fall back to local model')
        image = io.BytesIO()
        Image.new('RGB', (64, 48), color=(90, 120, 100)).save(image, 'PNG')
        with patch('src.hotspot_runtime.torch.cuda.is_available', return_value=False):
            try:
                HotspotRuntime(resolve_checkpoint())
            except RuntimeError as exc:
                assert 'CUDA requested' in str(exc)
            else:
                raise AssertionError('CUDA deployment must fail when GPU is unavailable')
        # CPU is used only by this local test; the deployment entrypoint always selects CUDA.
        with TestClient(create_app(device='cpu')) as client:
            assert client.get('/health').status_code == 200
            response = client.post('/infer', files={'file': ('sample.png', image.getvalue(), 'image/png')})
            assert response.status_code == 200, response.text
            body = response.json()
            assert 0 <= body['probability'] <= 1
            assert body['probability'] == body['result']['prediction']['final_probability']
            assert body['is_hotspot'] == (body['probability'] >= body['decision_threshold'])
            assert body['calibrated'] == body['result']['prediction']['calibrated']
            assert isinstance(body['bboxes'], list)
            assert body['output'].startswith('data:image/jpeg;charset=utf-8;base64,')
            overlay = Image.open(io.BytesIO(base64.b64decode(body['output'].split(',', 1)[1])))
            assert overlay.size == (64, 48)
            assert body['result']['prediction']['inference_path'] == 'image_only'
            assert body['result']['localization']['image_size'] == [64, 48]
            mask = Image.open(io.BytesIO(base64.b64decode(body['mask_png_base64'])))
            assert mask.size == (64, 48)
            assert set(mask.getdata()) <= {0, 255}
            assert client.post('/predict', files={'file': ('bad.jpg', b'bad', 'image/jpeg')}).status_code == 400
            assert client.post('/predict').status_code == 422
            assert client.get('/healthz').status_code == 200
            print(json.dumps({'status': 'PASS', 'health': True, 'real_checkpoint_inference': True,
                              'invalid_image': 400, 'missing_file': 422,
                              'result': body['result']}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
