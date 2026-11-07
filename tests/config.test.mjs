import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { DEFAULTS, describeConfig, modelConfig, sitlConfig, webConfig } from '../server/config.mjs';

test('settings fall back to the defaults when nothing is set', () => {
  const web = webConfig({});
  assert.deepEqual([web.host, web.port, web.basePath, web.flightDir], ['127.0.0.1', 5173, '', DEFAULTS.flightDir]);
  assert.equal(web.historyFile, path.join(DEFAULTS.flightDir, 'inspection-history.json'));
  assert.deepEqual(modelConfig({}), { url: DEFAULTS.modelUrl, photoDir: null, hotspotPattern: 'positive', timeoutMs: 30000, photoListMs: 60000 });
  const sitl = sitlConfig({});
  assert.deepEqual([sitl.speedup, sitl.port, sitl.home], ['8', 5760, '-35.363261,149.165230,584,353']);
  assert.match(sitl.missionScript, /drone[\\/]mission\.py$/);
});

test('environment variables override each setting', () => {
  const env = { HOST: '0.0.0.0', PORT: '8501', BASE_PATH: '/i/x', FLIGHT_DIR: '/tmp/f', MODEL_URL: 'http://m/predict', PHOTO_DIR: '/data/test', HOTSPOT_PHOTO_PATTERN: 'hot', SITL_SPEEDUP: '4', SITL_HOME: '1,2,3,4', PYTHON_BIN: '/py' };
  const web = webConfig(env);
  assert.deepEqual([web.host, web.port, web.basePath, web.historyFile], ['0.0.0.0', 8501, '/i/x', path.join(path.resolve('/tmp/f'), 'inspection-history.json')]);
  assert.deepEqual([modelConfig(env).url, modelConfig(env).photoDir, modelConfig(env).hotspotPattern], ['http://m/predict', path.resolve('/data/test'), 'hot']);
  assert.deepEqual([sitlConfig(env).speedup, sitlConfig(env).home, sitlConfig(env).python], ['4', '1,2,3,4', '/py']);
  assert.equal(describeConfig(env), 'Config: port 8501 base /i/x · model http://m/predict · photos ' + path.resolve('/data/test') + ' · SITL 4x');
});
