import { pool, transaction } from './db.js';

/**
 * Aplica cambios automáticos en PostgreSQL y aumenta la versión de cada playlist afectada.
 * Las asignaciones manuales se conservan: la playlist efectiva es la unión sin duplicados
 * entre playlist_items y scheduled_publications con estado active.
 * Usa bloqueo de filas para no aplicar el mismo evento dos veces con procesos concurrentes.
 */
export async function reconcileSchedule() {
  return transaction(async c=>{
    const events=await c.query(`SELECT s.id,s.totem_id,s.status
      FROM scheduled_publications s
      WHERE (s.status='scheduled' AND s.starts_at<=now())
         OR (s.status='active' AND s.ends_at IS NOT NULL AND s.ends_at<=now())
      ORDER BY s.starts_at,s.id FOR UPDATE OF s SKIP LOCKED`);
    const changed=new Set();
    for(const e of events.rows){
      if(e.status==='scheduled'){
        const result=await c.query(`UPDATE scheduled_publications
          SET status=CASE WHEN ends_at IS NOT NULL AND ends_at<=now() THEN 'completed' ELSE 'active' END,
              activated_at=CASE WHEN ends_at IS NOT NULL AND ends_at<=now() THEN NULL ELSE now() END,
              completed_at=CASE WHEN ends_at IS NOT NULL AND ends_at<=now() THEN now() ELSE NULL END
          WHERE id=$1 RETURNING status`,[e.id]);
        // Si una campaña terminó antes de la aprobación no estuvo visible: sin nueva versión.
        if(result.rows[0]?.status==='active')changed.add(e.totem_id);
      }else{
        await c.query(`UPDATE scheduled_publications SET status='completed',completed_at=now() WHERE id=$1`,[e.id]);
        changed.add(e.totem_id);
      }
    }
    for(const id of changed)await c.query('UPDATE totems SET playlist_version=playlist_version+1 WHERE id=$1',[id]);
    return {transitions:events.rowCount,changedTotems:changed.size};
  });
}

export async function effectivePlaylist(totemId) {
  const r=await pool.query(`SELECT x.id,x.name,x.position,x.source FROM (
    SELECT v.id,v.original_name AS name,p.position,'manual' AS source,0 AS priority
      FROM playlist_items p JOIN videos v ON v.id=p.video_id
      WHERE p.totem_id=$1 AND v.status='approved'
    UNION ALL
    SELECT v.id,v.original_name AS name,100000+row_number() OVER(ORDER BY s.starts_at,s.id)::int AS position,
      'programada' AS source,1 AS priority
      FROM scheduled_publications s JOIN videos v ON v.id=s.video_id
      WHERE s.totem_id=$1 AND s.status='active' AND v.status='approved'
  ) x ORDER BY x.priority,x.position`,[totemId]);
  // Un video programado y también agregado manualmente solo aparece una vez.
  const seen=new Set();return r.rows.filter(v=>!seen.has(v.id)&&seen.add(v.id));
}
