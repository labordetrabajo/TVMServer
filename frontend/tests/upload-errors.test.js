import test from 'node:test';
import assert from 'node:assert/strict';
import {explainUploadError} from '../src/upload-errors.js';

test('informa tamaño máximo según configuración real',()=>{
  const r=explainUploadError(new Error('El archivo supera el límite de tamaño'),500);
  assert.match(r.title,/pesa más/);
  assert.match(r.detail,/500 MB/);
});
test('aclara cómo corregir videos de 60 FPS',()=>{
  const r=explainUploadError(new Error('MP4 rechazado: Video de 60.00 FPS. El máximo recomendado es 30 FPS'),250);
  assert.match(r.title,/FPS/);
  assert.match(r.detail,/30 FPS/);
});
test('aclara cómo corregir resoluciones 4K',()=>{
  const r=explainUploadError(new Error('Resolución 3840×2160 demasiado alta'),250);
  assert.match(r.title,/resolución/);
  assert.match(r.detail,/1080 × 1920/);
});
test('identifica video H.265 incompatible',()=>{
  const r=explainUploadError(new Error('Códec de video incompatible: hevc. Se requiere H.264'),250);
  assert.match(r.title,/formato interno/);
  assert.match(r.detail,/H.264/);
});
test('identifica archivo no MP4',()=>{
  const r=explainUploadError(new Error('Solo se aceptan archivos .mp4'),250);
  assert.match(r.title,/MP4/);
});
test('hace comprensible el error HTTP 413',()=>{
  const r=explainUploadError(new Error('Error HTTP 413'),250);
  assert.match(r.detail,/250 MB/);
});
test('hace comprensible la caída de conexión',()=>{
  const r=explainUploadError(new Error('Failed to fetch'),250);
  assert.match(r.detail,/conexión/);
});
test('no oculta la explicación original ante error inesperado',()=>{
  const r=explainUploadError(new Error('Error extraño de validación'),250);
  assert.match(r.detail,/Error extraño de validación/);
});
