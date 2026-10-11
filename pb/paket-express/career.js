/* Wallet and lifetime are distinct. Whole-save winner prevents resurrecting spent euros. */
(function(P){
  'use strict';
  const C=P.config,MAX=Number.MAX_SAFE_INTEGER;
  const number=n=>typeof n==='number'&&Number.isFinite(n)?Math.max(0,Math.min(MAX,Math.floor(n))):0;
  const unique=(list,allowed)=>[...new Set(Array.isArray(list)?list.filter(x=>allowed.includes(x)):[])];
  function normalize(data={}){
    const lifetime=Math.max(number(data.lifetime),number(data.tb)),legacy=number(data.v)<4;
    const owned=unique(data.owned,C.vehicles.map(v=>v.id));
    C.vehicles.forEach(v=>{if(v.id==='auto'||(legacy&&v.legacy!==undefined&&lifetime>=v.legacy))owned.push(v.id);});
    const upgrades={};
    for(const v of C.vehicles){upgrades[v.id]={};for(const key of Object.keys(C.upgrades))upgrades[v.id][key]=Math.min(3,number(data.upgrades?.[v.id]?.[key]));}
    return {v:4,lifetime,tb:lifetime,wallet:legacy?lifetime:Math.min(lifetime,number(data.wallet)),best:number(data.best),
      owned:[...new Set(owned)],vehicle:owned.includes(data.vehicle)?data.vehicle:'auto',upgrades,
      districts:[...new Set(['Alstad','Garer Quartier',...unique(data.districts,Object.keys(C.districts))])],
      stars:unique(data.stars,Array.from({length:25},(_,i)=>i)),daily:data.daily&&typeof data.daily==='object'?structuredClone(data.daily):{},
      dailyBest:data.dailyBest&&typeof data.dailyBest==='object'?structuredClone(data.dailyBest):{},savedAt:number(data.savedAt)};
  }
  function merge(current,incoming){
    const a=normalize(current),b=normalize(incoming);
    return b.lifetime>a.lifetime||(b.lifetime===a.lifetime&&b.savedAt>a.savedAt)?b:a;
  }
  function earn(save,amount){const value=number(amount),lifetime=Math.min(MAX,save.lifetime+value);return {...save,lifetime,tb:lifetime,wallet:Math.min(MAX,save.wallet+value)};}
  function buy(save,kind,id){
    let price,next=structuredClone(save);
    if(kind==='vehicle'){const v=C.vehicles.find(v=>v.id===id);if(!v||save.owned.includes(id))return null;price=v.price;next.owned=[...save.owned,id];next.vehicle=id;}
    else if(kind==='district'){price=C.districts[id];if(price===undefined||save.districts.includes(id))return null;next.districts=[...save.districts,id];}
    else if(kind==='upgrade'){const level=save.upgrades[save.vehicle]?.[id]||0;price=C.upgrades[id]?.[level];if(price===undefined)return null;next.upgrades[save.vehicle][id]=level+1;}
    else return null;
    if(save.wallet<price)return null;
    return {...next,wallet:save.wallet-price};
  }
  const rank=save=>C.ranks.reduce((rank,threshold,i)=>save.lifetime>=threshold?i:rank,0);
  function spec(save){
    const base=C.vehicles.find(v=>v.id===save.vehicle)||C.vehicles[0],u=save.upgrades[base.id];
    return {...base,speed:base.speed*(1+u.motor*C.motorSpeed),accel:base.accel*(1+u.motor*C.motorAccel),grip:1+u.tyres*C.tyreGrip,stops:base.stops+u.storage,bonus:1+u.battery*C.batteryBonus,color:C.colors[u.paint]};
  }
  function districtAt(point){return point.z>232?(point.x>14?'Parc de la Pétrusse':'Ateliers'):point.x>14?(point.z< -42?'Kirchberg':'Belair'):(point.z< -42?'Alstad':'Garer Quartier');}
  P.career={normalize,merge,earn,buy,rank,spec,districtAt,allowed:(point,save)=>save.districts.includes(point.district||districtAt(point))};
})(window.PX);
