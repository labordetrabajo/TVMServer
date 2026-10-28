import express from 'express';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, transaction } from './db.js';
import { PORT, UPLOAD_DIR, MAX_UPLOAD_MB, APP_ORIGIN, COOKIE_SECURE } from './config.js';
import { auth, adminOnly, authRoutes } from './auth.js';
import { cleanEmail, validEmail, newId, goodText, safeOriginalName, toPublicVideo } from './helpers.js';
import { parseDateRange } from './schedule-dates.js';
import { reconcileSchedule, effectivePlaylist } from './scheduling.js';
import { cleanupQueuedFiles } from './file-cleanup.js';
import { isManagedVideoName } from './media-file.js';
import { normalizeTotemIds, parseMultipartTotemIds, validPassword } from './publication-utils.js';
import { inspectVideo, ffprobeReady } from './media-probe.js';
import { availableSpace } from './storage-stats.js';
import { registerDeviceRoutes } from './device-routes.js';

const app=express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');
app.use(express.json({limit:'64kb'}));
app.use((req,res,next)=>{
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'no-cache');
  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const origin=req.headers.origin;
    // APP_ORIGIN admite uno o varios orígenes separados por coma.
    // En local: APP_ORIGIN=http://127.0.0.1:5173,http://localhost:5173
    // En producción mantener únicamente el dominio HTTPS oficial.
    const allowedOrigins = APP_ORIGIN
      ? APP_ORIGIN.split(',').map(value => value.trim().replace(/\/$/, '')).filter(Boolean)
      : [`${req.protocol}://${req.get('host')}`];
    if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({error:'Origen no autorizado'});
  }
  next();
});
app.get('/api/health', async (_req,res,next)=>{
  try {await pool.query('SELECT 1');res.json({ok:true,service:'tvm-server',version:'0.4.0'});} catch(e){next(e);}
});
authRoutes(app);
const uuid=(v)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

app.get('/api/clients',auth,adminOnly,async(req,res,next)=>{
  try {res.json({clients:(await pool.query('SELECT id,name,created_at FROM clients ORDER BY name')).rows});}catch(e){next(e);}
});
app.post('/api/clients',auth,adminOnly,async(req,res,next)=>{
  try {
    const name=req.body?.name;
    if(!goodText(name,2,150)) return res.status(400).json({error:'Nombre inválido'});
    const id=newId();
    await pool.query('INSERT INTO clients(id,name) VALUES($1,$2)',[id,name.trim()]);
    res.status(201).json({client:{id,name:name.trim()}});
  }catch(e){next(e);}
});
// El hash de contraseña NUNCA se devuelve al navegador.
app.get('/api/users',auth,adminOnly,async(req,res,next)=>{
  try{
    const r=await pool.query(`SELECT u.id,u.email,u.role,u.client_id,u.created_at,u.is_active,c.name AS client_name
      FROM users u LEFT JOIN clients c ON c.id=u.client_id ORDER BY u.role,u.email`);
    res.json({users:r.rows});
  }catch(e){next(e);}
});
app.patch('/api/users/:id',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Usuario inválido'});
    const {email,password,isActive}=req.body||{};
    if(email===undefined && password===undefined && isActive===undefined)
      return res.status(400).json({error:'No hay cambios para guardar'});
    if(email!==undefined&&!validEmail(cleanEmail(email)))return res.status(400).json({error:'Correo inválido'});
    if(password!==undefined&&!validPassword(password))return res.status(400).json({error:'La contraseña debe tener entre 12 y 128 caracteres'});
    if(isActive!==undefined&&typeof isActive!=='boolean')return res.status(400).json({error:'Estado inválido'});
    if(isActive===false && req.params.id===req.user.id)
      return res.status(400).json({error:'No podés desactivar tu propia cuenta'});
    const hash=password===undefined?null:await bcrypt.hash(password,12);
    const changed=await transaction(async c=>{
      const r=await c.query('SELECT id,email,is_active FROM users WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!r.rowCount)return null;
      const current=r.rows[0];
      const nextEmail=email===undefined?current.email:cleanEmail(email);
      const active=isActive===undefined?current.is_active:isActive;
      const saved=await c.query(`UPDATE users SET email=$2,is_active=$3,
        password_hash=COALESCE($4,password_hash) WHERE id=$1
        RETURNING id,email,role,client_id,created_at,is_active`,[req.params.id,nextEmail,active,hash]);
      if(hash!==null || nextEmail!==current.email || !active)
        await c.query('DELETE FROM sessions WHERE user_id=$1',[req.params.id]);
      return {user:saved.rows[0],sessionsRevoked:hash!==null || nextEmail!==current.email || !active};
    });
    if(!changed)return res.status(404).json({error:'Usuario inexistente'});
    res.json({ok:true,...changed});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'Ese correo ya está registrado'});next(e);}
});

