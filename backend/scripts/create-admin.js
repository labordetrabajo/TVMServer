import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';
import { newId, cleanEmail, validEmail } from '../src/helpers.js';
const email=cleanEmail(process.env.ADMIN_SETUP_EMAIL), password=process.env.ADMIN_SETUP_PASSWORD;
try {
  if (!validEmail(email) || typeof password!=='string' || password.length<12 || password.length>128) throw new Error('Correo o contraseña inválidos (mínimo 12 caracteres)');
  const hash=await bcrypt.hash(password,12);
  const existing=await pool.query('SELECT id FROM users WHERE lower(email)=$1',[email]);
  if (existing.rowCount) throw new Error('Ese correo ya existe');
  await pool.query('INSERT INTO users(id,email,password_hash,role) VALUES($1,$2,$3,$4)',[newId(),email,hash,'admin']);
  console.log('Administrador creado:',email);
} catch(e) { console.error(e.message); process.exitCode=1; }
finally {await pool.end();}
