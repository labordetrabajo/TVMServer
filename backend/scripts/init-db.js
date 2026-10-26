import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
const filename=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql/schema.sql');
try {
  await pool.query(await fs.readFile(filename,'utf8'));
  console.log('Base de datos TVM inicializada correctamente.');
} catch(e) { console.error('No se pudo inicializar TVM:',e.message); process.exitCode=1; }
finally { await pool.end(); }
