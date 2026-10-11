/* Calendar and random streams never depend on the browser's timezone. */
(function(P){
  'use strict';
  function day(date=new Date()){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
  function seed(value){let h=2166136261;for(const c of value)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
  function rng(value){let s=typeof value==='string'?seed(value):value;return ()=>{s=(s+0x6D2B79F5)|0;let t=Math.imul(s^s>>>15,1|s);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
  function list(date){
    const random=rng('missions:'+date),types=['delivery','drift','clean','express','combo'];
    for(let i=types.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[types[i],types[j]]=[types[j],types[i]];}
    return types.slice(0,3).map(kind=>({kind,target:P.config.missionTargets[kind],reward:P.config.dailyReward,district:kind==='delivery'?['Alstad','Garer Quartier','Kirchberg','Belair'][Math.floor(random()*4)]:null}));
  }
  function update(save,event,value=1,district=null,date=day()){
    const daily=save.daily.day===date?structuredClone(save.daily):{day:date,progress:{},claimed:[]};
    daily.progress=daily.progress||{};daily.claimed=Array.isArray(daily.claimed)?daily.claimed:[];
    let reward=0;const completed=[];
    for(const m of list(date)){
      if(m.kind===event&&(!m.district||m.district===district))daily.progress[m.kind]=m.kind==='combo'?Math.max(daily.progress[m.kind]||0,value):(daily.progress[m.kind]||0)+value;
      if((daily.progress[m.kind]||0)>=m.target&&!daily.claimed.includes(m.kind)){daily.claimed.push(m.kind);reward+=m.reward;completed.push(m);}
    }
    return {save:P.career.earn({...save,daily},reward),completed};
  }
  P.missions={day,seed,rng,list,update};
})(window.PX);
