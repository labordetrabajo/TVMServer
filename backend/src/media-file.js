// Los archivos del servidor se generan exclusivamente como UUID.mp4.
// Jamás construir rutas de borrado con nombres originales suministrados por usuarios.
export function isManagedVideoName(storedName,videoId) {
  if(typeof storedName!=='string'||typeof videoId!=='string')return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mp4$/.test(storedName)
    && storedName.toLowerCase()===`${videoId.toLowerCase()}.mp4`;
}
