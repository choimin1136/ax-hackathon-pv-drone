import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MODEL_URL = 'https://aiopen-serving.jntp-ax.or.kr/jntp-gpu/SV-fc7f6908/predict';
const CELL = /^[A-D]-[1-6]$/;
const PHOTO = /\.(jpe?g|png)$/i;
const TIMEOUT_MS = 30000;
const LIST_MS = 60000;

// Sends one thermal photo per cell to the hotspot model. The browser cannot call the model's domain itself (no CORS),
// so the web server does it. Photos come from PHOTO_DIR and its subfolders (AI Hub keeps images in TS_* folders and
// label JSON in TL_*, which the extension filter skips). An "A-1.jpg" style name wins, otherwise each full flight
// draws a random photo per cell (without repeats while the folder has enough).
export function createPredictor({ env = process.env, fetchImpl = fetch, random = Math.random } = {}) {
  const photoDir = env.PHOTO_DIR ? path.resolve(env.PHOTO_DIR) : null;
  const modelUrl = env.MODEL_URL ?? DEFAULT_MODEL_URL;
  const cache = new Map();
  let assigned = new Map(), listed = null, listedAt = 0;

  // Large datasets are listed at most once a minute; names are paths relative to PHOTO_DIR.
  async function photos() {
    if (!photoDir) return [];
    if (!listed || Date.now() - listedAt > LIST_MS) {
      const entries = await readdir(photoDir, { recursive: true }).catch(() => []);
      listed = entries.filter(name => PHOTO.test(name)).sort();
      listedAt = Date.now();
    }
    return listed;
  }
  async function photoFor(cellId) {
    const names = await photos();
    if (!names.length) return null;
    const named = names.find(name => path.parse(name).name.toUpperCase() === cellId);
    if (named) return named;
    if (!assigned.has(cellId) || !names.includes(assigned.get(cellId))) {
      const used = new Set(assigned.values());
      const shared = names.filter(name => !CELL.test(path.parse(name).name.toUpperCase()));
      const free = shared.filter(name => !used.has(name));
      const pool = free.length ? free : shared.length ? shared : names;
      assigned.set(cellId, pool[Math.floor(random() * pool.length)]);
    }
    return assigned.get(cellId);
  }
  // Called when a new full flight starts, so the next inspection draws new photos.
  function shuffle() { assigned = new Map(); }
  async function call(name) {
    const file = path.join(photoDir, name);
    const form = new FormData();
    form.append('file', new Blob([await readFile(file)], { type: name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg' }), path.basename(name));
    const response = await fetchImpl(modelUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`model status ${response.status}`);
    return response.json();
  }

  async function status() {
    return { configured: Boolean(photoDir), photos: (await photos()).length };
  }
  // The same photo always gives the same answer, so results are kept per photo.
  async function modelAnswer(name) {
    const { mtimeMs } = await stat(path.join(photoDir, name));
    const key = `${name}:${mtimeMs}`;
    if (!cache.has(key)) {
      // Failed calls are not cached, so the next arrival tries again.
      cache.set(key, call(name).catch(error => { cache.delete(key); throw error; }));
    }
    return cache.get(key);
  }
  // Only photos listed from PHOTO_DIR can be read back, so a request cannot reach other files.
  async function known(name) {
    return typeof name === 'string' && (await photos()).includes(name) ? name : null;
  }
  function regionsOf(body) {
    const regions = body.result?.localization?.regions;
    if (Array.isArray(regions)) return regions.map(r => ({ bbox: r.bbox_xywh, area_px: r.area_px, score: r.mean_segmentation_score }));
    return (body.bboxes ?? []).map(({ cx, cy, w, h }) => ({ bbox: [Math.round(cx - w / 2), Math.round(cy - h / 2), w, h], area_px: w * h, score: null }));
  }
  async function predict(cellId) {
    if (!CELL.test(cellId)) return { status: 400, error: 'invalid cell' };
    const name = await photoFor(cellId);
    if (!name) return { status: 503, error: 'no photos' };
    try {
      const body = await modelAnswer(name);
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
        image_size: body.result?.localization?.image_size ?? [640, 512],
        regions: regionsOf(body),
        output: typeof body.output === 'string' && body.output.startsWith('data:image/') ? body.output : null
      };
    } catch (error) {
      console.error(`Model call failed for ${cellId}: ${error.message}`);
      return { status: 502, error: 'model unavailable' };
    }
  }
  // The original photo of a past or current result, for the cell detail view.
  async function photo(name) {
    const found = await known(name);
    if (!found) return null;
    return { type: found.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg', data: await readFile(path.join(photoDir, found)) };
  }
  // The model's overlay image (hotspots painted on the photo) for the same photo.
  async function overlay(name) {
    const found = await known(name);
    if (!found) return null;
    try {
      const match = /^data:(image\/[a-z]+)[^,]*;base64,(.*)$/s.exec((await modelAnswer(found)).output ?? '');
      return match ? { type: match[1], data: Buffer.from(match[2], 'base64') } : null;
    } catch { return null; }
  }
  return { status, predict, shuffle, photo, overlay };
}
