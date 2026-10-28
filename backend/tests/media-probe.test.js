import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProbe, inspectVideo, ffprobeReady } from '../src/media-probe.js';
const probe=(video={},audio='aac')=>({format:{duration:'14.12'},streams:[{codec_type:'video',codec_name:'h264',width:1080,height:1920,avg_frame_rate:'30000/1001',...video},...(audio?[{codec_type:'audio',codec_name:audio}]:[])]});
test('H.264 AAC Full HD vertical y horizontal son compatibles',()=>{
 const r=inspectProbe(probe());assert.equal(r.status,'compatible');assert.equal(r.width,1080);assert.equal(r.height,1920);
 assert.equal(inspectProbe(probe({width:1920,height:1080},null)).audioCodec,null);
});
test('rechaza HEVC, 4K, 60 fps y audio incompatible',()=>{
 assert.throws(()=>inspectProbe(probe({codec_name:'hevc'})),/H.264/);
 assert.throws(()=>inspectProbe(probe({width:3840,height:2160})),/Resolución/);
 assert.throws(()=>inspectProbe(probe({avg_frame_rate:'60/1'})),/FPS/);
 assert.throws(()=>inspectProbe(probe({},'mp3')),/AAC/);
});
test('falta de pista de video o duración invalida',()=>{
 assert.throws(()=>inspectProbe({streams:[]}),/pista de video/);
 assert.throws(()=>inspectProbe({...probe(),format:{duration:0}}),/Duración/);
});
test('modo desarrollo sin FFprobe no falsea compatibilidad',async()=>{
 const r=await inspectVideo('/tmp/not-a-real-file',{required:false,executable:'ffprobe-inexistente-tvm-12345'});
 assert.equal(r.status,'unverified');
 await assert.rejects(()=>inspectVideo('/tmp/not-a-real-file',{required:true,executable:'ffprobe-inexistente-tvm-12345'}),/FFprobe/);
});
