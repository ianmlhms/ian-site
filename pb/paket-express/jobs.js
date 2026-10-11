/* Pure job generation and payout. A supplied RNG also drives the shared daily route. */
(function(P){
  'use strict';
  const C=P.config;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
  const TYPES=['standard','fragile','express','pizza','multi','heavy','bus'];
  function choose(spec,rank,pool,rng){
    if(spec.id==='bus')return 'bus';
    const W=C.jobWeights,weights=[W.standard,W.fragile+rank,W.express+rank,W.pizza,(spec.stops>=C.multiMinStops?Math.min(W.multi,spec.stops):0),['van','truck'].includes(spec.id)?W.heavy+rank:0,0];
    if(!pool.some(p=>p.district==='Kirchberg'))weights[2]*=.7;
    let value=rng()*weights.reduce((sum,v)=>sum+v,0);
    return TYPES[weights.findIndex(w=>(value-=w)<0)]||'standard';
  }
  function create(player,spec,save,rng=Math.random,type=null){
    const pool=P.places.filter(p=>P.career.allowed(p,save)).map(p=>({...p}));
    if(pool.length<4)throw new Error('Not enough unlocked delivery addresses');
    for(let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}
    const kind=type||choose(spec,P.career.rank(save),pool,rng);
    if(kind==='heavy'&&!['van','truck'].includes(spec.id))throw new Error('Heavy jobs require a cargo vehicle');
    const index=pool.findIndex(p=>distance(player,p)>C.jobTiming.minDistance&&distance(player,p)<C.jobTiming.maxDistance);
    const pickup=pool.splice(Math.max(0,index),1)[0];
    const count=kind==='bus'?Math.min(C.busMaxStops,spec.stops):kind==='multi'?Math.min(C.multiMaxStops,Math.max(C.multiMinStops,spec.stops)):1;
    const nearby=pool.filter(p=>distance(pickup,p)<C.jobTiming.maxDistance&&distance(pickup,p)>C.jobTiming.minDistance);
    const route=[...nearby,...pool.filter(p=>!nearby.includes(p))].slice(0,count);
    const points=[player,pickup,...route],length=points.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-points[i].x)+Math.abs(p.z-points[i].z),0);
    const budget=(C.jobTiming.base+length/(spec.speed*C.jobTiming.speedRate)+count*C.jobTiming.stop)*(kind==='express'?C.expressTime:1);
    const loads=Array.from({length:count},()=>1);for(let i=count;i<spec.stops;i++)loads[(i-count)%count]++;
    return {kind,pickup,route,loads,step:-1,budget,remaining:budget,penalties:0,damage:0,pickedAt:null,completed:[]};
  }
  function crash(job){return {...job,penalties:job.penalties+C.crashCost,damage:job.kind==='fragile'?1-(1-job.damage)*(1-C.fragileLoss):job.damage};}
  function pay(job,spec,now){
    const parcels=job.loads?.[Math.max(0,job.step)]||1,loadBonus=1+(parcels-1)*C.parcelBonus;
    const freshness=job.kind==='pizza'?Math.max(C.pizzaFloor,1-(now-(job.pickedAt??now))/C.pizzaSeconds):1;
    return Math.max(0,Math.floor((spec.base*C.job[job.kind]+Math.max(0,job.remaining)*C.bonusPerSecond)*loadBonus*freshness*spec.bonus*(1-job.damage)-(job.kind==='fragile'?0:job.penalties)));
  }
  function combo(previous,now){const count=now-previous.last<=C.comboSeconds?previous.count+1:1;return {count,last:now,multiplier:C.combo[Math.min(C.combo.length-1,count-1)]};}
  P.jobs={create,crash,pay,combo,emptyCombo:()=>({count:0,last:-Infinity,multiplier:1}),icons:{standard:'📦',fragile:'🥚',express:'⚡',pizza:'🍕',multi:'📦📦',heavy:'🏋️',bus:'🚌'}};
})(window.PX);
