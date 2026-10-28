import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
const execFileAsync = promisify(execFile);
const MAX_DIMENSION = 1920;
const MAX_SHORT_SIDE = 1080;
const MAX_FPS = 30.15; // pequeñas diferencias de timebase / VFR

export function inspectProbe(data) {
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const video = streams.find(s => s.codec_type === 'video');
  if (!video) throw new Error('El MP4 no tiene una pista de video');
  const audio = streams.filter(s => s.codec_type === 'audio');
  const width=Number(video.width), height=Number(video.height);
  const fpsText = video.avg_frame_rate && video.avg_frame_rate!=='0/0' ? video.avg_frame_rate : video.r_frame_rate;
  const parts=String(fpsText||'').split('/').map(Number);
  const fps=parts.length===2 && parts[1] ? parts[0]/parts[1] : Number(fpsText);
  const duration = Number(data?.format?.duration ?? video.duration);
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) throw new Error('No se pudo determinar la resolución');
  if (!Number.isFinite(fps) || fps<=0) throw new Error('No se pudo determinar los cuadros por segundo');
  if (video.codec_name!=='h264') throw new Error(`Códec de video incompatible: ${video.codec_name||'desconocido'}. Se requiere H.264`);
  if (Math.max(width,height)>MAX_DIMENSION || Math.min(width,height)>MAX_SHORT_SIDE)
    throw new Error(`Resolución ${width}×${height} demasiado alta para Raspberry Pi 3 (máximo Full HD, horizontal o vertical)`);
  if (fps>MAX_FPS) throw new Error(`Video de ${fps.toFixed(2)} FPS. El máximo recomendado es 30 FPS`);
  if (audio.some(a=>a.codec_name!=='aac')) throw new Error('Códec de audio incompatible. Se requiere AAC o video sin audio');
  if (!Number.isFinite(duration) || duration<=0) throw new Error('Duración de video inválida');
  return {status:'compatible',videoCodec:'h264',audioCodec:audio.length?'aac':null,width,height,fps:Math.round(fps*100)/100,durationSeconds:Math.round(duration*100)/100};
}
export async function ffprobeReady(executable=process.env.FFPROBE_PATH||'ffprobe') {
  try { await execFileAsync(executable,['-version'],{timeout:4000,windowsHide:true,maxBuffer:128*1024});return true; }
  catch { return false; }
}
export async function inspectVideo(filepath,{required=process.env.REQUIRE_FFPROBE==='true',executable=process.env.FFPROBE_PATH||'ffprobe'}={}) {
  try {
    const {stdout}=await execFileAsync(executable,['-v','error','-show_format','-show_streams','-of','json',filepath],{timeout:30000,windowsHide:true,maxBuffer:2*1024*1024});
    return inspectProbe(JSON.parse(stdout));
  } catch(e) {
    if (e.code==='ENOENT') {
      if (required) throw new Error('FFprobe no está instalado. Se requiere para validar MP4 antes de publicarlos.');
      return {status:'unverified',videoCodec:null,audioCodec:null,width:null,height:null,fps:null,durationSeconds:null};
    }
    throw new Error('MP4 rechazado: '+e.message);
  }
}
