const assert=require("node:assert/strict");
const path=require("node:path");
const fs=require("node:fs");
const gst=require("../build/Release/lampa_dts_gst.node");
const source=path.resolve(process.argv[2]||"test/fixtures/gst-dts.mkv");
assert.ok(fs.statSync(source).size>1000);
let bytes=0,parts=0,audible=0,done=false;
const timer=setTimeout(()=>{
  if(done)return;
  done=true;console.error("DTS PCM timeout",gst.stats());gst.stop();process.exitCode=1;
},20000);
gst.start(source,0,(pcm)=>{
  if(done)return;
  assert.ok(Buffer.isBuffer(pcm));
  assert.equal(pcm.length%8,0);
  bytes+=pcm.length;parts++;
  for(let i=0;i<pcm.length;i+=4){
    if(Math.abs(pcm.readFloatLE(i))>0.001){audible++;break;}
  }
  if(bytes>75000){
    done=true;clearTimeout(timer);
    const stats=gst.stats();gst.stop();
    assert.ok(parts>2,"PCM must be streamed");
    assert.ok(audible>2,"PCM must be audible");
    assert.ok(stats.bytes>=bytes);
    assert.equal(gst.stats().running,false);
    console.log(JSON.stringify({passed:true,bytes,parts,audible}));
  }
});
