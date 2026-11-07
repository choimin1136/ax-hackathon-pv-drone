import { execFile, spawn } from 'node:child_process';
import { mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = '/data/hackathon';
const CELLS = /^[A-D]-[1-6](,[A-D]-[1-6]){0,23}$/;
export const LIVE_ID = 'live';

function pgrep() {
  return new Promise(resolve => execFile('pgrep', ['-x', 'arducopter'], error => resolve(!error)));
}
function pkill() {
  return new Promise(resolve => execFile('pkill', ['-x', 'arducopter'], () => resolve()));
}

// Starts and stops ArduPilot SITL and the mission program on the server. Paths are fixed by the operator's environment.
export function createSitlControl({ flightDir, env = process.env, findSitl = pgrep, killSitl = pkill, sitlArgs }) {
  const speedup = env.SITL_SPEEDUP ?? '5';
  const sitlBin = env.SITL_BIN ?? `${ROOT}/ardupilot/build/sitl/bin/arducopter`;
  const sitlDefaults = env.SITL_DEFAULTS ?? `${ROOT}/ardupilot/Tools/autotest/default_params/copter.parm`;
  const sitlDir = env.SITL_DIR ?? `${ROOT}/sitl-run`;
  const python = env.PYTHON_BIN ?? `${ROOT}/drone-venv/bin/python`;
  const script = env.MISSION_SCRIPT ?? fileURLToPath(new URL('../drone/mission.py', import.meta.url));
  let sitlChild = null, missionChild = null, missionResult = 'idle';

  const launch = (bin, args, options, onExit) => {
    const child = spawn(bin, args, { stdio: 'ignore', ...options });
    child.on('error', error => { console.error(`Failed to start ${path.basename(bin)}: ${error.message}`); onExit(1); });
    child.on('exit', code => onExit(code));
    return child;
  };

  async function status() {
    return { speedup: Number(speedup), sitl: Boolean(sitlChild) || await findSitl(), flying: Boolean(missionChild), mission: missionResult };
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
    return { ...(await status()), sitl: false };
  }
  async function fly(cells) {
    if (cells != null && !CELLS.test(cells)) return { error: 'invalid cells', status: 400 };
    const current = await status();
    if (!current.sitl) return { error: 'sitl off', status: 409 };
    if (current.flying) return { error: 'already flying', status: 409 };
    await unlink(path.join(flightDir, `${LIVE_ID}.jsonl`)).catch(() => {});
    const args = [script, '--mission-id', LIVE_ID, '--out-dir', flightDir, ...(cells ? ['--cells', cells] : [])];
    missionResult = 'flying';
    missionChild = launch(python, args, {}, code => {
      missionChild = null;
      missionResult = code === 0 ? 'done' : 'failed';
    });
    return status();
  }
  return { status, start, stop, fly };
}