app.post('/api/users/client',auth,adminOnly,async(req,res,next)=>{
  try {
    const email=cleanEmail(req.body?.email), password=req.body?.password, clientId=req.body?.clientId;
    if(!validEmail(email)||typeof password!=='string'||!validPassword(password)||!uuid(clientId))
      return res.status(400).json({error:'Correo, cliente o contraseña inválidos (mínimo 12 caracteres)'});
    const client=await pool.query('SELECT 1 FROM clients WHERE id=$1',[clientId]);
    if(!client.rowCount) return res.status(404).json({error:'Cliente inexistente'});
    const hash=await bcrypt.hash(password,12), id=newId();
    await pool.query('INSERT INTO users(id,email,password_hash,role,client_id) VALUES($1,$2,$3,$4,$5)',[id,email,hash,'client',clientId]);
    res.status(201).json({user:{id,email,clientId,role:'client'}});
  }catch(e){ if(e.code==='23505')return res.status(409).json({error:'El correo ya está registrado'});next(e);}
});

// Disponible únicamente para administradores. Valores informativos del almacenamiento
// donde se guardan los MP4, más el consumo real de cada cliente en PostgreSQL.
app.get('/api/admin/storage',auth,adminOnly,async(req,res,next)=>{
  try {
    const r=await pool.query(`SELECT c.id,c.name,COUNT(v.id)::int AS video_count,
      COALESCE(SUM(v.bytes),0)::text AS bytes
      FROM clients c LEFT JOIN videos v ON v.client_id=c.id GROUP BY c.id,c.name ORDER BY COALESCE(SUM(v.bytes),0) DESC,c.name`);
    const clients=r.rows.map(x=>({clientId:x.id,clientName:x.name,videoCount:x.video_count,bytes:Number(x.bytes)}));
    const disk=await availableSpace(UPLOAD_DIR);
    res.json({clients,totalBytes:clients.reduce((sum,c)=>sum+c.bytes,0),disk,
      maxUploadMb:MAX_UPLOAD_MB,ffprobeReady:await ffprobeReady()});
  } catch(e){next(e);}
});
app.get('/api/totems',auth,async(req,res,next)=>{
  try {
    const args=req.user.role==='admin'?[]:[req.user.client_id];
    const where=args.length?'WHERE t.client_id=$1':'';
    const q=`SELECT t.id,t.code,t.client_id,t.playlist_version,t.last_seen,t.created_at,
      t.device_disk_total,t.device_disk_free,t.device_disk_used,t.device_reported_at,
      t.device_cleanup_generation,t.device_cleanup_ack,t.device_synced_version,c.name AS client_name
      FROM totems t JOIN clients c ON c.id=t.client_id ${where} ORDER BY t.code`;
    res.json({totems:(await pool.query(q,args)).rows});
  }catch(e){next(e);}
});
registerDeviceRoutes(app,{auth,adminOnly});
app.post('/api/totems',auth,adminOnly,async(req,res,next)=>{
  try {
    const code=typeof req.body?.code==='string'?req.body.code.trim().toUpperCase():'', clientId=req.body?.clientId;
    if(!/^[A-Z0-9-]{3,32}$/.test(code)||!uuid(clientId))return res.status(400).json({error:'Código o cliente inválido'});
    const r=await pool.query('INSERT INTO totems(id,code,client_id) VALUES($1,$2,$3) RETURNING *',[newId(),code,clientId]);
    res.status(201).json({totem:r.rows[0]});
  }catch(e){if(e.code==='23505')return res.status(409).json({error:'El código de tótem ya existe'}); if(e.code==='23503')return res.status(404).json({error:'Cliente inexistente'}); next(e);}
});

