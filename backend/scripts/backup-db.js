import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.DATABASE_URL)throw new Error('Falta backend/.env con DATABASE_URL');
const db=new URL(process.env.DATABASE_URL);
if(!['postgresql:','postgres:'].includes(db.protocol))throw new Error('DATABASE_URL no es PostgreSQL');
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const dest=path.join(root,'backups',`TVM_${stamp}.dump`);
await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});
async function findPgDump(){
  if(process.env.PG_DUMP_PATH)return process.env.PG_DUMP_PATH;
  if(process.platform==='win32'){
    const programFiles=process.env.ProgramFiles||'C:/Program Files';
    const root=path.join(programFiles,'PostgreSQL');
    try{
      const versions=(await fs.readdir(root)).filter(v=>/^\d+$/.test(v)).sort((a,b)=>Number(b)-Number(a));
      for(const version of versions){
        const candidate=path.join(root,version,'bin','pg_dump.exe');
        try{await fs.access(candidate);return candidate;}catch{}
      }
    }catch{}
  }
  return 'pg_dump';
}
const bin=await findPgDump();
const args=['--host',db.hostname,'--port',db.port||'5432','--username',decodeURIComponent(db.username),
  '--format=custom','--no-password','--file',dest,decodeURIComponent(db.pathname.replace(/^\//,''))];
console.log('Iniciando respaldo de la base PostgreSQL...');
try {
  const exitCode=await new Promise((resolve,reject)=>{
    const child=spawn(bin,args,{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PGPASSWORD:decodeURIComponent(db.password)}});
    let err='';child.stderr.on('data',chunk=>{err+=chunk.toString().slice(0,2000)});
    child.once('error',reject);child.once('close',code=>code===0?resolve(code):reject(new Error('pg_dump falló (código '+code+'): '+err)));
  });
  const size=(await fs.stat(dest)).size;
  if(size<100)throw new Error('El respaldo está vacío o incompleto');
  console.log('Respaldo creado:',dest,'('+Math.round(size/1024)+' KB)');
} catch(e){await fs.unlink(dest).catch(()=>{});console.error('No se pudo completar el respaldo:',e.code==='ENOENT'?'No se encontró pg_dump. Agregá PostgreSQL/bin al PATH o configurá PG_DUMP_PATH.':e.message);process.exitCode=1;}
