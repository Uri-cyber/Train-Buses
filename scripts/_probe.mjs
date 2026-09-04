import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const p = await b.newPage({viewport:{width:1000,height:640}});
p.on('pageerror',e=>console.log('ERR',e.message));
await p.goto('http://127.0.0.1:4173/'); await p.waitForFunction(()=>!!window.__app); await p.waitForTimeout(500);
const r = await p.evaluate(()=>{
  const a=window.__app; const sea=a.scene.getObjectByName('sea');
  const out=[]; sea.children.forEach(c=>{ c.geometry.computeBoundingBox(); const bb=c.geometry.boundingBox; out.push({name:c.name, y:+c.position.y.toFixed(2), min:bb.min.toArray().map(v=>+v.toFixed(1)), max:bb.max.toArray().map(v=>+v.toFixed(1)), verts:c.geometry.attributes.position.count, visible:c.visible}); });
  const lakes=a.world.lakes.map(l=>({n:l.name_en, rings:l.rings.map(r=>r.length), first:l.rings[0]?.[0]}));
  return {children:out, lakes, floorAtDeadSea: a.terrain.heightAt(44,55).toFixed(2), floorAtKinneret: a.terrain.heightAt(54,-92).toFixed(2)};
});
console.log(JSON.stringify(r,null,1));
await b.close();
