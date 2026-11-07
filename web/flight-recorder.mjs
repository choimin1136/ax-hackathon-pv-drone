import {CELL_IDS} from './mission.mjs';
export function createFlightRecorder(store) {
  const tracks={full:{phase:'idle',id:null},selection:{phase:'idle',id:null}};
  return (state,flight,cells,source)=>{
    let changed=false;
    for(const [kind,next] of [['full',state],['selection',flight]]) {
      const track=tracks[kind];
      const targets=kind==='full'?CELL_IDS:next.targets;
      if(next.phase==='running'&&['idle','complete'].includes(track.phase)) {
        track.id=store.begin({kind,source,targets,cells});changed=true;
      }
      const saved=store.list().find(r=>r.id===track.id);
      if(saved&&!['complete','interrupted'].includes(saved.phase)) {
        const phase=next.phase==='idle'?'interrupted':next.phase;
        const visited=next.phase==='idle'?saved.visited:kind==='full'?cells.filter(c=>c.status!=='pending').map(c=>c.cell_id):targets.slice(0,next.index);
        store.update(track.id,{phase,visited,cells:next.phase==='idle'||kind==='selection'?saved.cells:cells});changed=true;
      }
      if(next.phase==='idle')track.id=null;
      track.phase=next.phase;
    }
    return changed;
  };
}
