import fsp from 'node:fs/promises';
import path from 'node:path';
import {pool,transaction} from './db.js';
import {UPLOAD_DIR} from './config.js';
import {isManagedVideoName} from './media-file.js';

// Trabajos persistentes: al fallar la eliminación física, la DB ya no expone
// el video pero el archivo puede ser retirado en el siguiente ciclo.
let running=false;
export async function cleanupQueuedFiles(){
  if(running)return;
  running=true;
  try{
    const jobs=await pool.query(`SELECT id FROM file_deletion_queue
      WHERE retry_after<=now() ORDER BY created_at LIMIT 25`);
    for(const job of jobs.rows){
      await transaction(async c=>{
        const r=await c.query(`SELECT id,stored_name FROM file_deletion_queue
          WHERE id=$1 FOR UPDATE SKIP LOCKED`,[job.id]);
        if(!r.rowCount)return;
        const {id,stored_name:storedName}=r.rows[0];
        const videoId=storedName.endsWith('.mp4')?storedName.slice(0,-4):'';
        if(!isManagedVideoName(storedName,videoId)){
          await c.query(`UPDATE file_deletion_queue SET last_error=$2,retry_after=now()+interval '1 day'
            WHERE id=$1`,[id,'Nombre de archivo no válido']);
          return;
        }
        // Nunca borrar si el archivo todavía pertenece a un registro de video.
        const inUse=await c.query('SELECT 1 FROM videos WHERE stored_name=$1',[storedName]);
        if(inUse.rowCount)return;
        try{
          await fsp.unlink(path.join(UPLOAD_DIR,storedName));
        }catch(e){
          if(e.code!=='ENOENT'){
            await c.query(`UPDATE file_deletion_queue SET last_error=$2,retry_after=now()+interval '2 minutes'
              WHERE id=$1`,[id,String(e.code||e.message).slice(0,240)]);
            return;
          }
        }
        await c.query('DELETE FROM file_deletion_queue WHERE id=$1',[id]);
      });
    }
  }finally{running=false;}
}
