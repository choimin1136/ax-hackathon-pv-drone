import { execFile, spawn } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = '/data/hackathon';
const CELLS = /^[A-D]-[1-6](,[A-D]-[1-6]){0,23}$/;
export const LIVE_ID = 'live';
const SITL_PORT = 5760;
const STAGE_LINES = [['armed', 'takeoff'], ['mission uploaded', 'arming'], ['home ready', 'mission']];

function pgrep() {
  return new Promise(resolve => execFile('pgrep', ['-x', 'arducopter'], error => resolve(!error)));
}
// SITL waits for its first connection before it runs, so this one check also starts the simulation clock.
function portOpen() {
  return new Promise(resolve => {
    const socket = net.connect(SITL_PORT, '127.0.0.1');
    const finish = open => { socket.destroy(); resolve(open); };
    socket.setTimeout(1000, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });
}
function pkill() {
  return new Promise(resolve => execFile('pkill', ['-x', 'arducopter'], () => resolve()));
}

// Starts and stops ArduPilot SITL and the mission program on the server. Paths are fixed by the operator's environment.
export function createSitlControl({ flightDir, env = process.env, findSitl = pgrep, killSitl = pkill, probe = portOpen, sitlArgs }) {
  const speedup = env.SITL_SPEEDUP ?? '8';
  const sitlBin = env.SITL_BIN ?? `${ROOT}/ardupilot/build/sitl/bin/arducopter`;
  const sitlDefaults = env.SITL_DEFAULTS ?? `${ROOT}/ardupilot/Tools/autotest/default_params/copter.parm`;
  const sitlDir = env.SITL_DIR ?? `${ROOT}/sitl-run`;
  const python = env.PYTHON_BIN ?? `${ROOT}/drone-venv/bin/python`;
  const script = env.MISSION_SCRIPT ?? fileURLToPath(new URL('../drone/mission.py', import.meta.url));
  let sitlChild = null, missionChild = null, missionResult = 'idle', ready = false, stage = null;

  const launch = (bin, args, options, onExit) => {
    const child = spawn(bin, args, { stdio: 'ignore', ...options });
    child.on('error', error => { console.error(`Failed to start ${path.basename(bin)}: ${error.message}`); onExit(1); });
    child.on('exit', code => onExit(code));
    return child;
  };

  async function status() {
    const sitl = Boolean(sitlChild) || await findSitl();
    if (!sitl) ready = false;
    else if (!ready && !missionChild) ready = await probe();
    return { speedup: Number(speedup), sitl, ready: ready || Boolean(missionChild), flying: Boolean(missionChild), mission: missionResult, stage: missionChild ? stage : null };
  }
  async function start() {
    if ((await status()).sitl) return status();
    await mkdir(sitlDir, { recursive: true });
    sitlChild = launch(sitlBin, sitlArgs ?? ['--model', '+', '--speedup', speedup, '--defaults', sitlDefaults, '-I0', '--home', '-35.363261,149.165230,584,353'], { cwd: sitlDir }, () => { sitlChild = null; });
    return status();
  }
  async function stop() {
    missionChild?.kill();
    sitlChild?.kill();
    await killSitl();
    ready = false;
    return { ...(await status()), sitl: false, ready: false };
  }
  async function fly(cells) {
    if (cells != null && !CELLS.test(cells)) return { error: 'invalid cells', status: 400 };
    const current = await status();
    if (!current.sitl) return { error: 'sitl off', status: 409 };
    if (current.flying) return { error: 'already flying', status: 409 };
    if (!current.ready) return { error: 'sitl starting', status: 409 };
    await unlink(path.join(flightDir, `${LIVE_ID}.jsonl`)).catch(() => {});
    const args = [script, '--mission-id', LIVE_ID, '--out-dir', flightDir, ...(cells ? ['--cells', cells] : [])];
    missionResult = 'flying';
    stage = 'gps';
    missionChild = launch(python, args, { stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env, PYTHONUNBUFFERED: '1' } }, code => {
      missionChild = null;
      stage = null;
      missionResult = code === 0 ? 'done' : 'failed';
    });
    // The mission program prints each step before the record file exists, so the page can show progress.
    missionChild.stdout?.on('data', chunk => {
      const text = String(chunk);
      if (/^이륙 완료/m.test(text)) stage = null;
      else for (const [line, next] of STAGE_LINES) if (new RegExp(`^${line}`, 'm').test(text)) { stage = next; break; }
    });
    return status();
  }
  return { status, start, stop, fly };
}