await fsp.mkdir(UPLOAD_DIR,{recursive:true,mode:0o750});
const temporaryDir=path.join(UPLOAD_DIR,'.incoming');
await fsp.mkdir(temporaryDir,{recursive:true,mode:0o750});
const upload=multer({
  storage:multer.diskStorage({destination:(_req,_file,cb)=>cb(null,temporaryDir),filename:(_req,_file,cb)=>cb(null,crypto.randomUUID()+'.tmp')}),
  limits:{fileSize:Math.floor(MAX_UPLOAD_MB*1024*1024),files:1,fields:7,parts:8,fieldSize:4096},
  fileFilter:(_req,file,cb)=>{
    if(path.extname(file.originalname).toLowerCase()!=='.mp4')return cb(new Error('Solo se aceptan archivos .mp4'));
    cb(null,true);
  }
});
function uploadOne(req,res,next){upload.single('video')(req,res,e=>{
  if(e)return res.status(400).json({error:e.code==='LIMIT_FILE_SIZE'?'El archivo supera el límite de tamaño':e.message});
  next();
});}
// Bloquea los tótems y verifica el cliente antes de crear campañas en una transacción.
// Ninguna autorización se guarda parcialmente si falla una asignación.
async function insertApprovedSchedules(c,{videoId,clientId,totemIds,startsAt,endsAt,adminId}) {
  const ids=normalizeTotemIds(totemIds);
  const rows=await c.query(`SELECT id FROM totems WHERE id=ANY($1::uuid[]) AND client_id=$2 ORDER BY id FOR UPDATE`,[ids,clientId]);
  if(rows.rowCount!==ids.length)throw Object.assign(new Error('Todos los tótems deben pertenecer al cliente del video'),{status:400});
  const manual=await c.query('SELECT 1 FROM playlist_items WHERE video_id=$1 AND totem_id=ANY($2::uuid[]) LIMIT 1',[videoId,ids]);
  if(manual.rowCount)throw Object.assign(new Error('El video ya está en una lista manual. Retiralo de Publicaciones para programarlo.'),{status:409});
  const repeats=await c.query(`SELECT 1 FROM scheduled_publications WHERE video_id=$1 AND totem_id=ANY($2::uuid[])
    AND status IN ('scheduled','active') LIMIT 1`,[videoId,ids]);
  if(repeats.rowCount)throw Object.assign(new Error('El video ya está programado en uno de los tótems seleccionados'),{status:409});
  for(const totemId of ids){
    await c.query(`INSERT INTO scheduled_publications(id,video_id,totem_id,starts_at,ends_at,created_by)
      VALUES($1,$2,$3,$4,$5,$6)`,[newId(),videoId,totemId,startsAt,endsAt,adminId]);
  }
  return ids.length;
}

// Autorizar y programar en una sola operación atómica (exclusivo GyA).
app.post('/api/videos/:id/authorize-schedule',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Video inválido'});
    let ids,range;
    try{ids=normalizeTotemIds(req.body?.totemIds);range=parseDateRange(req.body?.startsAt,req.body?.endsAt);}
    catch(e){return res.status(400).json({error:e.message});}
    if(range.endsAt && range.endsAt.getTime()<=Date.now())
      return res.status(400).json({error:'La fecha de finalización ya pasó'});
    const result=await transaction(async c=>{
      const r=await c.query('SELECT id,client_id,status FROM videos WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!r.rowCount)return null;
      if(r.rows[0].status==='rejected')throw Object.assign(new Error('El video está rechazado. Revisá su estado antes de autorizar.'),{status:409});
      const count=await insertApprovedSchedules(c,{videoId:req.params.id,clientId:r.rows[0].client_id,totemIds:ids,
        startsAt:range.startsAt,endsAt:range.endsAt,adminId:req.user.id});
      await c.query(`UPDATE videos SET status='approved',rejection_reason=NULL,reviewed_by=$2,reviewed_at=now() WHERE id=$1`,[req.params.id,req.user.id]);
      return {count};
    });
    if(!result)return res.status(404).json({error:'Video inexistente'});
    try{await reconcileSchedule();}catch(e){console.error('[TVM] Activación pendiente para próximo ciclo:',e.message);}
    res.json({ok:true,...result});
  }catch(e){if(e.status)return res.status(e.status).json({error:e.message});if(e.code==='23505')return res.status(409).json({error:'Publicación duplicada'});next(e);}
});

