import http from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSitlControl } from './sitl-control.mjs';
import { createInspectionHistory } from './inspection-history.mjs';
import { createPredictor } from './predict.mjs';

const DEFAULT_WEB = fileURLToPath(new URL('../web/', import.meta.url));
const DEFAULT_FLIGHTS = fileURLToPath(new URL('../drone/sample_flight/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8' };
const MISSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_BODY = 1024;

// A flight in progress can leave a half-written last line, so unreadable lines are skipped.
export function parseFlight(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* partial line */ }
  }
  return rows;
}

export function summarizeFlight(missionId, rows) {
  const start = rows.find(row => row.type === 'mission_start');
  const end = rows.find(row => row.type === 'mission_end');
  const frames = rows.filter(row => row.type === 'frame');
  return {
    mission_id: missionId,
    cells: start?.cells ?? [],
    complete: Boolean(end),
    duration_s: rows.at(-1)?.t ?? 0,
    positions: rows.filter(row => row.type === 'position').map(({ t, position, heading, battery, roll, pitch }) => ({ t, ...position, heading, battery, roll, pitch })),
    frames: frames.map(({ t, cell_id, waypoint, source_photo, position, battery }) => ({ t, cell_id, waypoint, source_photo, position, battery })),
    logs: rows.filter(row => row.type === 'log').map(({ t, source, text }) => ({ t, source, text }))
  };
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let text = '';
    req.on('data', chunk => {
      text += chunk;
      if (text.length > MAX_BODY) { reject(new Error('too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(text ? JSON.parse(text) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

function sendJson(res, status, body, head) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(head ? undefined : JSON.stringify(body));
}

export function createApp({ webRoot = DEFAULT_WEB, flightDir = DEFAULT_FLIGHTS, historyFile = path.join(flightDir,'inspection-history.json'), basePath = '', sitlEnv = process.env, sitlHooks = {}, sitlArgsForTest, predictor = createPredictor() } = {}) {
  const base = basePath.replace(/\/+$/, '');
  const sitl = createSitlControl({ flightDir, env: sitlEnv, sitlArgs: sitlArgsForTest, ...sitlHooks });
  const history = createInspectionHistory({file:historyFile,flightDir});
  const poll=setInterval(()=>history.list().catch(error=>console.error('History persistence failed:',error.message)),1000);poll.unref();
  const actions = { start: () => sitl.start(), stop: () => sitl.stop(), fly: body => sitl.fly(body.cells ?? null) };
  const app = http.createServer(async (req, res) => {
    const head = req.method === 'HEAD';
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch { res.writeHead(400); res.end(); return; }

    // The public proxy forwards its path prefix. Without the trailing slash, relative assets would break.
    if (base && pathname === base) { res.writeHead(301, { Location: `${base}/` }); res.end(); return; }
    if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length);

    if(pathname==='/api/inspection-history'){
      try {
        if(req.method==='GET'||head)return sendJson(res,200,{records:await history.list()},head);
        if(req.method==='PATCH') {const b=await readJson(req);return sendJson(res,200,{records:await history.review(b.id,b.cellId,b.candidateId,b.decision)});}
        if(req.method==='DELETE') {const b=await readJson(req);return sendJson(res,200,{records:await history.remove(b.id)});}
        return sendJson(res,405,{error:'method not allowed'});
      } catch(error){return sendJson(res,error.status??500,{error:error.status?error.message:'history storage unavailable'});}
    }

    const control = pathname.match(/^\/api\/sitl\/([a-z]+)$/);
    if (control && req.method === 'POST') {
      const action = actions[control[1]];
      if (!action) return sendJson(res, 404, { error: 'not found' });
      try {
        if(control[1]==='fly')await history.list(); // Persist the previous live file before SITL replaces it.
        const result = await action(await readJson(req));
        return sendJson(res, result.status ?? 200, result);
      } catch { return sendJson(res, 400, { error: 'bad request' }); }
    }
    if (req.method !== 'GET' && !head) { res.writeHead(405); res.end(); return; }
    if (pathname === '/api/sitl/status') return sendJson(res, 200, await sitl.status(), head);
    if (control) { res.writeHead(405); res.end(); return; }

    if (pathname === '/api/health') return sendJson(res, 200, { ok: true }, head);
    if (pathname === '/api/predict') return sendJson(res, 200, await predictor.status(), head);
    const cell = pathname.match(/^\/api\/predict\/([^/]+)$/);
    if (cell) {
      const result = await predictor.predict(cell[1]);
      return sendJson(res, result.status ?? 200, result, head);
    }
    if (pathname === '/api/missions') {
      const files = await readdir(flightDir).catch(() => []);
      const missions = files.filter(name => name.endsWith('.jsonl')).map(name => name.slice(0, -'.jsonl'.length)).filter(id => MISSION_ID.test(id)).sort();
      return sendJson(res, 200, { missions }, head);
    }
    const mission = pathname.match(/^\/api\/missions\/([^/]+)$/);
    if (mission) {
      if (!MISSION_ID.test(mission[1])) return sendJson(res, 400, { error: 'invalid mission id' }, head);
      try {
        const text = await readFile(path.join(flightDir, `${mission[1]}.jsonl`), 'utf8');
        return sendJson(res, 200, summarizeFlight(mission[1], parseFlight(text)), head);
      } catch { return sendJson(res, 404, { error: 'mission not found' }, head); }
    }
    if (pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' }, head);

    // Serve only web assets; never expose the repository, credentials, or data folders.
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const resolved = path.resolve(webRoot, relative);
    const type = TYPES[path.extname(resolved)];
    if (!resolved.startsWith(webRoot) || !type) { res.writeHead(404); res.end('Not found'); return; }
    try {
      const content = await readFile(resolved);
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(head ? undefined : content);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  app.on('close',()=>clearInterval(poll));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 5173);
  const host = process.env.HOST ?? '127.0.0.1';
  const app = createApp({ flightDir: process.env.FLIGHT_DIR ? path.resolve(process.env.FLIGHT_DIR) : DEFAULT_FLIGHTS, ...(process.env.HISTORY_FILE ? {historyFile:path.resolve(process.env.HISTORY_FILE)} : {}), basePath: process.env.BASE_PATH ?? '' });
  app.on('error', error => { console.error(`Server failed: ${error.message}`); process.exitCode = 1; });
  app.listen(port, host, () => console.log(`Server: http://${host}:${port}`));
}
