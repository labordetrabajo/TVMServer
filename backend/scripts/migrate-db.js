import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../src/db.js';
const migrations=['003_programaciones.sql','004_admin_delete_unpublish.sql','005_usuarios_accesos.sql','006_preparacion_produccion.sql','007_dispositivos_remotos.sql'];
try {
  for(const filename of migrations){
    const fullpath=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../sql/migrations/',filename);
    await pool.query(await fs.readFile(fullpath,'utf8'));
  }
  console.log('Migraciones TVM v0.4 aplicadas. Se conservaron los datos existentes.');
} catch(e) {console.error('Error al migrar TVM:',e.message);process.exitCode=1;}
finally {await pool.end();}
