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
    const expected=APP_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (origin && origin!==expected) return res.status(403).json({error:'Origen no autorizado'});
  }
  next();
});
app.get('/api/health', async (_req,res,next)=>{
  try {await pool.query('SELECT 1');res.json({ok:true,service:'tvm-server',version:'0.1.0'});} catch(e){next(e);}
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
app.post('/api/users/client',auth,adminOnly,async(req,res,next)=>{
  try {
    const email=cleanEmail(req.body?.email), password=req.body?.password, clientId=req.body?.clientId;
    if(!validEmail(email)||typeof password!=='string'||password.length<12||password.length>128||!uuid(clientId))
      return res.status(400).json({error:'Correo, cliente o contraseña inválidos (mínimo 12 caracteres)'});
    const client=await pool.query('SELECT 1 FROM clients WHERE id=$1',[clientId]);
    if(!client.rowCount) return res.status(404).json({error:'Cliente inexistente'});
    const hash=await bcrypt.hash(password,12), id=newId();
    await pool.query('INSERT INTO users(id,email,password_hash,role,client_id) VALUES($1,$2,$3,$4,$5)',[id,email,hash,'client',clientId]);
    res.status(201).json({user:{id,email,clientId,role:'client'}});
  }catch(e){ if(e.code==='23505')return res.status(409).json({error:'El correo ya está registrado'});next(e);}
});
app.get('/api/totems',auth,async(req,res,next)=>{
  try {
    const args=req.user.role==='admin'?[]:[req.user.client_id];
    const where=args.length?'WHERE t.client_id=$1':'';
    const q=`SELECT t.id,t.code,t.client_id,t.playlist_version,t.last_seen,t.created_at,c.name AS client_name
      FROM totems t JOIN clients c ON c.id=t.client_id ${where} ORDER BY t.code`;
    res.json({totems:(await pool.query(q,args)).rows});
  }catch(e){next(e);}
});
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
  limits:{fileSize:Math.floor(MAX_UPLOAD_MB*1024*1024),files:1,fields:1,parts:2},
  fileFilter:(_req,file,cb)=>{
    if(path.extname(file.originalname).toLowerCase()!=='.mp4')return cb(new Error('Solo se aceptan archivos .mp4'));
    cb(null,true);
  }
});
function uploadOne(req,res,next){upload.single('video')(req,res,e=>{
  if(e)return res.status(400).json({error:e.code==='LIMIT_FILE_SIZE'?'El archivo supera el límite de tamaño':e.message});
  next();
});}
app.post('/api/videos',auth,uploadOne,async(req,res,next)=>{
  if(!req.file)return res.status(400).json({error:'Seleccioná un archivo MP4'});
  const temp=req.file.path, id=newId(), storedName=`${id}.mp4`;
  let finalPath;
  try{
    const clientId=req.user.role==='admin'?req.body?.clientId:req.user.client_id;
    if(!uuid(clientId))return res.status(400).json({error:'Cliente no seleccionado'});
    if(req.user.role==='admin' && !(await pool.query('SELECT 1 FROM clients WHERE id=$1',[clientId])).rowCount)
      return res.status(404).json({error:'Cliente inexistente'});
    const fd=await fsp.open(temp,'r');
    let isMp4=false;
    try {const buf=Buffer.alloc(12);const {bytesRead}=await fd.read(buf,0,12,0); isMp4=bytesRead===12&&buf.toString('ascii',4,8)==='ftyp';}finally{await fd.close();}
    if(!isMp4) return res.status(400).json({error:'El archivo no tiene una cabecera MP4 válida'});
    finalPath=path.join(UPLOAD_DIR,storedName);
    await fsp.rename(temp,finalPath);
    const originalName=safeOriginalName(req.file.originalname);
    await pool.query(`INSERT INTO videos(id,client_id,uploader_id,original_name,stored_name,bytes,status)
      VALUES($1,$2,$3,$4,$5,$6,'pending')`,[id,clientId,req.user.id,originalName,storedName,req.file.size]);
    res.status(201).json({video:{id,originalName,size:req.file.size,status:'pending'}});
  }catch(e){if(finalPath)await fsp.unlink(finalPath).catch(()=>{});next(e);}
  finally{await fsp.unlink(temp).catch(()=>{});}
});
app.get('/api/videos',auth,async(req,res,next)=>{
  try{
    const args=req.user.role==='admin'?[]:[req.user.client_id];
    const where=args.length?'WHERE v.client_id=$1':'';
    const q=`SELECT v.id,v.client_id,c.name AS client_name,v.original_name,v.bytes,v.status,v.created_at,v.reviewed_at
       FROM videos v JOIN clients c ON c.id=v.client_id ${where} ORDER BY v.created_at DESC LIMIT 250`;
    res.json({videos:(await pool.query(q,args)).rows.map(toPublicVideo)});
  }catch(e){next(e);}
});
app.get('/api/videos/:id/file',auth,async(req,res,next)=>{
  try{
    if(!uuid(req.params.id))return res.status(404).json({error:'Video inexistente'});
    const a=await pool.query('SELECT * FROM videos WHERE id=$1',[req.params.id]);const v=a.rows[0];
    if(!v|| (req.user.role!=='admin'&&v.client_id!==req.user.client_id))return res.status(404).json({error:'Video inexistente'});
    const filename=path.join(UPLOAD_DIR,v.stored_name);
    res.type('mp4');res.setHeader('Content-Disposition', `inline; filename="${v.id}.mp4"`);
    res.sendFile(filename);
  }catch(e){next(e);}
});
app.patch('/api/videos/:id/status',auth,adminOnly,async(req,res,next)=>{
  try{
    const status=req.body?.status;
    if(!uuid(req.params.id)||!['approved','rejected'].includes(status))return res.status(400).json({error:'Datos inválidos'});
    const v=await transaction(async c=>{
      const r=await c.query(`UPDATE videos SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3 RETURNING id,status`,[status,req.user.id,req.params.id]);
      if(!r.rowCount)return null;
      if(status==='rejected'){
        const totems=await c.query('SELECT DISTINCT totem_id FROM playlist_items WHERE video_id=$1',[req.params.id]);
        await c.query('DELETE FROM playlist_items WHERE video_id=$1',[req.params.id]);
        for(const t of totems.rows) await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[t.totem_id]);
      }
      return r.rows[0];
    });
    if(!v)return res.status(404).json({error:'Video inexistente'});
    res.json({video:v});
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
app.put('/api/totems/:id/playlist',auth,adminOnly,async(req,res,next)=>{
  try{
    const ids=req.body?.videoIds;
    if(!uuid(req.params.id)||!Array.isArray(ids)||ids.length>250||ids.some(id=>!uuid(id))||new Set(ids).size!==ids.length)
      return res.status(400).json({error:'La lista contiene IDs inválidos o repetidos'});
    const result=await transaction(async c=>{
      const t=await c.query('SELECT id,client_id FROM totems WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!t.rowCount)return null;
      if(ids.length){
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
  console.log(`TVM Server v0.1 escuchando SOLO en http://127.0.0.1:${PORT}`);
  if(!COOKIE_SECURE)console.log('AVISO: activar COOKIE_SECURE=true al desplegar con HTTPS.');
});
