import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDateRange,parseScheduleDate} from '../src/schedule-dates.js';
test('fecha con zona horaria',()=>{
  assert.equal(parseScheduleDate('2026-10-30T12:00:00.000Z').toISOString(),'2026-10-30T12:00:00.000Z');
  assert.equal(parseScheduleDate('2026-10-30T09:00:00-03:00').toISOString(),'2026-10-30T12:00:00.000Z');
  assert.throws(()=>parseScheduleDate('2026-10-30T09:00'));
  assert.throws(()=>parseScheduleDate('esto-no-es-fecha'));
});
test('solicitud sin inicio es opcional',()=>{
  assert.deepEqual(parseDateRange('',null,{optionalStart:true}),{startsAt:null,endsAt:null});
  assert.throws(()=>parseDateRange(null,'2026-10-30T12:00:00Z',{optionalStart:true}));
});
test('finalización siempre posterior al inicio',()=>{
  assert.throws(()=>parseDateRange('2026-10-30T12:00:00Z','2026-10-29T12:00:00Z'));
  assert.throws(()=>parseDateRange('2026-10-30T12:00:00Z','2026-10-30T12:00:00Z'));
  assert.ok(parseDateRange('2026-10-30T12:00:00Z','2026-10-31T12:00:00Z').endsAt);
});
