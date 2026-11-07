import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Every value that differs between machines or may change (server paths, model address, drone speed) is set here.
// Each one reads its environment variable first and falls back to the default below; sitl/sitl.env.example lists them.
const SERVER_ROOT = '/data/hackathon';
const inRepo = relative => fileURLToPath(new URL(`../${relative}`, import.meta.url));

export const DEFAULTS = {
  // Web server
  host: '127.0.0.1',
  port: 5173,
  basePath: '',
  webRoot: inRepo('web/'),
  flightDir: inRepo('drone/sample_flight/'),
  // Hotspot model
  modelUrl: 'https://aiopen-serving.jntp-ax.or.kr/jntp-gpu/SV-5b69676e/predict',
  hotspotPattern: 'positive',
  modelTimeoutMs: 30000,
  photoListMs: 60000,
  // ArduPilot SITL and the mission program
  sitlSpeedup: '8',
  sitlBin: `${SERVER_ROOT}/ardupilot/build/sitl/bin/arducopter`,
  sitlDefaults: `${SERVER_ROOT}/ardupilot/Tools/autotest/default_params/copter.parm`,
  sitlDir: `${SERVER_ROOT}/sitl-run`,
  // ArduPilot's test field: latitude, longitude, altitude (m), heading (°).
  sitlHome: '-35.363261,149.165230,584,353',
  // drone/mission.py connects to the same port (its --connect default).
  sitlPort: 5760,
  pythonBin: `${SERVER_ROOT}/drone-venv/bin/python`,
  missionScript: inRepo('drone/mission.py')
};

const resolved = value => value ? path.resolve(value) : null;

export function webConfig(env = process.env) {
  const flightDir = resolved(env.FLIGHT_DIR) ?? DEFAULTS.flightDir;
  return {
    host: env.HOST ?? DEFAULTS.host,
    port: Number(env.PORT ?? DEFAULTS.port),
    basePath: env.BASE_PATH ?? DEFAULTS.basePath,
    flightDir,
    historyFile: resolved(env.HISTORY_FILE) ?? path.join(flightDir, 'inspection-history.json')
  };
}

export function modelConfig(env = process.env) {
  return {
    url: env.MODEL_URL ?? DEFAULTS.modelUrl,
    photoDir: resolved(env.PHOTO_DIR),
    hotspotPattern: env.HOTSPOT_PHOTO_PATTERN ?? DEFAULTS.hotspotPattern,
    timeoutMs: DEFAULTS.modelTimeoutMs,
    photoListMs: DEFAULTS.photoListMs
  };
}

export function sitlConfig(env = process.env) {
  return {
    speedup: env.SITL_SPEEDUP ?? DEFAULTS.sitlSpeedup,
    bin: env.SITL_BIN ?? DEFAULTS.sitlBin,
    defaults: env.SITL_DEFAULTS ?? DEFAULTS.sitlDefaults,
    dir: env.SITL_DIR ?? DEFAULTS.sitlDir,
    home: env.SITL_HOME ?? DEFAULTS.sitlHome,
    port: DEFAULTS.sitlPort,
    python: env.PYTHON_BIN ?? DEFAULTS.pythonBin,
    missionScript: env.MISSION_SCRIPT ?? DEFAULTS.missionScript
  };
}

// One line for the start-up log, so the running settings can be checked at a glance.
export function describeConfig(env = process.env) {
  const web = webConfig(env), model = modelConfig(env), sitl = sitlConfig(env);
  return `Config: port ${web.port}${web.basePath ? ` base ${web.basePath}` : ''} · model ${model.url} · photos ${model.photoDir ?? '(none)'} · SITL ${sitl.speedup}x`;
}
