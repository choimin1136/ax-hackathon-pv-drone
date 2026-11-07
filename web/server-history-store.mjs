export function createServerHistoryStore(onChange) {
  let records=[],error='서버 기록을 불러오는 중입니다.',pending=Promise.resolve(),revision=0,saving=false;
  const url=new URL('./api/inspection-history',document.baseURI);
  async function request(options){const response=await fetch(url,options);if(!response.ok)throw Error(response.status===409?'비행 완료 후 후보를 확인하세요.':'서버 기록을 불러오거나 저장하지 못했습니다.');return (await response.json()).records;}
  async function refresh(){if(saving)return;const version=revision;try{const next=await request();if(version!==revision)return;const changed=error||JSON.stringify(next)!==JSON.stringify(records);records=next;error='';if(changed)onChange();}catch(e){error=e.message;onChange();}}
  return {
    list:()=>structuredClone(records),error:()=>error,saving:()=>saving,refresh,
    review(id,cellId,candidates){
      const cell=records.find(r=>r.id===id)?.cells.find(c=>c.cell_id===cellId);
      const changes=candidates.filter(p=>cell?.candidates.find(c=>c.id===p.id)?.decision!==p.decision);
      if(saving)return;
      revision++;saving=true;error='서버에 저장 중입니다.';onChange();
      pending=pending.then(async()=>{
        try{for(const p of changes)records=await request({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,cellId,candidateId:p.id,decision:p.decision})});error='';}
        catch(e){error=e.message+' 변경은 저장되지 않았습니다.';}
        finally{revision++;saving=false;onChange();}
      });
    }
  };
}
