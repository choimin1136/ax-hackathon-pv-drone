// Capture every visited cell independently of which dashboard page is open.
// Only the current live file is eligible; archived flights are never re-analysed.
export function createPredictionRecorder({history,predictor,now=Date.now,retryMs=10000}) {
  let pending=null;
  const retryAfter=new Map();
  async function collect() {
    if(predictor.status && !(await predictor.status()).configured)return;
    const records=await history.list();
    for(const record of records.filter(r=>r.sourceFile==='live.jsonl')) {
      for(const cellId of record.visited) {
        if(!record.targets.includes(cellId)||record.cells.find(c=>c.cell_id===cellId)?.model)continue;
        const key=record.id+':'+cellId;
        if((retryAfter.get(key)??0)>now())continue;
        // Re-check before each request, including after a slow model response.
        if(await history.predictionTarget(cellId)!==record.id)continue;
        try {
          const result=await predictor.predict(cellId);
          if(result.status||!result.photo){retryAfter.set(key,now()+retryMs);continue;}
          await history.savePrediction(record.id,cellId,result);
          retryAfter.delete(key);
        }catch {retryAfter.set(key,now()+retryMs);}
      }
    }
  }
  return {sync(){if(!pending)pending=collect().finally(()=>{pending=null;});return pending;}};
}
