import test from 'node:test';
import assert from 'node:assert/strict';
// Proveemos env para cargar config sin backend ni base real.
process.env.DATABASE_URL ||= 'postgresql://user:password@127.0.0.1:5432/tvm_dev';
const {sumVideoBytes,volumeStats}=await import('../src/storage-stats.js');
test('suma uso de almacenamiento sin truncar strings de PostgreSQL',()=>{
 assert.equal(sumVideoBytes([{bytes:'1234'},{bytes:'2048'},{bytes:7}]),3289);
});
test('informa disco libre usando bavail sin confundirlo con uso TVM',()=>{
 assert.deepEqual(volumeStats({bsize:4096,blocks:1000,bavail:300}),{totalBytes:4096000,freeBytes:1228800});
});