app.post('/api/videos',auth,uploadOne,async(req,res,next)=>{
  if(!req.file)return res.status(400).json({error:'Seleccioná un archivo MP4'});
  const temp=req.file.path, id=newId(), storedName=`${id}.mp4`;
  let finalPath;
  try{
    const clientId=req.user.role==='admin'?req.body?.clientId:req.user.client_id;
    if(!uuid(clientId))return res.status(400).json({error:'Cliente no seleccionado'});
    const note=typeof req.body?.note==='string'?req.body.note.trim():'';
    if(note.length>1000)return res.status(400).json({error:'La nota puede tener hasta 1000 caracteres'});
    let range;try{range=parseDateRange(req.body?.requestedStartAt,req.body?.requestedEndAt,{optionalStart:true});}
    catch(e){return res.status(400).json({error:e.message});}
    if(range.startsAt && range.startsAt.getTime()<Date.now()-60000)
      return res.status(400).json({error:'La fecha solicitada debe ser futura'});
    const direct=req.user.role==='admin' && req.body?.approvalMode==='publish';
    let ids=[];
    if(direct){
      try{ids=parseMultipartTotemIds(req.body?.totemIds);}catch(e){return res.status(400).json({error:e.message});}
      if(range.endsAt && range.endsAt.getTime()<=Date.now())
        return res.status(400).json({error:'La campaña ya habría finalizado'});
    }
    if(req.body?.approvalMode && !['publish','pending'].includes(req.body.approvalMode))
      return res.status(400).json({error:'Modo de carga inválido'});
    if(req.user.role!=='admin' && req.body?.approvalMode==='publish')
      return res.status(403).json({error:'Solo GyA puede publicar directamente'});
    if(req.user.role==='admin' && !(await pool.query('SELECT 1 FROM clients WHERE id=$1',[clientId])).rowCount)
      return res.status(404).json({error:'Cliente inexistente'});
    const fd=await fsp.open(temp,'r');
    let isMp4=false;
    try {const buf=Buffer.alloc(12);const {bytesRead}=await fd.read(buf,0,12,0); isMp4=bytesRead===12&&buf.toString('ascii',4,8)==='ftyp';}finally{await fd.close();}
    if(!isMp4) return res.status(400).json({error:'El archivo no tiene una cabecera MP4 válida'});
    let metadata;
    try{metadata=await inspectVideo(temp);}catch(e){return res.status(400).json({error:e.message});}
    const disk=await availableSpace(UPLOAD_DIR);
    if(disk && disk.freeBytes<512*1024*1024)
      return res.status(507).json({error:'Espacio insuficiente en el servidor: quedan menos de 512 MB libres. Avisá al administrador.'});
    finalPath=path.join(UPLOAD_DIR,storedName);
    await fsp.rename(temp,finalPath);
    const originalName=safeOriginalName(req.file.originalname);
    await transaction(async c=>{
      await c.query(`INSERT INTO videos(id,client_id,uploader_id,original_name,stored_name,bytes,status,note,requested_start_at,requested_end_at,reviewed_by,reviewed_at,
          media_validation,video_codec,audio_codec,media_width,media_height,media_fps,duration_seconds)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11::uuid IS NOT NULL THEN now() ELSE NULL END,
          $12,$13,$14,$15,$16,$17,$18)`,
        [id,clientId,req.user.id,originalName,storedName,req.file.size,direct?'approved':'pending',note,range.startsAt,range.endsAt,direct?req.user.id:null,
          metadata.status,metadata.videoCodec,metadata.audioCodec,metadata.width,metadata.height,metadata.fps,metadata.durationSeconds]);
      if(direct)await insertApprovedSchedules(c,{videoId:id,clientId,totemIds:ids,startsAt:range.startsAt||new Date(),endsAt:range.endsAt,adminId:req.user.id});
    });
    if(direct){try{await reconcileSchedule();}catch(e){console.error('[TVM] Activación pendiente para próximo ciclo:',e.message);}}
    res.status(201).json({video:{id,originalName,size:req.file.size,status:direct?'approved':'pending',note,requestedStartAt:range.startsAt,requestedEndAt:range.endsAt},scheduledTotems:direct?ids.length:0,mediaValidation:metadata.status});
  }catch(e){if(finalPath)await fsp.unlink(finalPath).catch(()=>{});if(e.status)return res.status(e.status).json({error:e.message});if(e.code==='23505')return res.status(409).json({error:'Publicación duplicada'});next(e);}
  finally{await fsp.unlink(temp).catch(()=>{});}
});
app.get('/api/videos',auth,async(req,res,next)=>{
  try{
    const args=req.user.role==='admin'?[]:[req.user.client_id];
    const where=args.length?'WHERE v.client_id=$1':'';
    const q=`SELECT v.id,v.client_id,c.name AS client_name,v.original_name,v.bytes,v.status,v.created_at,v.reviewed_at,v.note,v.requested_start_at,v.requested_end_at,v.rejection_reason,
       v.media_validation,v.video_codec,v.audio_codec,v.media_width,v.media_height,v.media_fps,v.duration_seconds,
       (EXISTS(SELECT 1 FROM playlist_items p WHERE p.video_id=v.id) OR
        EXISTS(SELECT 1 FROM scheduled_publications s WHERE s.video_id=v.id AND s.status IN ('scheduled','active'))) AS has_publications
       FROM videos v JOIN clients c ON c.id=v.client_id ${where} ORDER BY v.created_at DESC LIMIT 250`;
    res.json({videos:(await pool.query(q,args)).rows.map(toPublicVideo)});
  }catch(e){next(e);}
});
app.get('/api/videos/:id/file',auth,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Video inexistente'});
    const a=await pool.query('SELECT * FROM videos WHERE id=$1',[req.params.id]);const v=a.rows[0];
    if(!v|| (req.user.role!=='admin'&&v.client_id!==req.user.client_id))return res.status(404).json({error:'Video inexistente'});
    if(!isManagedVideoName(v.stored_name,v.id))return res.status(500).json({error:'Archivo inválido'});
    const filename=path.join(UPLOAD_DIR,v.stored_name);
    res.type('mp4');res.setHeader('Content-Disposition', `inline; filename="${v.id}.mp4"`);
    res.sendFile(filename);
  }catch(e){next(e);}
});
// Reanaliza archivos cargados antes de que se instalara FFprobe (solo GyA).
app.post('/api/videos/:id/verify',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Video inválido'});
    const r=await pool.query('SELECT id,stored_name FROM videos WHERE id=$1',[req.params.id]);
    if(!r.rowCount)return res.status(404).json({error:'Video inexistente'});
    const v=r.rows[0];
    if(!isManagedVideoName(v.stored_name,v.id))return res.status(500).json({error:'Nombre de archivo inválido'});
    let meta;
    try{meta=await inspectVideo(path.join(UPLOAD_DIR,v.stored_name));}
    catch(e){return res.status(422).json({error:e.message});}
    await pool.query(`UPDATE videos SET media_validation=$2,video_codec=$3,audio_codec=$4,
      media_width=$5,media_height=$6,media_fps=$7,duration_seconds=$8 WHERE id=$1`,
      [v.id,meta.status,meta.videoCodec,meta.audioCodec,meta.width,meta.height,meta.fps,meta.durationSeconds]);
    res.json({ok:true,mediaValidation:meta.status});
  }catch(e){next(e);}
});
app.patch('/api/videos/:id/status',auth,adminOnly,async(req,res,next)=>{
  try{
    const status=req.body?.status;
    if(!uuid(req.params.id)||!['approved','rejected'].includes(status))return res.status(400).json({error:'Datos inválidos'});
    const reason=typeof req.body?.reason==='string'?req.body.reason.trim():'';
    if(status==='rejected' && (reason.length<5 || reason.length>500))
      return res.status(400).json({error:'Indicá un motivo de rechazo de 5 a 500 caracteres'});
    if(status==='approved')return res.status(409).json({error:'Para aprobar usá Autorizar y programar, eligiendo tótems y horario.'});
    const v=await transaction(async c=>{
      const r=await c.query(`UPDATE videos SET status=$1,reviewed_by=$2,reviewed_at=now(),rejection_reason=$4 WHERE id=$3 RETURNING id,status,rejection_reason`,[status,req.user.id,req.params.id,reason]);
      if(!r.rowCount)return null;
      if(status==='rejected'){
        const totems=await c.query(`SELECT totem_id FROM playlist_items WHERE video_id=$1
          UNION SELECT totem_id FROM scheduled_publications WHERE video_id=$1 AND status='active'`,[req.params.id]);
        await c.query('DELETE FROM playlist_items WHERE video_id=$1',[req.params.id]);
        await c.query(`UPDATE scheduled_publications SET status='cancelled'
          WHERE video_id=$1 AND status IN ('scheduled','active')`,[req.params.id]);
        for(const t of totems.rows) await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[t.totem_id]);
      }
      return r.rows[0];
    });
    if(!v)return res.status(404).json({error:'Video inexistente'});
    res.json({video:v});
  }catch(e){next(e);}
});

