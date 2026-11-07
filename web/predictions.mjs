import { exampleResult } from './mission.mjs';

// Asks the web server for the hotspot model's result of each cell the drone reaches, once per cell and flight.
// When the server has no photos or the model fails, the cell falls back to its example result.
export function createPredictions(onChange) {
  let results = new Map();
  function peek(cellId) {
    if (!results.has(cellId)) {
      const own = results;
      own.set(cellId, { state: 'loading' });
      // A reply that arrives after the next flight started belongs to the old photos and is dropped.
      fetch(`./api/predict/${encodeURIComponent(cellId)}`)
        .then(async response => {
          const body = await response.json().catch(() => ({}));
          own.set(cellId, response.ok ? { state: 'ready', data: body } : { state: 'fallback', reason: body.error });
        })
        .catch(() => own.set(cellId, { state: 'fallback', reason: 'network' }))
        .finally(() => { if (own === results) onChange(cellId); });
    }
    return results.get(cellId);
  }
  return {
    peek,
    clear() { results = new Map(); },
    resultOf(cellId) {
      const result = peek(cellId);
      if (result.state === 'loading') return null;
      // Regions below the image-level threshold are not candidates, so a cell without a hotspot has none.
      if (result.state === 'ready') return result.data.is_hotspot ? ['check', result.data.regions.length] : ['no_candidate', 0];
      return exampleResult(cellId);
    }
  };
}
