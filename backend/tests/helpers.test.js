import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanEmail, validEmail, goodText, safeOriginalName, parseCookies, sha256 } from '../src/helpers.js';
test('normaliza correo y valida formato',()=>{
  assert.equal(cleanEmail('  EJEMPLO@DOMINIO.COM '),'ejemplo@dominio.com');
  assert.equal(validEmail('ejemplo@dominio.com'),true);
  assert.equal(validEmail('no-es-email'),false);
});
test('filtra caracteres de control en nombre de archivo',()=>{
  assert.equal(safeOriginalName('promo\nventas.mp4'),'promoventas.mp4');
  assert.equal(goodText('  Cliente  ',2,150),true);
});
test('parsea cookie y hash es reproducible',()=>{
  assert.deepEqual(parseCookies('tvm_session=abc; x=y'),{tvm_session:'abc',x:'y'});
  assert.equal(sha256('a'),sha256('a'));
});
