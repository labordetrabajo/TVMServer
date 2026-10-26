import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { pool } from './db.js';
import { cleanEmail, validEmail, parseCookies, sha256 } from './helpers.js';
import { COOKIE_SECURE } from './config.js';

const COOKIE='tvm_session';
const MAX_SESSION_AGE=7*24*60*60*1000;
const cookieAttrs=`Path=/; HttpOnly; SameSite=Lax${COOKIE_SECURE ? '; Secure' : ''}`;
const clearCookie=(res)=>res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs}; Max-Age=0`);
export const loginLimiter=rateLimit({windowMs:15*60*1000, limit:12, standardHeaders:'draft-7', legacyHeaders:false, message:{error:'Demasiados intentos. Probá más tarde.'}});

export async function auth(req,res,next) {
  try {
    const token=parseCookies(req.headers.cookie)[COOKIE];
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return res.status(401).json({error:'Sesión no iniciada'});
    const r=await pool.query(`SELECT u.id,u.email,u.role,u.client_id FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now()`, [sha256(token)]);
    if (!r.rowCount) return res.status(401).json({error:'Sesión vencida'});
    req.user=r.rows[0];
    next();
  } catch(e) { next(e); }
}
export function adminOnly(req,res,next) { if(req.user.role!=='admin') return res.status(403).json({error:'Solo administrador'}); next(); }

export function authRoutes(app) {
  app.post('/api/auth/login', loginLimiter, async(req,res,next)=>{
    try {
      const email=cleanEmail(req.body?.email), password=req.body?.password;
      if (!validEmail(email) || typeof password !== 'string') return res.status(400).json({error:'Credenciales inválidas'});
      const result=await pool.query('SELECT id,email,role,client_id,password_hash FROM users WHERE lower(email)=$1',[email]);
      const user=result.rows[0];
      // Hash de relleno para no responder inmediatamente cuando el usuario no existe.
      const sentinel='$2a$12$wctCnaH9jF3FowhuxrIXPOpiCC1g6qb7.Rm6lJBYxR2Zos8oOKRQG';
      const matches=await bcrypt.compare(password,user?.password_hash ?? sentinel);
      if (!user || !matches) return res.status(401).json({error:'Usuario o contraseña incorrectos'});
      const token=crypto.randomBytes(32).toString('hex');
      await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)', [sha256(token),user.id,new Date(Date.now()+MAX_SESSION_AGE)]);
      res.setHeader('Set-Cookie', `${COOKIE}=${token}; ${cookieAttrs}; Max-Age=${Math.floor(MAX_SESSION_AGE/1000)}`);
      res.json({user:{id:user.id,email:user.email,role:user.role,clientId:user.client_id}});
    } catch(e) { next(e); }
  });
  app.get('/api/auth/me', auth, (req,res)=>res.json({user:{id:req.user.id,email:req.user.email,role:req.user.role,clientId:req.user.client_id}}));
  app.post('/api/auth/logout', auth, async(req,res,next)=>{
    try { const token=parseCookies(req.headers.cookie)[COOKIE]; await pool.query('DELETE FROM sessions WHERE token_hash=$1',[sha256(token)]); clearCookie(res); res.json({ok:true}); }
    catch(e) {next(e);}
  });
}