// v0.3.1: únicamente GyA puede despublicar o eliminar definitivamente.
// Despublicar conserva el MP4 y el video aprobado, pero cancela publicaciones
// futuras/activas y retira el video de todas las playlists manuales.
app.post('/api/videos/:id/unpublish',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Video inexistente'});
    const result=await transaction(async c=>{
      const video=await c.query('SELECT id FROM videos WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!video.rowCount)return null;
      const affected=await c.query(`SELECT totem_id FROM playlist_items WHERE video_id=$1
        UNION SELECT totem_id FROM scheduled_publications WHERE video_id=$1 AND status='active'`,[req.params.id]);
      const manual=await c.query('DELETE FROM playlist_items WHERE video_id=$1',[req.params.id]);
      const scheduled=await c.query(`UPDATE scheduled_publications SET status='cancelled'
        WHERE video_id=$1 AND status IN ('scheduled','active')`,[req.params.id]);
      for(const row of affected.rows)
        await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[row.totem_id]);
      return {removedFrom:affected.rowCount,manualItems:manual.rowCount,cancelledSchedules:scheduled.rowCount};
    });
    if(!result)return res.status(404).json({error:'Video inexistente'});
    res.json({ok:true,...result});
  }catch(e){next(e);}
});

// Borrado definitivo robusto: DB + cola persistente de eliminación de MP4.
// La cola evita perder archivos si Windows los tiene abiertos durante un intento.
app.delete('/api/videos/:id',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Video inexistente'});
    if(req.body?.confirm!==true)return res.status(400).json({error:'Confirmación requerida para eliminar definitivamente'});
    const result=await transaction(async c=>{
      const r=await c.query('SELECT id,stored_name FROM videos WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!r.rowCount)return null;
      const video=r.rows[0];
      if(!isManagedVideoName(video.stored_name,video.id))
        throw new Error('Nombre de archivo administrado no válido; se bloqueó la eliminación por seguridad');
      const affected=await c.query(`SELECT totem_id FROM playlist_items WHERE video_id=$1
        UNION SELECT totem_id FROM scheduled_publications WHERE video_id=$1 AND status='active'`,[req.params.id]);
      await c.query('DELETE FROM playlist_items WHERE video_id=$1',[video.id]);
      await c.query('DELETE FROM scheduled_publications WHERE video_id=$1',[video.id]);
      await c.query(`INSERT INTO file_deletion_queue(id,stored_name) VALUES($1,$2)`,[newId(),video.stored_name]);
      await c.query('DELETE FROM videos WHERE id=$1',[video.id]);
      for(const row of affected.rows)
        await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[row.totem_id]);
      return {storedName:video.stored_name,removedFrom:affected.rowCount};
    });
    if(!result)return res.status(404).json({error:'Video inexistente'});
    // Intentamos limpiar ahora; si falla, queda registrado para reintentar.
    try{await cleanupQueuedFiles();}catch(e){console.error('[TVM] Limpieza pendiente:',e.message);}
    const pending=await pool.query('SELECT 1 FROM file_deletion_queue WHERE stored_name=$1',[result.storedName]);
    res.json({ok:true,removedFrom:result.removedFrom,cleanupPending:pending.rowCount>0});
  }catch(e){next(e);}
});

