/* Lux Drive: how smooth are the roads?  node scripts/luxdrive/road_smoothness.mjs <path to a pb/lux-drive/ folder, with the trailing slash>
 * Runs on any checkout (the folder decides which road code is measured), so a fix can be compared with the branch it started from.
 * Every 25th carved way is driven along its centre line at 1 m steps (the height the physics surface gives the car); reported, over ALL points of
 * those ways (junction aprons and underpasses included, so the numbers are worse than the harness gate I, which skips them):
 *   bob   the vertical acceleration of a body that follows the profile at 50 km/h (14 m/s), h'' over a 2 m base, in m/s2
 *   dev   the deviation of a point from the mean of the 20 m around it (cm) */
import fs from 'node:fs'; import path from 'node:path';
const R = process.argv[2];
const { loadWorldData } = await import(R + 'world-data.js');
const { createHeightField } = await import(R + 'heightfield.js');
const { createSurface } = await import(R + 'surface.js');
const read = async (name) => new Uint8Array(fs.readFileSync(path.join(R+'data', name)));
const data = await loadWorldData(read);
const field = createHeightField({ near: data.near, far: data.far, roads: data.roads });
const surface = createSurface(field); const net = field.network;
const lineAt=(ch,d,o)=>{let k=0;while(k<ch.arc.length-2&&ch.arc[k+1]<d)k++;const t=(d-ch.arc[k])/Math.max(1e-9,ch.arc[k+1]-ch.arc[k]);o.x=ch.x[k]+(ch.x[k+1]-ch.x[k])*t;o.z=ch.z[k]+(ch.z[k+1]-ch.z[k])*t;return o;};
const chains = (net.chains||[]).filter((c)=>!net.overRoads || !net.overRoads.has(c.road));
// the base has no chains with arc? build from samples
const o={}; const accs=[]; const devs=[]; let n=0;
const list = chains.map((c)=>{ if (c.arc) return c; const arc=new Float64Array(c.x.length); for(let i=1;i<c.x.length;i++) arc[i]=arc[i-1]+Math.hypot(c.x[i]-c.x[i-1],c.z[i]-c.z[i-1]); return {...c, arc}; });
const SPEED=14;
for (let ci=0; ci<list.length; ci+=25) { const ch=list[ci]; const L=ch.arc[ch.arc.length-1]; if (L<30) continue; const m=Math.floor(L); const h=new Float64Array(m+1); for(let q=0;q<=m;q++){lineAt(ch,q,o);h[q]=surface.height(o.x,o.z);} 
 for (let q=10;q<=m-10;q++){ let s=0; for(let j=-10;j<=10;j++) s+=h[q+j]; devs.push(Math.abs(h[q]-s/21)); accs.push(SPEED*SPEED*Math.abs(h[q+2]+h[q-2]-2*h[q])/4); } n++; }
const pct=(a,p)=>{const b=a.slice().sort((x,y)=>x-y); return b[Math.min(b.length-1,Math.floor(b.length*p))];};
console.log(R,'ways',n,'pts',accs.length);
console.log(' bob m/s2 p50',pct(accs,.5).toFixed(3),'p90',pct(accs,.9).toFixed(3),'p99',pct(accs,.99).toFixed(3),'p99.9',pct(accs,.999).toFixed(3),'max',Math.max(...accs).toFixed(2),'share>1',(accs.filter(a=>a>1).length/accs.length*100).toFixed(2)+'%');
console.log(' dev cm p50',(pct(devs,.5)*100).toFixed(2),'p90',(pct(devs,.9)*100).toFixed(2),'p99',(pct(devs,.99)*100).toFixed(2),'max',(Math.max(...devs)*100).toFixed(1),'share>3cm',(devs.filter(a=>a>.03).length/devs.length*100).toFixed(2)+'%');
