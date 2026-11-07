// Pure calculations for the analysis page's planned-feature previews (tested without a browser).
export const TREND_RUNS = 5;
const PRIORITY_ROWS = 5;
const SKY = [['맑음', 0], ['구름 조금', 1], ['흐림', 2], ['비', 3]];

const usable = records => records.filter(r => !r.deletedAt && ['complete', 'interrupted'].includes(r.phase));
const byStart = (a, b) => new Date(a.startedAt) - new Date(b.startedAt);

// Hotspot cells of the latest full inspection, approved findings first, then by candidate area × region score.
export function priorityCells(records) {
  const latest = usable(records).filter(r => r.kind === 'full').sort(byStart).at(-1);
  if (!latest) return { record: null, rows: [] };
  const rows = latest.cells.filter(cell => cell.status === 'check').map(cell => {
    const candidates = cell.candidates ?? [];
    const approved = candidates.filter(c => c.decision === 'approved');
    const weight = (approved.length ? approved : candidates).reduce((sum, c) => sum + (c.area_px ?? 0) * (c.score ?? 0.5), 0);
    const largest = Math.max(0, ...candidates.map(c => c.area_px ?? 0));
    return { cell_id: cell.cell_id, approved: approved.length, candidates: candidates.length, largest, weight };
  }).sort((a, b) => (b.approved > 0) - (a.approved > 0) || b.weight - a.weight);
  return { record: latest, rows: rows.slice(0, PRIORITY_ROWS) };
}

// Each cell's result over the last few inspections that visited it; cells found more than once come first.
export function cellTrends(records) {
  const runs = usable(records).sort(byStart).slice(-TREND_RUNS);
  const ids = [...new Set(runs.flatMap(r => r.cells.map(c => c.cell_id)))];
  const rows = ids.map(cell_id => {
    const marks = runs.map(r => r.visited?.includes(cell_id) ? r.cells.find(c => c.cell_id === cell_id)?.status ?? 'pending' : null);
    return { cell_id, marks, hits: marks.filter(m => m === 'check').length };
  }).filter(row => row.hits > 0).sort((a, b) => b.hits - a.hits || a.cell_id.localeCompare(b.cell_id, 'en', { numeric: true }));
  return { runs, rows };
}

// Five made-up days from the given date; the same date always gives the same week.
export function weatherWeek(from = new Date()) {
  const days = Array.from({ length: 5 }, (_, i) => {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    const seed = (date.getFullYear() * 372 + date.getMonth() * 31 + date.getDate()) % 97;
    const [sky, cloud] = SKY[seed % SKY.length];
    const wind = 1 + (seed * 7) % 9;
    return { date, sky, wind, score: cloud * 3 + wind };
  });
  const best = days.filter(d => d.sky !== '비').sort((a, b) => a.score - b.score)[0] ?? null;
  return { days, best };
}
