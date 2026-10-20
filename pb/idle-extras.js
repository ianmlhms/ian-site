/* Shared idle-game rewards. All calendar decisions use Luxembourg time.
 * mount() options a game may add: starsText(save) and rebirthPreview(earnedStars) replace the default star bonus
 * texts (Business Empire soft-caps its prestige bonus, so +N% would be wrong there).
 * Reset safety (20 Oct 2026, after a Business Empire player lost her round to one tap on "Reset for 1"):
 * every destructive reset dialog focuses Cancel, keeps its confirm button locked for the first second, asks for a
 * 1.5 s press-and-hold when the gain is small (makeGuard + advise), and offers a 30 s Undo afterwards (offerUndo).
 * mount() also takes snapshot() / restore(snap) / undoKey / roundStart() / bonus(stars) for that. */
(function(){
  const OPEN_LOCK_MS=1000,HOLD_MS=1500,UNDO_MS=30000,WORTH_GAIN=2,WEAK_GAIN=1.25,SMALL_SHARE=0.1;
  const HOUR=3600,STAR_BONUS=0.1,ACTIVE_MS=15*60*1000,AWAY_BASE_RATE=0.25,AWAY_STAR_RATE=0.0375,MIN_SPAWN_MS=45000,SPAWN_RANGE_MS=45000,PUMPKIN_MS=8000;
  // Arcade test mode: everything unlocked, nothing counts (the games refill their own balances).
  const TEST_MODE=window.__pbTestMode===true;
  const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Luxembourg',year:'numeric',month:'2-digit',day:'2-digit'});
  function day(now=Date.now()){
    const parts=Object.fromEntries(dayFormat.formatToParts(now).map(part=>[part.type,part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  function halloween(){const today=day();return TEST_MODE||window.__pbHalloween===true||(today>='2026-10-24'&&today<='2026-11-02')}
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

  /** "45 s", "12 min", "3.5 h", "2.4 days" */
  function duration(ms){
    const trim=n=>String(n).replace(/\.0$/,'');
    const seconds=ms/1000;
    if(seconds<90)return Math.max(1,Math.round(seconds))+' s';
    const minutes=seconds/60;
    if(minutes<90)return Math.round(minutes)+' min';
    const hours=minutes/60;
    if(hours<48)return trim(hours<10?hours.toFixed(1):Math.round(hours))+' h';
    const days=hours/24;
    return trim(days<10?days.toFixed(1):Math.round(days))+' days';
  }
  /** Is a reset worth it? before/after = total profit bonus now and after the claim. roundMs = how long this round has
   * run (0 = unknown). small = true when the claim is a small step for the player (needs the hold either way). */
  function advise({before,after,roundMs=0,small=false,format=String}){
    const ratio=before>0&&Number.isFinite(after/before)?after/before:1;
    const level=ratio<WEAK_GAIN?'bad':ratio<WORTH_GAIN||small?'low':'ok';
    const times=value=>value<1000?String(Math.round(value*100)/100):format(value);   // the games' own formats drop the decimals of small numbers
    const lines=[`Profit bonus ×${times(before)} → ×${times(after)} (${ratio>=10?'×'+times(ratio):'+'+Math.round((ratio-1)*100)+'%'}).`];
    if(roundMs>=60000){
      lines.push(ratio>1.0001
        ?`This round took about ${duration(roundMs)}. Starting over pays for itself after about ${duration(roundMs/(ratio-1))} of play.`
        :`This round took about ${duration(roundMs)} and the reset would not make you faster at all.`);
    }
    if(level==='bad')lines.push('Not worth it yet: you would give up this whole round for a tiny bonus. Keep playing.');
    else if(level==='low')lines.push('Small gain. Most players wait until the bonus at least doubles (×2).');
    return{ratio,level,needsHold:level!=='ok',lines};
  }
  /** Confirm button guard: locked for OPEN_LOCK_MS after arm(), then either a plain click or (needsHold) a press-and-hold of
   * HOLD_MS (pointer or Enter/Space held down; a bare click, a double tap or a key tap does nothing). */
  function makeGuard(button){
    let cfg=null,unlockTimer=0,holdTimer=0,raf=0,heldSince=0,holding=false;
    const progress=fraction=>button.style.setProperty('--hold',String(Math.round(fraction*100)));
    function stopHold(){
      if(!holding)return;
      holding=false;cancelAnimationFrame(raf);clearTimeout(holdTimer);progress(0);
      button.classList.remove('idle-holding');
      if(cfg)button.textContent=cfg.holdLabel;
    }
    // The timer decides, the animation frame only draws the fill (a busy or slow device must not stretch the hold).
    function step(){
      if(!holding)return;
      progress(Math.min(1,(performance.now()-heldSince)/HOLD_MS));
      raf=requestAnimationFrame(step);
    }
    function complete(){
      if(!holding)return;
      holding=false;cancelAnimationFrame(raf);button.classList.remove('idle-holding');progress(0);
      const done=cfg;disarm();if(done)done.onConfirm();
    }
    function startHold(){
      if(holding||!cfg||!cfg.needsHold||button.disabled)return;
      holding=true;heldSince=performance.now();
      button.classList.add('idle-holding');button.textContent=cfg.holdingLabel;
      raf=requestAnimationFrame(step);holdTimer=setTimeout(complete,HOLD_MS);
    }
    function disarm(){
      clearTimeout(unlockTimer);stopHold();cfg=null;button.disabled=true;
    }
    button.classList.add('idle-guard');
    button.addEventListener('pointerdown',event=>{if(event.button===0||event.pointerType==='touch')startHold()});
    ['pointerup','pointercancel','pointerleave','blur'].forEach(type=>button.addEventListener(type,stopHold));
    button.addEventListener('contextmenu',event=>event.preventDefault());
    button.addEventListener('keydown',event=>{
      if(event.key!=='Enter'&&event.key!==' ')return;
      event.preventDefault();if(!event.repeat)startHold();
    });
    button.addEventListener('keyup',event=>{if(event.key==='Enter'||event.key===' ')stopHold()});
    button.addEventListener('click',event=>{
      if(!cfg||button.disabled){event.preventDefault();return}
      if(cfg.needsHold){event.preventDefault();return}
      const done=cfg;disarm();done.onConfirm();
    });
    return Object.freeze({
      arm(options){
        disarm();
        cfg={holdLabel:'',holdingLabel:'Keep holding…',...options};
        button.textContent=options.needsHold?cfg.holdLabel:options.plainLabel;
        button.classList.toggle('idle-hold',Boolean(options.needsHold));
        button.setAttribute('aria-label',options.needsHold?`${cfg.holdLabel}. Press and hold for ${HOLD_MS/1000} seconds to confirm.`:options.plainLabel);
        unlockTimer=setTimeout(()=>{button.disabled=false},OPEN_LOCK_MS);
      },
      disarm
    });
  }
  const UNDO_STORE='idle_undo_';
  function undoStorage(key){return UNDO_STORE+(TEST_MODE?'test_':'')+key}
  function undoRead(key){
    try{
      const entry=JSON.parse(localStorage.getItem(undoStorage(key))||'null');
      return entry&&Number.isFinite(entry.until)&&entry.until>Date.now()&&entry.snap?entry:null;
    }catch(error){console.warn('[Idle rewards] Could not read the undo entry',error);return null}
  }
  function undoWrite(key,entry){
    try{
      if(entry)localStorage.setItem(undoStorage(key),JSON.stringify(entry));
      else localStorage.removeItem(undoStorage(key));
    }catch(error){console.warn('[Idle rewards] Could not store the undo entry',error)}
  }
  /** Bottom toast with an Undo button until `until`. onUndo / onGone run once. */
  function undoToast({label,until,onUndo,onGone}){
    document.querySelectorAll('.idle-undo').forEach(old=>old.remove());
    const toast=document.createElement('div');toast.className='idle-undo';toast.setAttribute('role','status');
    const text=document.createElement('span');text.textContent=label;
    const button=document.createElement('button');button.type='button';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='idle-undo-x';dismiss.textContent='×';dismiss.setAttribute('aria-label','Dismiss');
    toast.append(text,button,dismiss);document.body.append(toast);
    let finished=false;
    const refreshLabel=()=>{button.textContent=`Undo (${Math.max(0,Math.ceil((until-Date.now())/1000))})`};
    const finish=action=>{
      if(finished)return;finished=true;clearInterval(timer);toast.remove();action();
    };
    const timer=setInterval(()=>{if(Date.now()>=until)finish(onGone);else refreshLabel()},500);
    refreshLabel();
    button.addEventListener('click',()=>finish(onUndo));
    dismiss.addEventListener('click',()=>finish(onGone));
    return Object.freeze({close:()=>finish(()=>{})});
  }
  function mount(options){
    const box=document.createElement('div');box.className='idle-rewards';
    box.innerHTML=(TEST_MODE?'<span class="idle-test" style="font-weight:800;font-size:12px">🧪 TEST</span>':'')+'<span class="idle-stars"></span><button type="button" class="idle-rebirth">⭐ Rebirth</button><span class="idle-progress"></span><button type="button" class="idle-gift" hidden></button><p class="idle-away" role="status" hidden></p><p class="idle-sleep" role="status" hidden></p>';
    options.host.prepend(box);
    const dialog=document.createElement('dialog');dialog.className='idle-dialog';
    dialog.setAttribute('aria-label','Confirm rebirth');
    dialog.innerHTML='<h2>⭐ Rebirth?</h2><p class="idle-reset"></p><p class="idle-keep"></p><p class="idle-preview"></p><ul class="idle-advice"></ul><div><button type="button" class="idle-cancel">Cancel</button><button type="button" class="idle-confirm" disabled>Confirm rebirth</button></div>';
    document.body.append(dialog);
    const guard=makeGuard(dialog.querySelector('.idle-confirm'));
    const undoKey=options.undoKey||'game';
    function clearUndo(){undoWrite(undoKey,null)}
    /** Shows the 30 s Undo toast for a reset that just happened; `snap` is the exact pre-reset state (restore(snap) puts it back). */
    function offerUndo(label,snap,until=Date.now()+UNDO_MS){
      if(!options.restore||!snap)return;
      undoWrite(undoKey,{until,label,snap});
      undoToast({label,until,
        onUndo:()=>{clearUndo();options.restore(snap);options.save();refresh()},
        onGone:clearUndo});
    }
    const find=selector=>box.querySelector(selector);
    let streak=window.__pbStreak,noticeShown=false;
    // Test mode: the gift is always claimable (and repeatable), whatever the real streak is.
    const giftDays=()=>TEST_MODE?Math.max(1,Number.isFinite(streak?.streak)?streak.streak:1):streak?.streak;
    function refresh(){
      const save=options.read(),earned=Math.floor(Math.sqrt(save.rb/options.threshold));
      const sleep=find('.idle-sleep'),rate=activityRate(save.st);
      sleep.hidden=rate===1;
      if(rate<1)sleep.textContent=rate===0?'💤 Inactive too long · production paused · tap to play':`💤 Inactive · ${Math.round(rate*100)}% production · tap to play`;
      find('.idle-stars').textContent=options.starsText?options.starsText(save):`⭐ ${options.format(save.st)} · +${options.format(save.st*10)}%`;
      find('.idle-rebirth').disabled=earned<1;
      find('.idle-progress').textContent=earned<1?`${options.format(save.rb)} / ${options.format(options.threshold)} this round`:`+${options.format(earned)} stars ready`;
      const gift=find('.idle-gift'),known=TEST_MODE||(Number.isFinite(streak?.streak)&&streak.streak>=1);
      const days=giftDays();
      gift.hidden=!known||(!TEST_MODE&&save.gd===day());
      if(known)gift.textContent=`🎁 Daily gift · ${Math.min(2,1+0.1*(days-1)).toFixed(1)}× · 🔥 ${days}`;
    }
    function earnedStars(){return Math.floor(Math.sqrt(options.read().rb/options.threshold))}
    find('.idle-rebirth').addEventListener('click',()=>{
      const save=options.read(),earned=earnedStars();
      if(earned<1)return;
      dialog.querySelector('.idle-reset').textContent='⚠ This resets your whole round: '+options.resets;
      dialog.querySelector('.idle-keep').textContent='You keep: stars, lifetime total (leaderboard score), rebirth count, daily gift day'+(options.keeps?', '+options.keeps:'.');
      dialog.querySelector('.idle-preview').textContent=options.rebirthPreview?options.rebirthPreview(earned):`You get ${options.format(earned)} stars (+${options.format(earned*10)}% production).`;
      const bonus=options.bonus||multiplier;
      const advice=advise({before:bonus(save.st),after:bonus(save.st+earned),roundMs:options.roundStart&&options.roundStart()?Date.now()-options.roundStart():0,
        small:earned<SMALL_SHARE*(save.st+1),format:options.format});
      const list=dialog.querySelector('.idle-advice');list.replaceChildren();
      list.className='idle-advice idle-'+advice.level;
      advice.lines.forEach(line=>{const item=document.createElement('li');item.textContent=line;list.append(item)});
      guard.arm({needsHold:advice.needsHold,plainLabel:'Confirm rebirth',holdLabel:'Hold to rebirth',
        onConfirm:()=>{
          if(earnedStars()<1)return;
          const snap=options.snapshot&&options.snapshot();
          options.rebirth();dialog.close();options.save();refresh();
          offerUndo('Rebirth done.',snap);
        }});
      dialog.showModal();
      dialog.querySelector('.idle-cancel').focus();
    });
    dialog.querySelector('.idle-cancel').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',guard.disarm);
    find('.idle-gift').addEventListener('click',()=>{
      const today=day();
      if(!TEST_MODE&&(!Number.isFinite(streak?.streak)||streak.streak<1||options.read().gd===today))return;
      options.gift(today,600*options.production()*Math.min(2,1+0.1*(giftDays()-1)));
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
        if(TEST_MODE)return; // test pumpkins never count towards the real Halloween event
        try{parent.postMessage({__pbEvent:{event:'halloween-2026',count:1}},'*')}
        catch(error){console.warn('[Idle rewards] Pumpkin delivery failed',error)}
      },{once:true});
    }
    function schedulePumpkin(){setTimeout(()=>{spawnPumpkin();schedulePumpkin()},MIN_SPAWN_MS+Math.random()*SPAWN_RANGE_MS)}
    document.body.classList.toggle('idle-halloween',halloween());
    if(halloween())schedulePumpkin();
    const pending=undoRead(undoKey);   // a reload inside the 30 s window keeps the Undo
    if(pending)offerUndo(pending.label,pending.snap,pending.until);
    refresh();return Object.freeze({refresh,notice,offerUndo});
  }
  window.IdleExtras=Object.freeze({day,halloween,multiplier,starBonus:STAR_BONUS,offline,awayRate,activityRate,isActive,mount,makeGuard,advise,duration,undoToast,undoRead,undoWrite,holdMs:HOLD_MS,lockMs:OPEN_LOCK_MS,undoMs:UNDO_MS,worthGain:WORTH_GAIN,smallShare:SMALL_SHARE});
})();
