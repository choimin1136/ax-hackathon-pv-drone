// Synthetic fixtures only: these values are not model predictions or field measurements.
export const STATUS = {
  pending: { label: '대기', symbol: '·', action: '미션을 시작해 이 구역의 점검을 진행하세요.' },
  no_candidate: { label: '탐지된 후보 없음', symbol: '✓', action: '이번 예시 분석에서 후보가 탐지되지 않았습니다. 안전을 보증하는 결과는 아닙니다.' },
  caution: { label: '주의', symbol: '△', action: '후보를 확인하고 재점검 여부를 판단하세요.' },
  check: { label: '점검 권장', symbol: '!', action: '근거 사진을 확인한 뒤 점검·정비 여부를 결정하세요.' },
  retake: { label: '재촬영 필요', symbol: '↻', action: '예시 사진 전송 실패 구역입니다. 사진을 다시 확보해야 합니다.' }
};
const examples = { 'A-3': ['caution', 1], 'B-2': ['check', 3], 'B-5': ['caution', 2], 'C-4': ['check', 4], 'C-6': ['retake', 0], 'D-1': ['caution', 1], 'D-3': ['caution', 2], 'D-5': ['check', 3] };
export const CELL_IDS = ['A', 'B', 'C', 'D'].flatMap(row => Array.from({ length: 6 }, (_, col) => `${row}-${col + 1}`));
export const ROUTE = ['A', 'B', 'C', 'D'].flatMap((row, index) => {
  const cols = [1, 2, 3, 4, 5, 6];
  return (index % 2 ? cols.reverse() : cols).map(col => `${row}-${col}`);
});
export function createMission() {
  return { phase: 'idle', index: 0, activeId: null, elapsed: 0, cells: CELL_IDS.map(cell_id => ({ cell_id, status: 'pending', candidate_count: 0, confirmed_count: 0 })), events: [] };
}
export function startMission(state) {
  if (state.phase === 'complete') state = createMission();
  return { ...state, phase: 'running' };
}
export function pauseMission(state) {
  return state.phase === 'running' ? { ...state, phase: 'paused' } : state;
}
export function tickMission(state) {
  if (state.phase !== 'running') return state;
  const elapsed = state.elapsed + 1;
  if (!state.activeId) return { ...state, elapsed, activeId: ROUTE[state.index] };
  const id = state.activeId;
  const [status, candidate_count] = examples[id] ?? ['no_candidate', 0];
  const index = state.index + 1;
  const event = { cell_id: id, status, elapsed, candidate_count };
  return { ...state, elapsed, index, activeId: null, phase: index === ROUTE.length ? 'complete' : 'running', cells: state.cells.map(cell => cell.cell_id === id ? { ...cell, status, candidate_count } : cell), events: [event, ...state.events] };
}
// Builds the same mission state from a real flight, so cells show their example result once the drone has arrived.
export function missionFromFlight(visited, activeId, finished, flying, elapsed = 0) {
  const done = new Set(visited.filter(id => id !== activeId));
  const events = [...done].reverse().map(cell_id => {
    const [status, candidate_count] = examples[cell_id] ?? ['no_candidate', 0];
    return { cell_id, status, elapsed, candidate_count };
  });
  return {
    phase: finished ? 'complete' : flying ? 'running' : 'paused',
    index: done.size,
    activeId,
    elapsed,
    cells: CELL_IDS.map(cell_id => {
      if (!done.has(cell_id)) return { cell_id, status: 'pending', candidate_count: 0, confirmed_count: 0 };
      const [status, candidate_count] = examples[cell_id] ?? ['no_candidate', 0];
      return { cell_id, status, candidate_count, confirmed_count: 0 };
    }),
    events
  };
}
export function summarize(state) {
  return { completed: state.index, clear: state.cells.filter(c => c.status === 'no_candidate').length, review: state.cells.filter(c => c.status === 'caution' || c.status === 'check').length, retake: state.cells.filter(c => c.status === 'retake').length };
}
