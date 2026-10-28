/** Exige fecha ISO con huso horario explícito; la web convierte la hora local a UTC. */
export function parseScheduleDate(value, {optional=false}={}) {
  if ((value===null || value===undefined || value==='') && optional) return null;
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value))
    throw new Error('La fecha debe incluir hora y zona horaria');
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))throw new Error('Fecha u hora inválida');
  return date;
}
export function parseDateRange(start, end, {optionalStart=false}={}) {
  const startsAt=parseScheduleDate(start,{optional:optionalStart});
  const endsAt=parseScheduleDate(end,{optional:true});
  if(endsAt && (!startsAt || endsAt <= startsAt))throw new Error('La finalización debe ser posterior al inicio');
  return {startsAt,endsAt};
}

