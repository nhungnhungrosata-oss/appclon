import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mediaFilename, validateHandoff, zipStored, buildHandoffBundle, FISH_CREATIVE_URL, HANDOFF_PROVIDER } from '../public/fish-handoff.js';
const visual = {kind:'video', blob:new Blob(['video'],{type:'video/webm'}), duration:12};
const audio = {kind:'audio', blob:new Blob(['audio'],{type:'audio/mpeg'}), duration:10};
const image = {kind:'image', blob:new Blob(['image'],{type:'image/png'})};
const crc32 = bytes => {
  let c = 0xffffffff;
  for(const b of bytes){ c ^= b; for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1; }
  return (c^0xffffffff)>>>0;
};
async function parseZip(blob) {
  const b=Buffer.from(await blob.arrayBuffer()); let offset=0; const entries=[];
  while(b.readUInt32LE(offset)===0x04034b50){
    assert.equal(b.readUInt16LE(offset+8),0); // Stored files, not deflated.
    const size=b.readUInt32LE(offset+18), len=b.readUInt16LE(offset+26), extra=b.readUInt16LE(offset+28);
    const name=b.subarray(offset+30,offset+30+len).toString('utf8');
    const dataStart=offset+30+len+extra, data=b.subarray(dataStart,dataStart+size);
    assert.equal(data.length,size); assert.equal(crc32(data),b.readUInt32LE(offset+14));
    entries.push({name,data,offset}); offset=dataStart+size;
  }
  const centralStart=offset;
  for(const entry of entries){
    assert.equal(b.readUInt32LE(offset),0x02014b50);
    assert.equal(b.readUInt32LE(offset+42),entry.offset);
    const len=b.readUInt16LE(offset+28);
    assert.equal(b.subarray(offset+46,offset+46+len).toString(),entry.name);
    offset+=46+len;
  }
  assert.equal(b.readUInt32LE(offset),0x06054b50);
  assert.equal(b.readUInt16LE(offset+10),entries.length);
  assert.equal(b.readUInt32LE(offset+12),offset-centralStart);
  assert.equal(b.readUInt32LE(offset+16),centralStart);
  assert.equal(b.length,offset+22);
  return entries;
}
test('handoff accepts image or video with audio, without credentials',()=>{
  validateHandoff(visual,audio); validateHandoff(image,audio);
  assert.equal(FISH_CREATIVE_URL,'https://fish.audio/app/image-video/');
  assert.equal(HANDOFF_PROVIDER,'fish-creative-web');
});
test('handoff preserves WebM extension and rejects unsafe prefixes',()=>{
  assert.equal(mediaFilename(visual,'01-source'),'01-source.webm');
  assert.equal(mediaFilename(audio,'02-voice'),'02-voice.mp3');
  assert.throws(()=>mediaFilename(visual,'../../bad'));
  assert.throws(()=>mediaFilename({blob:new Blob(['bad'],{type:'text/html'})}));
});
test('handoff rejects missing, empty, mismatched and unsupported inputs',()=>{
  assert.throws(()=>validateHandoff(null,audio));
  assert.throws(()=>validateHandoff(visual,{...audio,blob:new Blob([],{type:'audio/mpeg'})}));
  assert.throws(()=>validateHandoff({...visual,blob:new Blob(['x'],{type:'text/html'})},audio));
  assert.throws(()=>validateHandoff({...visual,blob:audio.blob},audio));
  assert.throws(()=>validateHandoff(audio,visual));
});
test('handoff rejects unbounded or overlong durations and oversized media',()=>{
  for(const duration of [NaN,Infinity,0,181]) assert.throws(()=>validateHandoff({...visual,duration},audio));
  const large = new Blob([new Uint8Array(81*1024*1024)],{type:'video/mp4'});
  assert.throws(()=>validateHandoff({...visual,blob:large},audio));
  assert.throws(()=>validateHandoff({...image,blob:new Blob([large.slice(0,21*1024*1024)],{type:'image/png'})},audio));
});
test('ZIP writer produces valid headers, central directory and CRC32',async()=>{
  const progress=[];
  const blob=await zipStored([{name:'a.txt',blob:new Blob(['123456789'])},{name:'b.txt',blob:new Blob(['Xin chao \u1ebf'])}],(a,b)=>progress.push([a,b]));
  const entries=await parseZip(blob);
  assert.equal(entries[0].data.toString(),'123456789');
  assert.equal(crc32(entries[0].data),0xcbf43926);
  assert.equal(entries[1].data.toString(),'Xin chao \u1ebf');
  assert.deepEqual(progress,[[1,2],[2,2]]);
});
test('ZIP writer rejects path traversal, duplicate names and invalid entries',async()=>{
  for(const name of ['../x','/x','a/b','a\\b','<script>']) await assert.rejects(zipStored([{name,blob:new Blob(['x'])}]));
  await assert.rejects(zipStored([]));
  await assert.rejects(zipStored([{name:'x',blob:new Blob([])},{name:'x',blob:new Blob([])}]));
  await assert.rejects(zipStored([{name:'x',blob:'not-a-blob'}]));
});
test('export bundle is local, contains expected files and excludes private metadata',async()=>{
  const id='12345678-1111-4222-8333-123456789abc';
  const bundle=await buildHandoffBundle({visual:{...visual,token:'do-not-export',username:'private-user'},audio,script:'Hello',id});
  const entries=await parseZip(bundle.blob);
  assert.deepEqual(entries.map(e=>e.name),['01-source.webm','02-voice.mp3','03-script.txt','READ_ME_VI.txt','project.json']);
  assert.equal(entries[2].data.toString(),'Hello');
  const manifest=JSON.parse(entries[4].data.toString());
  assert.equal(manifest.autoSubmitted,false); assert.equal(manifest.mode,'manual-web-handoff');
  assert.equal(manifest.projectId,id); assert.equal(manifest.files[0].mime,'video/webm');
  assert.ok(!JSON.stringify(manifest).includes('do-not-export'));
  assert.ok(!JSON.stringify(manifest).includes('private-user'));
  assert.match(entries[3].data.toString(),/Fish Creative|Fish Audio/);
});
test('export accepts PNG plus WAV and rejects invalid IDs or oversized scripts',async()=>{
  const a={...audio,blob:new Blob(['wave'],{type:'audio/wav'})};
  const {blob}=await buildHandoffBundle({visual:image,audio:a,id:'12345678'});
  assert.equal((await parseZip(blob))[0].name,'01-source.png');
  await assert.rejects(buildHandoffBundle({visual,audio,id:'../bad'}));
  await assert.rejects(buildHandoffBundle({visual,audio,id:'12345678',script:'x'.repeat(50001)}));
});
test('runtime has no old vendor domains or credentials; CSP blocks remote media',async()=>{
  for(const path of ['lib/providers.mjs','public/app.js','public/fish-handoff.js','.env.example']){
    const source=await readFile(new URL('../'+path,import.meta.url),'utf8');
    assert.doesNotMatch(source,/FAL_KEY|fal\.ai|fal\.run|fal\.media|fishaudio\.org/i);
  }
  const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url),'utf8'));
  const csp=config.headers[0].headers.find(h=>h.key.toLowerCase()==='content-security-policy').value;
  assert.match(csp,/connect-src 'self';/); assert.match(csp,/media-src 'self' blob:;/);
});
