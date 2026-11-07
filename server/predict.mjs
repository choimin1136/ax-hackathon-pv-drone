import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODEL_URL = 'https://aiopen-serving.jntp-ax.or.kr/jntp-gpu/SV-fc7f6908/predict';
const CELL = /^[A-D]-[1-6]$/;
const PHOTO = /\.(jpe?g|png)$/i;
const CELL_ORDER = ['A', 'B', 'C', 'D'].flatMap(row => [1, 2, 3, 4, 5, 6].map(col => `${row}-${col}`));
const TIMEOUT_MS = 30000;

// Sends one thermal photo per cell to the hotspot model. The browser cannot call the model's domain itself (no CORS),
// so the web server does it. Photos come from PHOTO_DIR: "A-1.jpg" style names first, otherwise sorted order.
export function createPredictor({ env = process.env, fetchImpl = fetch } = {}) {
  const photoDir = env.PHOTO_DIR ? path.resolve(env.PHOTO_DIR) : null;
  const modelUrl = env.MODEL_URL ?? DEFAULT_MODEL_URL;
  const cache = new Map();

  async function photos() {
    if (!photoDir) return [];
    return (await readdir(photoDir).catch(() => [])).filter(name => PHOTO.test(name)).sort();
  }
  async function photoFor(cellId) {
    const names = await photos();
    if (!names.length) return null;
    return names.find(name => path.parse(name).name.toUpperCase() === cellId) ?? names[CELL_ORDER.indexOf(cellId) % names.length];
  }
  async function call(name) {
    const file = path.join(photoDir, name);
    const form = new FormData();
    form.append('file', new Blob([await readFile(file)], { type: name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }), name);
    const response = await fetchImpl(modelUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`model status ${response.status}`);
    return response.json();
  }

  async function status() {
    return { configured: Boolean(photoDir), photos: (await photos()).length };
  }
  async function predict(cellId) {
    if (!CELL.test(cellId)) return { status: 400, error: 'invalid cell' };
    const name = await photoFor(cellId);
    if (!name) return { status: 503, error: 'no photos' };
    const { mtimeMs } = await stat(path.join(photoDir, name));
    // The same photo always gives the same answer, so results are kept per photo.
    const key = `${name}:${mtimeMs}`;
    if (!cache.has(key)) {
      // Failed calls are not cached, so the next arrival tries again.
      cache.set(key, call(name).catch(error => { cache.delete(key); throw error; }));
    }
    try {
      const body = await cache.get(key);
      const prediction = body.result?.prediction ?? {};
      return {
        cell_id: cellId,
        photo: name,
        image_id: body.result?.image_id ?? null,
        is_hotspot: Boolean(body.is_hotspot),
        probability: body.probability,
        threshold: body.decision_threshold,
        calibrated: Boolean(body.calibrated),
        decision_status: prediction.decision_status ?? null,
        regions: (body.bboxes ?? []).map(({ cx, cy, w, h }) => ({ cx, cy, w, h })),
        output: typeof body.output === 'string' && body.output.startsWith('data:image/') ? body.output : null
      };
    } catch (error) {
      console.error(`Model call failed for ${cellId}: ${error.message}`);
      return { status: 502, error: 'model unavailable' };
    }
  }
  return { status, predict };
}