// GyA también puede añadir campañas adicionales a videos ya aprobados desde Agenda.
app.get('/api/schedules',auth,adminOnly,async(req,res,next)=>{
  try{
    await reconcileSchedule();
    const r=await pool.query(`SELECT s.id,s.video_id,s.totem_id,s.starts_at,s.ends_at,s.status,
       s.created_at,s.activated_at,s.completed_at,
       v.original_name AS video_name,v.note,c.name AS client_name,t.code AS totem_code
       FROM scheduled_publications s JOIN videos v ON v.id=s.video_id
       JOIN totems t ON t.id=s.totem_id JOIN clients c ON c.id=t.client_id
       ORDER BY s.starts_at DESC LIMIT 500`);
    res.json({schedules:r.rows});
  }catch(e){next(e);}
});
app.post('/api/schedules',auth,adminOnly,async(req,res,next)=>{
  try{
    const {videoId,totemId,startsAt,endsAt}=req.body||{};
    if(!uuid(videoId)||!uuid(totemId))return res.status(400).json({error:'Seleccioná video y tótem'});
    let range;try{range=parseDateRange(startsAt,endsAt);}catch(e){return res.status(400).json({error:e.message});}
    if(range.endsAt && range.endsAt.getTime()<=Date.now())
      return res.status(400).json({error:'La finalización ya pasó'});
    const result=await transaction(async c=>{
      const r=await c.query(`SELECT v.id FROM videos v JOIN totems t ON t.client_id=v.client_id
         WHERE v.id=$1 AND t.id=$2 AND v.status='approved' FOR UPDATE OF v,t`,[videoId,totemId]);
      if(!r.rowCount)return null;
      const isManual=await c.query('SELECT 1 FROM playlist_items WHERE totem_id=$1 AND video_id=$2',[totemId,videoId]);
      if(isManual.rowCount)return false;
      const id=newId();
      const saved=await c.query(`INSERT INTO scheduled_publications
        (id,video_id,totem_id,starts_at,ends_at,created_by)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,status`,
        [id,videoId,totemId,range.startsAt,range.endsAt,req.user.id]);
      return saved.rows[0];
    });
    if(result===null)return res.status(400).json({error:'El video debe estar aprobado y pertenecer al cliente del tótem'});
    if(result===false)return res.status(409).json({error:'Este video está en la lista manual del tótem. Retiralo de Publicaciones antes de programarlo.'});
    await reconcileSchedule();
    res.status(201).json({schedule:result});
  }catch(e){
    if(e.code==='23505')return res.status(409).json({error:'Este video ya tiene una programación vigente en ese tótem'});
    next(e);
  }
});
app.patch('/api/schedules/:id/cancel',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(400).json({error:'Programación inválida'});
    const result=await transaction(async c=>{
      const r=await c.query(`SELECT id,totem_id,status FROM scheduled_publications WHERE id=$1 FOR UPDATE`,[req.params.id]);
      if(!r.rowCount)return null;
      if(!['scheduled','active'].includes(r.rows[0].status))return false;
      await c.query(`UPDATE scheduled_publications SET status='cancelled' WHERE id=$1`,[req.params.id]);
      if(r.rows[0].status==='active')
        await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[r.rows[0].totem_id]);
      return true;
    });
    if(result===null)return res.status(404).json({error:'Programación inexistente'});
    if(!result)return res.status(400).json({error:'La programación ya terminó o fue cancelada'});
    res.json({ok:true});
  }catch(e){next(e);}
});

