import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import { pool, transaction } from './db.js';
import { UPLOAD_DIR } from './config.js';
import { newId, sha256 } from './helpers.js';
import { isManagedVideoName } from './media-file.js';
import { reconcileSchedule } from './scheduling.js';

export const uuid = v=>typeof v==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
export const validDisk = v=>Number.isSafeInteger(v) && v>=0 && v<1e15;
export const validInventory = files=>Array.isArray(files) && files.length<=500 &&
  files.every(x=>x && uuid(x.videoId) && validDisk(x.bytes)) && new Set(files.map(x=>x.videoId)).size===files.length;

const fileById = id=>`tvm-${id.toLowerCase()}.mp4`;
const deviceStatus=(t)=>{
  if(!t.last_seen)return 'sin_conectar';
  return (Date.now()-new Date(t.last_seen).getTime())<180000?'online':'offline';
};

// Una clave se emite solo una vez, nunca se registra en logs, ni se guarda en texto plano.
async function deviceAuth(req,res,next){
  try{
    const bearer=req.get('authorization')||'';
    if(!/^Bearer [a-f0-9]{64}$/i.test(bearer))return res.status(401).json({error:'Tótem sin vincular'});
    const hashed=sha256(bearer.slice(7).toLowerCase());
    const r=await pool.query('SELECT id,code,client_id,playlist_version,device_cleanup_generation FROM totems WHERE device_token_hash=$1',[hashed]);
    if(!r.rowCount)return res.status(401).json({error:'Credencial inválida o revocada'});
    req.device=r.rows[0];next();
  }catch(e){next(e)}
}

async function allowedMedia(totemId, clientId){
  // Sólo contenido autorizado para ESTE tótem y precarga futura limitada a 7 días.
  const r=await pool.query(`SELECT v.id,v.original_name,v.stored_name,v.bytes,v.sha256,
      'manual'::text AS source,NULL::timestamptz AS starts_at,NULL::timestamptz AS ends_at,p.position AS position
      FROM playlist_items p JOIN videos v ON v.id=p.video_id
      WHERE p.totem_id=$1 AND v.client_id=$2 AND v.status='approved'
    UNION ALL
    SELECT v.id,v.original_name,v.stored_name,v.bytes,v.sha256,
      'scheduled'::text AS source,s.starts_at,s.ends_at,
      (100000+row_number() OVER(ORDER BY s.starts_at,s.id))::int AS position
      FROM scheduled_publications s JOIN videos v ON v.id=s.video_id
      WHERE s.totem_id=$1 AND v.client_id=$2 AND v.status='approved'
        AND s.status IN ('scheduled','active') AND s.starts_at <= now() + interval '7 days'
        AND (s.ends_at IS NULL OR s.ends_at > now())
      ORDER BY position`,[totemId,clientId]);
  return r.rows;
}

async function hashIfMissing(v){
  if(v.sha256)return v.sha256;
  if(!isManagedVideoName(v.stored_name,v.id))throw Error('Nombre de archivo no válido para el tótem');
  const pathname=path.join(UPLOAD_DIR,v.stored_name);
  const st=await fs.promises.lstat(pathname);
  if(!st.isFile() || st.isSymbolicLink() || st.size!==Number(v.bytes))throw Error('MP4 faltante o con tamaño distinto en servidor');
  const hash=crypto.createHash('sha256');
  for await(const chunk of createReadStream(pathname))hash.update(chunk);
  const digest=hash.digest('hex');
  await pool.query('UPDATE videos SET sha256=COALESCE(sha256,$2) WHERE id=$1',[v.id,digest]);
  return digest;
}

