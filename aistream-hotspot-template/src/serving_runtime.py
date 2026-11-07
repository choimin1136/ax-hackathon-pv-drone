from contextlib import asynccontextmanager
import logging
import os

from fastapi import FastAPI, File, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from .hotspot_runtime import (HotspotRuntime, ImageTooLarge, InvalidImage,
                              MAX_BYTES, resolve_checkpoint)


def create_app(checkpoint='hotspot.pt', device='cuda', image_threshold=0.5, seg_threshold=0.5):
    @asynccontextmanager
    async def lifespan(app):
        path = resolve_checkpoint(checkpoint)
        logging.getLogger(__name__).info('Loading model from %s on %s', path, device)
        app.state.runtime = await run_in_threadpool(
            HotspotRuntime, path, device, image_threshold, seg_threshold)
        yield
        del app.state.runtime

    app = FastAPI(title='Solar Hotspot Serving', lifespan=lifespan,
                  root_path=os.getenv('SERVING_ROOT_PATH', '').rstrip('/'))

    @app.get('/health')
    @app.get('/healthz')
    def health():
        runtime = getattr(app.state, 'runtime', None)
        if runtime is None:
            raise HTTPException(503, 'Model is not loaded')
        return {'status': 'ready', 'device': runtime.device, 'checkpoint': runtime.path.name}

    @app.post('/')
    @app.post('/predict')
    @app.post('/infer')
    async def predict(file: UploadFile = File(...)):
        try:
            content = await file.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                raise ImageTooLarge('Image exceeds 20 MiB')
            return await run_in_threadpool(app.state.runtime.predict, content, file.filename)
        except ImageTooLarge as exc:
            raise HTTPException(413, str(exc)) from exc
        except InvalidImage as exc:
            raise HTTPException(400, str(exc)) from exc
        finally:
            await file.close()

    return app


def run_serving(checkpoint='hotspot.pt', device='cuda', image_threshold=0.5, seg_threshold=0.5):
    import uvicorn
    uvicorn.run(create_app(checkpoint, device, image_threshold, seg_threshold),
                host='0.0.0.0', port=8000, workers=1)