app.get('/api/totems/:id/playlist',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Tótem inexistente'});
    const t=await pool.query('SELECT id,code,playlist_version FROM totems WHERE id=$1',[req.params.id]);
    if(!t.rowCount)return res.status(404).json({error:'Tótem inexistente'});
    const r=await pool.query(`SELECT v.id,v.original_name AS name,p.position FROM playlist_items p
      JOIN videos v ON v.id=p.video_id WHERE p.totem_id=$1 ORDER BY p.position`,[req.params.id]);
    res.json({totem:t.rows[0],items:r.rows});
  }catch(e){next(e);}
});
app.get('/api/totems/:id/effective-playlist',auth,adminOnly,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Tótem inexistente'});
    const t=await pool.query('SELECT id,code,playlist_version FROM totems WHERE id=$1',[req.params.id]);
    if(!t.rowCount)return res.status(404).json({error:'Tótem inexistente'});
    await reconcileSchedule();
    const updated=await pool.query('SELECT playlist_version FROM totems WHERE id=$1',[req.params.id]);
    res.json({totem:{...t.rows[0],playlist_version:updated.rows[0].playlist_version},items:await effectivePlaylist(req.params.id)});
  }catch(e){next(e);}
});

app.put('/api/totems/:id/playlist',auth,adminOnly,async(req,res,next)=>{
  try{
    const ids=req.body?.videoIds;
    if(!uuid(req.params.id)||!Array.isArray(ids)||ids.length>250||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)
      return res.status(400).json({error:'La lista contiene IDs inválidos o repetidos'});
    const result=await transaction(async c=>{
      const t=await c.query('SELECT id,client_id FROM totems WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!t.rowCount)return null;
      if(ids.length){
        const conflict=await c.query(`SELECT 1 FROM scheduled_publications
          WHERE totem_id=$1 AND video_id=ANY($2::uuid[]) AND status IN ('scheduled','active') LIMIT 1`,[req.params.id,ids]);
        if(conflict.rowCount)return 'conflict';
        const accepted=await c.query('SELECT id FROM videos WHERE id=ANY($1::uuid[]) AND client_id=$2 AND status=$3',[ids,t.rows[0].client_id,'approved']);
        if(accepted.rowCount!==ids.length)return false;
      }
      await c.query('DELETE FROM playlist_items WHERE totem_id=$1',[req.params.id]);
      for(let i=0;i<ids.length;i++)await c.query('INSERT INTO playlist_items(totem_id,video_id,position) VALUES($1,$2,$3)',[req.params.id,ids[i],i]);
      const updated=await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1 RETURNING playlist_version',[req.params.id]);
      return {version:String(updated.rows[0].playlist_version),count:ids.length};
    });
    if(result===null)return res.status(404).json({error:'Tótem inexistente'});
    if(result===false)return res.status(400).json({error:'Solo podés publicar videos aprobados del cliente del tótem'});
    if(result==='conflict')return res.status(409).json({error:'Un video ya tiene programación vigente. Gestioná esa campaña desde Agenda, no desde la lista manual.'});
    res.json({ok:true,...result});
  }catch(e){next(e);}
});

const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../frontend/dist');
if(fs.existsSync(dist)){
  app.use(express.static(dist,{index:false}));
  app.get('*',(req,res)=>{
    if(req.path.startsWith('/api/'))return res.status(404).json({error:'Ruta inexistente'});
    res.sendFile(path.join(dist,'index.html'));
  });
}
app.use((req,res)=>res.status(404).json({error:'Ruta inexistente'}));
app.use((err,req,res,_next)=>{
  console.error('[TVM]',err);
  if(res.headersSent)return;
  res.status(500).json({error:'Error del servidor'});
});
app.listen(PORT,'127.0.0.1',()=>{
  console.log(`TVM Server v0.4 escuchando SOLO en http://127.0.0.1:${PORT}`);
  if(!COOKIE_SECURE)console.log('AVISO: activar COOKIE_SECURE=true al desplegar con HTTPS.');
});

// Cada 10 segundos activa/desactiva las campañas autorizadas. El refresco de la
// API también fuerza conciliación para no depender exclusivamente del temporizador.
let reconciling=false;
const timer=setInterval(async()=>{
  if(reconciling)return;
  reconciling=true;
  try{await reconcileSchedule();}catch(e){console.error('[TVM] Error de programación:',e.message);}
  finally{reconciling=false;}
},10000);
timer.unref();
reconcileSchedule().catch(e=>console.error('[TVM] Inicialización de programaciones:',e.message));

// Reintento de archivos que Windows pudiera haber mantenido abiertos.
const fileCleanupTimer=setInterval(()=>{
  cleanupQueuedFiles().catch(e=>console.error('[TVM] Limpieza de archivos:',e.message));
},60000);
fileCleanupTimer.unref();
cleanupQueuedFiles().catch(e=>console.error('[TVM] Cola de borrados no disponible:',e.message));
