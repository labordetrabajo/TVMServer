import pg from 'pg';
import { DATABASE_URL } from './config.js';
export const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
export async function transaction(fn) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); const result = await fn(c); await c.query('COMMIT'); return result; }
  catch(e) { await c.query('ROLLBACK'); throw e; }
  finally { c.release(); }
}
