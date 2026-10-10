/* Shared idle-game rewards. All calendar decisions use Luxembourg time. */
(function(){
  const HOUR=3600,STAR_BONUS=0.1,ACTIVE_MS=15*60*1000,AWAY_BASE_RATE=0.25,AWAY_STAR_RATE=0.0375,MIN_SPAWN_MS=45000,SPAWN_RANGE_MS=45000,PUMPKIN_MS=8000;
  const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'});
  function day(now=Date.now()){
    const parts=Object.fromEntries(dayFormat.formatToParts(now).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function halloween(){const today=day();return window.__pbHalloween===true||(today>='2026-10-24'&&today<='2026-11-02')}
  function multiplier(stars){return 1+stars*STAR_BONUS}
  // Away (tab closed) and inactive (open but untouched) earn the same reduced rate,
  // so leaving a tab running all night is no better than closing it.
  function awayRate(stars){return Math.min(1,AWAY_BASE_RATE+AWAY_STAR_RATE*stars)}
  function capHoursFor(stars){return Math.min(12,8+0.25*stars)}
  function offline(stars,savedAt,production,now=Date.now()){
    const capHours=capHoursFor(stars);
    const seconds=Number.isFinite(savedAt)?Math.min(capHours*HOUR,Math.max(0,(now-savedAt)/1000)):0;
    return {seconds,capHours,credited:seconds*production*awayRate(stars)};
  }
  let lastInput=Date.now();
  const sleepListeners=new Set();
  function markActive(){
    const wasIdle=!isActive();
    lastInput=Date.now();
    if(wasIdle)sleepListeners.forEach(fn=>fn());
  }
  ['pointerdown','keydown','touchstart'].forEach(type=>document.addEventListener(type,markActive,{capture:true,passive:true}));
  function isActive(now=Date.now()){return now-lastInput<ACTIVE_MS}
  /** Passive production factor: 1 while playing, the away rate when untouched for 15 min, 0 after the away cap. */
  function activityRate(stars,now=Date.now()){
    const idleMs=now-lastInput;
    if(idleMs<ACTIVE_MS)return 1;
    if(idleMs>capHoursFor(stars)*HOUR*1000)return 0;
    return awayRate(stars);
  }
  function mount(options){
    const box=document.createElement('div');box.className='idle-rewards';
    box.innerHTML='<span class="idle-stars"></span><button type="button" class="idle-rebirth">⭐ Rebirth</button><span class="idle-progress"></span><button type="button" class="idle-gift" hidden></button><p class="idle-away" role="status" hidden></p><p class="idle-sleep" role="status" hidden></p>';
    options.host.prepend(box);
    const dialog=document.createElement('dialog');dialog.className='idle-dialog';
    dialog.setAttribute('aria-label','Confirm rebirth');
    dialog.innerHTML='<h2>⭐ Rebirth?</h2><p class="idle-reset"></p><p class="idle-keep"></p><p class="idle-preview"></p><div><button type="button" class="idle-cancel">Cancel</button><button type="button" class="idle-confirm">Confirm rebirth</button></div>';
    document.body.append(dialog);
    const find=selector=>box.querySelector(selector);
    let streak=window.__pbStreak,noticeShown=false;
    function refresh(){
      const save=options.read(),earned=Math.floor(Math.sqrt(save.rb/options.threshold));
      const sleep=find('.idle-sleep'),rate=activityRate(save.st);
      sleep.hidden=rate===1;
      if(rate<1)sleep.textContent=rate===0?'💤 Inactive too long · production paused · tap to play':`💤 Inactive · ${Math.round(rate*100)}% production · tap to play`;
      find('.idle-stars').textContent=`⭐ ${options.format(save.st)} · +${options.format(save.st*10)}%`;
      find('.idle-rebirth').disabled=earned<1;
      find('.idle-progress').textContent=earned<1?`${options.format(save.rb)} / ${options.format(options.threshold)} this round`:`+${options.format(earned)} stars ready`;
      const gift=find('.idle-gift'),known=Number.isFinite(streak?.streak)&&streak.streak>=1;
      gift.hidden=!known||save.gd===day();
      if(known)gift.textContent=`🎁 Daily gift · ${Math.min(2,1+0.1*(streak.streak-1)).toFixed(1)}× · 🔥 ${streak.streak}`;
    }
    find('.idle-rebirth').addEventListener('click',()=>{
      const earned=Math.floor(Math.sqrt(options.read().rb/options.threshold));
      if(earned<1)return;
      dialog.querySelector('.idle-reset').textContent='Resets: '+options.resets;
      dialog.querySelector('.idle-keep').textContent='Keeps: stars, lifetime total (leaderboard score), rebirth count, daily gift day'+(options.keeps?', '+options.keeps:'.');
      dialog.querySelector('.idle-preview').textContent=`You get ${options.format(earned)} stars (+${options.format(earned*10)}% production).`;
      dialog.showModal();
    });
    dialog.querySelector('.idle-cancel').addEventListener('click',()=>dialog.close());
    dialog.querySelector('.idle-confirm').addEventListener('click',()=>{
      if(Math.floor(Math.sqrt(options.read().rb/options.threshold))<1)return;
      options.rebirth();dialog.close();options.save();refresh();
    });
    find('.idle-gift').addEventListener('click',()=>{
      const today=day();
      if(!Number.isFinite(streak?.streak)||streak.streak<1||options.read().gd===today)return;
      options.gift(today,600*options.production()*Math.min(2,1+0.1*(streak.streak-1)));
      options.save();refresh();
    });
    window.addEventListener('message',event=>{
      if(event.source!==parent||!event.data||!('__pbStreak' in event.data))return;
      streak=event.data.__pbStreak;window.__pbStreak=streak;refresh();
    });
    function notice(result){
      if(noticeShown||result.seconds<5)return;
      noticeShown=true;
      find('.idle-away').hidden=false;
      find('.idle-away').textContent=`While you were away: +${options.format(result.credited)} ${options.currency} (${result.capHours} h max)`;
    }
    function spawnPumpkin(){
      if(!halloween())return;
      const pumpkin=document.createElement('button');pumpkin.type='button';pumpkin.className='idle-pumpkin';
      pumpkin.textContent='🎃';pumpkin.setAttribute('aria-label','Catch pumpkin');
      pumpkin.style.left=(12+Math.random()*Math.max(0,innerWidth-84))+'px';
      pumpkin.style.top=(12+Math.random()*Math.max(0,innerHeight-120))+'px';
      document.body.append(pumpkin);
      const expiry=setTimeout(()=>pumpkin.remove(),PUMPKIN_MS);
      pumpkin.addEventListener('click',()=>{
        clearTimeout(expiry);const rect=pumpkin.getBoundingClientRect();pumpkin.remove();
        const amount=30*options.production();options.earn(amount);options.save();
        const floating=document.createElement('span');floating.className='idle-float';floating.textContent='+'+options.format(amount);
        floating.style.left=Math.min(rect.left,Math.max(0,innerWidth-100))+'px';floating.style.top=rect.top+'px';
        document.body.append(floating);setTimeout(()=>floating.remove(),1000);
        try{parent.postMessage({__pbEvent:{event:'halloween-2026',count:1}},'*')}
        catch(error){console.warn('[Idle rewards] Pumpkin delivery failed',error)}
      },{once:true});
    }
    function schedulePumpkin(){setTimeout(()=>{spawnPumpkin();schedulePumpkin()},MIN_SPAWN_MS+Math.random()*SPAWN_RANGE_MS)}
    document.body.classList.toggle('idle-halloween',halloween());
    if(halloween())schedulePumpkin();
    refresh();return Object.freeze({refresh,notice});
  }
  window.IdleExtras=Object.freeze({day,halloween,multiplier,offline,awayRate,activityRate,isActive,mount});
})();
