import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
const sqlDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql');
const migrations=['003_programaciones.sql','004_admin_delete_unpublish.sql',
  '005_usuarios_accesos.sql','006_preparacion_produccion.sql','007_dispositivos_remotos.sql'];
try {
  await pool.query(await fs.readFile(path.join(sqlDir,'schema.sql'),'utf8'));
  for(const name of migrations)await pool.query(await fs.readFile(path.join(sqlDir,'migrations',name),'utf8'));
  console.log('Base de datos TVM v0.4 inicializada correctamente.');
} catch(e) { console.error('No se pudo inicializar TVM:',e.message); process.exitCode=1; }
finally { await pool.end(); }
