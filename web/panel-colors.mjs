export const CELL_COLORS = Object.freeze({pending:'#172d46',no_candidate:'#087d57',caution:'#d18a12',check:'#c63038',retake:'#713bc2'});

export function selectionPanelColor({kind,live,result,previousStatus}) {
  if(kind!=='done')return CELL_COLORS.pending;
  if(!live)return CELL_COLORS[previousStatus]??CELL_COLORS.pending;
  // Arrival alone is not a clear inspection result. Wait for a successful model response.
  if(result?.state!=='ready')return CELL_COLORS.pending;
  return result.data.is_hotspot?CELL_COLORS.check:CELL_COLORS.no_candidate;
}
