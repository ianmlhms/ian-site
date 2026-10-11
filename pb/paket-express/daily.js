/* RPCs use the existing arcade bridge; the iframe owns no credentials. */
(function(P){
  'use strict';
  const pending=new Map(),TIMEOUT=10000;let nextId=0;
  function rpc(fn,args){
    return new Promise((resolve,reject)=>{
      if(parent===window){reject(new Error('signed-out'));return;}
      const id='paket-'+(++nextId),timer=setTimeout(()=>{pending.delete(id);reject(new Error('RPC timeout'));},TIMEOUT);
      pending.set(id,{resolve,reject,timer});
      try{parent.postMessage({__pbRpc:{id,fn,args}},new URL(document.baseURI).origin);}
      catch(error){clearTimeout(timer);pending.delete(id);reject(error);}
    });
  }
  window.addEventListener('message',event=>{
    if(event.source!==parent||event.origin!==new URL(document.baseURI).origin)return;
    const response=event.data?.__pbRpcRes,request=pending.get(response?.id);if(!request)return;
    clearTimeout(request.timer);pending.delete(response.id);
    if(response.error)request.reject(new Error(response.error));else request.resolve(response.data);
  });
  function route(date){
    const random=P.missions.rng('route:'+date),save=P.career.normalize(),spec={...P.career.spec(save),stops:P.config.dailySlots};
    let position={x:-25,z:3};
    return Array.from({length:P.config.dailyJobs},(_,i)=>{
      const job=P.jobs.create(position,spec,save,random,['standard','fragile','express','pizza','multi','standard','express','fragile'][i]);
      position=job.route[job.route.length-1];return job;
    });
  }
  P.daily={rpc,route,board:()=>rpc('daily_board',{p_game:'paket-express-daily'}),submit:score=>rpc('submit_daily_score',{p_game:'paket-express-daily',p_score:score})};
})(window.PX);
