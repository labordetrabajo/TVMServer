import fsp from 'node:fs/promises';
export function sumVideoBytes(rows){ return rows.reduce((total,r)=>total+Number(r.bytes||0),0); }
export function volumeStats(stat){
  const size=Number(stat?.bsize||0), total=Number(stat?.blocks||0), available=Number(stat?.bavail||0);
  if(!size||!total)return null;
  return {totalBytes:size*total,freeBytes:size*available};
}
export async function availableSpace(uploadDir){
  try{return volumeStats(await fsp.statfs(uploadDir));}catch{return null;}
}
