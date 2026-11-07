// Checks the hotspot model before a demo: service health, a few real photos sent straight to the model, and the
// web server's own model connection. Run on the server:
//   node tools/check-model.mjs                       (MODEL_URL, PHOTO_DIR from the environment, or the defaults)
//   node tools/check-model.mjs --count 10 --web http://127.0.0.1:8501
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { modelConfig } from '../server/config.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const model = modelConfig();
const modelUrl = option('model', model.url);
const photoDir = path.resolve(option('photos', model.photoDir ?? '/data/test'));
const count = Math.max(2, Number(option('count', 6)));
const webUrl = option('web', `http://127.0.0.1:${process.env.PORT ?? 8501}`).replace(/\/+$/, '');
const hotspot = new RegExp(model.hotspotPattern, 'i');
const TIMEOUT_MS = model.timeoutMs;
let failed = false;

const pick = (list, n) => [...list].sort(() => Math.random() - 0.5).slice(0, n);
const median = values => { const s = [...values].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
function fail(message) { failed = true; console.log(`  ✗ ${message}`); }

async function checkHealth() {
  const url = modelUrl.replace(/\/(predict|infer)?\/?$/, '') + '/health';
  console.log(`1. 모델 서빙 상태  ${url}`);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const text = await response.text();
    if (response.ok && /ready/.test(text)) console.log(`  ✓ ${text.trim()}`);
    else fail(`응답 ${response.status}: ${text.trim().slice(0, 120)}`);
  } catch (error) { fail(`연결 실패: ${error.message}`); }
}

async function checkPhotos() {
  console.log(`\n2. 사진 판정  ${photoDir}`);
  const names = (await readdir(photoDir, { recursive: true }).catch(() => [])).filter(name => /\.(jpe?g|png)$/i.test(name));
  if (!names.length) { fail('사진이 없습니다. PHOTO_DIR 또는 --photos를 확인하세요.'); return; }
  const positives = names.filter(name => hotspot.test(name)), normals = names.filter(name => !hotspot.test(name));
  console.log(`  사진 ${names.length}장 (핫스팟 폴더 ${positives.length}, 그 외 ${normals.length})`);
  const chosen = [...pick(positives, Math.ceil(count / 2)), ...pick(normals, Math.floor(count / 2))];
  const times = [];
  let agree = 0, done = 0;
  for (const name of chosen) {
    const label = hotspot.test(name) ? '핫스팟' : '정상';
    const form = new FormData();
    form.append('file', new Blob([await readFile(path.join(photoDir, name))], { type: /\.png$/i.test(name) ? 'image/png' : 'image/jpeg' }), path.basename(name));
    const started = Date.now();
    try {
      const response = await fetch(modelUrl, { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT_MS) });
      const ms = Date.now() - started;
      if (!response.ok) { fail(`${path.basename(name)}: 응답 ${response.status}`); continue; }
      const body = await response.json();
      times.push(ms); done += 1;
      const said = body.is_hotspot ? '핫스팟' : '정상';
      if (said === label) agree += 1;
      console.log(`  ${said === label ? '✓' : '·'} ${label.padEnd(3)} → ${said.padEnd(3)}  점수 ${Number(body.probability).toFixed(3)}  영역 ${String((body.bboxes ?? []).length).padStart(2)}  ${String(ms).padStart(5)}ms  ${path.basename(name)}`);
    } catch (error) { fail(`${path.basename(name)}: ${error.message}`); }
  }
  if (done) console.log(`  라벨 일치 ${agree}/${done} · 응답 시간 중앙값 ${median(times)}ms, 최대 ${Math.max(...times)}ms`);
}

async function checkWeb() {
  console.log(`\n3. 웹 서버 연결  ${webUrl}`);
  try {
    const status = await (await fetch(`${webUrl}/api/predict`, { signal: AbortSignal.timeout(5000) })).json();
    if (status.configured && status.photos) console.log(`  ✓ 사진 폴더 설정됨, 사진 ${status.photos}장`);
    else fail(`사진 폴더가 설정되지 않았습니다: ${JSON.stringify(status)}. run-web.sh의 PHOTO_DIR을 확인하세요.`);
    const response = await fetch(`${webUrl}/api/predict/A-1`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await response.json();
    if (response.ok) console.log(`  ✓ A-1 판정: ${body.is_hotspot ? '핫스팟' : '정상'} (점수 ${Number(body.probability).toFixed(3)}, ${body.photo})`);
    else fail(`A-1 판정 실패 ${response.status}: ${body.error}`);
  } catch (error) { fail(`웹 서버에 연결하지 못했습니다: ${error.message}. 웹 서버가 켜져 있는지, --web 주소를 확인하세요.`); }
}

console.log(`모델 주소: ${modelUrl}\n`);
await checkHealth();
await checkPhotos();
await checkWeb();
console.log(failed ? '\n결과: 문제가 있습니다. 위의 ✗ 항목을 확인하세요.' : '\n결과: 모두 정상입니다.');
process.exitCode = failed ? 1 : 0;
