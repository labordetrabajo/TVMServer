import crypto from 'node:crypto';
export const newId = () => crypto.randomUUID();
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
export function cleanEmail(value) { return typeof value === 'string' ? value.trim().toLowerCase() : ''; }
export function validEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254; }
export function goodText(value, min=1, max=150) { return typeof value === 'string' && value.trim().length >= min && value.trim().length <= max; }
export function safeOriginalName(value) { return String(value || '').replace(/[\x00-\x1f\x7f]/g,'').slice(0, 240); }
export function clientScope(user) { return user.role === 'admin' ? null : user.client_id; }
export function toPublicVideo(v) {
  return {id:v.id, clientId:v.client_id, clientName:v.client_name, originalName:v.original_name,
    size:v.bytes, status:v.status, uploadedAt:v.created_at, reviewedAt:v.reviewed_at};
}
export function parseCookies(input='') {
  return Object.fromEntries(input.split(';').map(s=>s.trim()).filter(Boolean).map(x=>{
    const eq=x.indexOf('='); return [x.slice(0,eq), eq===-1?'':x.slice(eq+1)];
  }));
}
