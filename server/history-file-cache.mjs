import {readFile,stat} from 'node:fs/promises';

// Copy mutable JSON containers, but share immutable strings (large base64 images).
function copyJson(value) {
  if(Array.isArray(value))return value.map(copyJson);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,copyJson(item)]));
  return value;
}

export function createHistoryFileCache(file,{read=readFile,inspect=stat}={}) {
  let cached=null;
  const stampOf=async()=>{const info=await inspect(file,{bigint:true});return [info.dev,info.ino,info.size,info.mtimeNs,info.ctimeNs].join(':');};
  return {
    invalidate(){cached=null;},
    // After this process wrote the file, keep what it wrote instead of reading and parsing it again.
    async remember(records){try{cached={stamp:await stampOf(),records:copyJson(records)};}catch{cached=null;}},
    async load(){
      try{
        const stamp=await stampOf();
        if(!cached||cached.stamp!==stamp){
          const records=JSON.parse(await read(file,'utf8'));
          cached={stamp,records};
        }
        // Callers may mutate a working copy; unsuccessful writes cannot alter the cache.
        return copyJson(cached.records);
      }catch(error){
        cached=null;
        if(error.code==='ENOENT')return [];
        throw error;
      }
    }
  };
}
