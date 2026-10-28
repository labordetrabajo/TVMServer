import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTotemIds, parseMultipartTotemIds, validPassword } from '../src/publication-utils.js';
const a='00000000-0000-4000-8000-000000000001';
const b='00000000-0000-4000-8000-000000000002';
test('valida múltiples tótems',()=>{assert.deepEqual(normalizeTotemIds([a,b]),[a,b]);assert.deepEqual(parseMultipartTotemIds(JSON.stringify([a])),[a]);});
test('rechaza lista vacía, duplicados, ids inválidos, JSON roto',()=>{
  assert.throws(()=>normalizeTotemIds([]));assert.throws(()=>normalizeTotemIds([a,a]));
  assert.throws(()=>normalizeTotemIds(['no-es-uuid']));assert.throws(()=>parseMultipartTotemIds('{'));
});
test('contraseñas fuertes entre 12 y 128 caracteres',()=>{
  assert.equal(validPassword('123456789012'),true);assert.equal(validPassword('12345'),false);
  assert.equal(validPassword('a'.repeat(129)),false);assert.equal(validPassword(undefined),false);
});
