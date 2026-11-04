// Los errores de carga deben explicar qué falló y qué puede hacer el cliente.
export function explainUploadError(error,maxUploadMb){
  const detail=String(error?.message||'Ocurrió un problema inesperado.').trim();
  const text=detail.toLowerCase();
  if(/límite de tamaño|demasiado grande|limit_file_size|http 413|request entity too large|payload too large/.test(text))
    return {title:'El video pesa más de lo permitido',detail:`El límite configurado es ${maxUploadMb?maxUploadMb+' MB':'el indicado por el servidor'}. Comprimí el MP4 y volvé a intentarlo.`};
  if(/resolución|resolution|demasiado alta/.test(text))
    return {title:'La resolución del video no es compatible',detail:`${detail} Exportalo como máximo a 1080 × 1920 (vertical) o 1920 × 1080 (horizontal).`};
  if(/fps|cuadros por segundo|frame rate/.test(text))
    return {title:'El video tiene demasiados FPS',detail:`${detail} Exportalo a 30 FPS y volvé a subirlo.`};
  if(/h\.264|h264|códec de video/.test(text))
    return {title:'El formato interno del video no es compatible',detail:`${detail} Elegí MP4 con video H.264 (no H.265/HEVC).`};
  if(/aac|códec de audio/.test(text))
    return {title:'El audio del video no es compatible',detail:`${detail} Exportalo con audio AAC o sin sonido.`};
  if(/\.mp4|cabecera mp4|pista de video/.test(text))
    return {title:'El archivo no es un MP4 válido',detail:`${detail} Volvé a exportarlo como MP4 con H.264.`};
  if(/ffprobe/.test(text))
    return {title:'No pudimos verificar el video',detail:`${detail} Avisale al administrador de GyA Digital para revisar el servidor.`};
  if(/failed to fetch|networkerror|no pudimos conectarnos|no se pudo conectar|error http 502|error http 503|error http 504|error http 500|error http 404/.test(text))
    return {title:'No pudimos completar la subida',detail:'No se pudo establecer una conexión estable con el servidor. Comprobá Internet y volvé a intentarlo. Si persiste, contactá a GyA Digital.'};
  return {title:'No se pudo subir el video',detail:`${detail} Revisá el archivo y volvé a intentarlo. Si persiste, contactá a GyA Digital.`};
}
