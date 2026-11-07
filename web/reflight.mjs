import { ROUTE } from './mission.mjs';

export function createReflight(targets = []) {
  return { targets: ROUTE.filter(id => targets.includes(id)), phase: 'idle', index: 0, activeId: null, elapsed: 0 };
}
export function startReflight(state) {
  if (!state.targets.length) return state;
  if (state.phase === 'complete') state = createReflight(state.targets);
  return { ...state, phase: 'running' };
}
export function pauseReflight(state) {
  return state.phase === 'running' ? { ...state, phase: 'paused' } : state;
}
export function tickReflight(state) {
  if (state.phase !== 'running') return state;
  const elapsed = state.elapsed + 1;
  if (!state.activeId) return { ...state, elapsed, activeId: state.targets[state.index] };
  const index = state.index + 1;
  return { ...state, elapsed, index, activeId: null, phase: index === state.targets.length ? 'complete' : 'running' };
}
