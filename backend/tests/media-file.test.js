import test from 'node:test';
import assert from 'node:assert/strict';
import {isManagedVideoName} from '../src/media-file.js';
const id='bcf19c7e-21cf-4aa3-9f1d-5c3931493b40';
test('acepta exclusivamente el nombre interno perteneciente a ese video',()=>{
  assert.equal(isManagedVideoName(id+'.mp4',id),true);
  assert.equal(isManagedVideoName(id.toUpperCase()+'.mp4',id),false);
  assert.equal(isManagedVideoName(id+'.mp4','aaaaaaaa-21cf-4aa3-9f1d-5c3931493b40'),false);
});
test('rechaza rutas y nombres externos',()=>{
  assert.equal(isManagedVideoName('../'+id+'.mp4',id),false);
  assert.equal(isManagedVideoName(id+'.mp4.exe',id),false);
  assert.equal(isManagedVideoName('promo.mp4',id),false);
  assert.equal(isManagedVideoName(id+'.MP4',id),false);
});
