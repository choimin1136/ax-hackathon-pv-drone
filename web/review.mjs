// Candidates are the hotspot model's regions when the cell has a model result; otherwise synthetic fixtures,
// which must never be read as model predictions. Ids stay "<cell>-h<n>" so saved reviews keep working.
export function candidatesFor(cell) {
  if (cell.model) return cell.model.regions.map((region, i) => ({ id: `${cell.cell_id}-h${i + 1}`, bbox: region.bbox, area_px: region.area_px, score: region.score }));
  return Array.from({length: cell.candidate_count}, (_, i) => ({
    id: `${cell.cell_id}-h${i + 1}`, bbox: [70 + i * 130, 110 + (i % 2) * 140, 45, 55], area_px: 180 + i * 35
  }));
}
export function setDecision(reviews, cell, id, decision) {
  if (!['approved', 'excluded', 'pending'].includes(decision) || !candidatesFor(cell).some(c => c.id === id)) return reviews;
  return {...reviews, [id]: decision};
}
export function reviewSummary(cell, reviews) {
  const candidates = candidatesFor(cell);
  const approved = candidates.filter(c => reviews[c.id] === 'approved').length;
  const excluded = candidates.filter(c => reviews[c.id] === 'excluded').length;
  return {approved, excluded, pending: candidates.length - approved - excluded};
}