export function registerDeviceRoutes(app,{auth,adminOnly}){
  app.post('/api/admin/totems/:id/pair',auth,adminOnly,async(req,res,next)=>{
    try{
      if(!uuid(req.params.id))return res.status(400).json({error:'Tótem inválido'});
      if(req.body?.confirm!==true)return res.status(400).json({error:'Confirmá la vinculación. Una clave anterior dejará de funcionar.'});
      const token=crypto.randomBytes(32).toString('hex');
      const r=await pool.query(`UPDATE totems SET device_token_hash=$2,last_seen=NULL,
        device_synced_version=NULL,device_last_error=NULL WHERE id=$1 RETURNING id,code`,[req.params.id,sha256(token)]);
      if(!r.rowCount)return res.status(404).json({error:'Tótem inexistente'});
      // Si se extravía, emitir otra clave. Nunca se vuelve a mostrar.
      res.json({ok:true,code:r.rows[0].code,token});
    }catch(e){next(e)}
  });
  app.get('/api/admin/totems/:id/files',auth,adminOnly,async(req,res,next)=>{
    try{
      if(!uuid(req.params.id))return res.status(400).json({error:'Tótem inválido'});
      const r=await pool.query(`SELECT t.id,t.code,t.device_files,t.device_disk_total,t.device_disk_used,
        t.device_disk_free,t.device_video_bytes,t.device_reported_at,t.last_seen,
        t.device_cleanup_generation,t.device_cleanup_ack,t.device_synced_version,t.device_last_error,t.playlist_version
        FROM totems t WHERE t.id=$1`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Tótem inexistente'});
      const t=r.rows[0], files=Array.isArray(t.device_files)?t.device_files:[];
      const videoIds=files.filter(f=>uuid(f.videoId)).map(f=>f.videoId);
      let names=new Map();
      if(videoIds.length){const videos=await pool.query('SELECT id,original_name FROM videos WHERE id=ANY($1::uuid[])',[videoIds]);names=new Map(videos.rows.map(v=>[v.id,v.original_name]));}
      res.json({totem:{...t,connectionStatus:deviceStatus(t),files:files.map(f=>({videoId:f.videoId,bytes:f.bytes,name:names.get(f.videoId)||`Archivo ${String(f.videoId).slice(0,8)} (sin registro en servidor)`}))}});
    }catch(e){next(e)}
  });
  app.post('/api/admin/totems/:id/videos/:videoId/remove',auth,adminOnly,async(req,res,next)=>{
    try{
      if(!uuid(req.params.id)||!uuid(req.params.videoId))return res.status(400).json({error:'Datos inválidos'});
      if(req.body?.confirm!==true)return res.status(400).json({error:'Confirmación requerida'});
      const result=await transaction(async c=>{
        const t=await c.query('SELECT id,client_id FROM totems WHERE id=$1 FOR UPDATE',[req.params.id]);
        if(!t.rowCount)return null;
        // Si el MP4 aún está en la biblioteca debe pertenecer a este cliente.
        const v=await c.query('SELECT client_id FROM videos WHERE id=$1',[req.params.videoId]);
        if(v.rowCount && v.rows[0].client_id!==t.rows[0].client_id)return false;
        await c.query('DELETE FROM playlist_items WHERE totem_id=$1 AND video_id=$2',[req.params.id,req.params.videoId]);
        await c.query(`UPDATE scheduled_publications SET status='cancelled'
          WHERE totem_id=$1 AND video_id=$2 AND status IN ('scheduled','active')`,[req.params.id,req.params.videoId]);
        await c.query(`UPDATE totems SET playlist_version=playlist_version+1,
          device_cleanup_generation=device_cleanup_generation+1 WHERE id=$1`,[req.params.id]);
        return true;
      });
      if(result===null)return res.status(404).json({error:'Tótem inexistente'});
      if(result===false)return res.status(403).json({error:'Video de otro cliente'});
      res.json({ok:true,pending:true,message:'Retirado de publicaciones. Se borrará de la Raspberry en su próxima sincronización.'});
    }catch(e){next(e)}
  });
  app.post('/api/admin/totems/:id/cleanup',auth,adminOnly,async(req,res,next)=>{
    try{
      if(!uuid(req.params.id))return res.status(400).json({error:'Tótem inválido'});
      const r=await pool.query(`UPDATE totems SET device_cleanup_generation=device_cleanup_generation+1 WHERE id=$1
        RETURNING device_cleanup_generation`,[req.params.id]);
      if(!r.rowCount)return res.status(404).json({error:'Tótem inexistente'});
      res.json({ok:true,pending:true,command:r.rows[0].device_cleanup_generation});
    }catch(e){next(e)}
  });
  app.get('/api/device/sync',deviceAuth,async(req,res,next)=>{
    try{
      await reconcileSchedule();
      const t=req.device;
      const rows=await allowedMedia(t.id,t.client_id);
      const files=[];
      // Si la misma campaña aparece más de una vez, el agente la descarga una sola vez.
      for(const v of rows){
        const digest=await hashIfMissing(v);
        files.push({videoId:v.id,fileName:fileById(v.id),name:v.original_name,bytes:Number(v.bytes),sha256:digest,
          kind:v.source,position:v.position,startsAt:v.starts_at,endsAt:v.ends_at});
      }
      res.json({serverTime:new Date().toISOString(),code:t.code,playlistVersion:String(t.playlist_version),
        cleanupGeneration:t.device_cleanup_generation,files});
    }catch(e){next(e)}
  });
  app.get('/api/device/video/:videoId',deviceAuth,async(req,res,next)=>{
    try{
      if(!uuid(req.params.videoId))return res.status(404).end();
      const allowed=await allowedMedia(req.device.id,req.device.client_id);
      const v=allowed.find(row=>row.id===req.params.videoId);
      if(!v || !isManagedVideoName(v.stored_name,v.id))return res.status(404).json({error:'Video no publicado para este tótem'});
      const filename=path.join(UPLOAD_DIR,v.stored_name);
      const st=await fs.promises.lstat(filename);
      if(!st.isFile() || st.isSymbolicLink() || st.size!==Number(v.bytes))return res.status(404).json({error:'MP4 no disponible'});
      res.type('mp4');res.setHeader('Content-Disposition',`attachment; filename="${v.id}.mp4"`);
      res.setHeader('Content-Length',String(st.size));
      res.sendFile(filename);
    }catch(e){next(e)}
  });
  app.post('/api/device/report',deviceAuth,async(req,res,next)=>{
    try{
      const {totalBytes,usedBytes,freeBytes,videoBytes,files,playlistVersion,cleanupAck,lastError}=req.body||{};
      if(![totalBytes,usedBytes,freeBytes,videoBytes].every(validDisk) || !validInventory(files) ||
        !/^\d{1,18}$/.test(String(playlistVersion)) || !Number.isSafeInteger(cleanupAck) || cleanupAck<0 ||
        (lastError!=null && (typeof lastError!=='string'||lastError.length>500)))
        return res.status(400).json({error:'Informe de dispositivo inválido'});
      const r=await pool.query(`UPDATE totems SET last_seen=now(),device_reported_at=now(),
          device_disk_total=$2,device_disk_used=$3,device_disk_free=$4,device_video_bytes=$5,
          device_files=$6::jsonb,device_synced_version=$7::bigint,device_last_error=$8,
          device_cleanup_ack=GREATEST(device_cleanup_ack,LEAST($9,device_cleanup_generation))
          WHERE id=$1 RETURNING id`,[req.device.id,totalBytes,usedBytes,freeBytes,videoBytes,JSON.stringify(files),playlistVersion,lastError||null,cleanupAck]);
      res.json({ok:true});
    }catch(e){next(e)}
  });
}
