// Made-up daily power figures stored with each inspection record. They are NOT meter readings or model output.
// The server saves each visited cell's loss rate when it records a flight; the page turns it into kWh with the
// capacity and utilisation assumptions, so changing an assumption updates the comparison.

// The inspection's calendar day in Korea.
export function energyDay(startedAt) {
  return new Date(new Date(startedAt).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

export function dummyEnergy({ startedAt, visited = [] }) {
  const day = energyDay(startedAt);
  const seed = [...day].reduce((sum, c) => sum + c.charCodeAt(0), 0);
  const lossPercent = Object.fromEntries(visited.map(id => [id, 3 + (seed + id.charCodeAt(0) + Number(id.split('-')[1])) % 10]));
  return { basis: 'dummy', day, lossPercent };
}

// Predicted and "measured" kWh for every visited cell of a record. Older records without saved figures get the same
// made-up values on the fly.
export function energyComparison(record, { capacity, utilization }) {
  if (!record) return null;
  const energy = record.energy ?? dummyEnergy(record);
  const ids = (record.visited ?? []).filter(id => record.targets?.includes(id) && energy.lossPercent[id] != null);
  const rows = ids.map(id => {
    const predicted = capacity * 24 * utilization / 100;
    const lossPercent = energy.lossPercent[id];
    const measured = predicted * (1 - lossPercent / 100);
    return { id, predicted, measured, difference: measured - predicted, lossPercent };
  });
  const predicted = rows.reduce((sum, r) => sum + r.predicted, 0), measured = rows.reduce((sum, r) => sum + r.measured, 0);
  return { day: energy.day, saved: Boolean(record.energy), rows, predicted, measured, difference: measured - predicted };
}
