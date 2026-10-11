/* Touch-sized menu rendering. All writes go through the supplied action. */
(function(P){
  'use strict';
  const $=id=>document.getElementById(id);
  function button(label,action,disabled=false){const b=document.createElement('button');b.textContent=label;b.disabled=disabled;b.addEventListener('click',action);return b;}
  function render(save,t,action){
    $('walletMenu').textContent=save.wallet.toLocaleString()+' €';$('rank').textContent=t('rank'+P.career.rank(save));
    $('starCount').textContent='⭐ '+save.stars.length+'/25 '+t('stars');
    $('garage').replaceChildren(...P.config.vehicles.map(v=>{
      const owned=save.owned.includes(v.id),b=button('',()=>action(owned?'select':'vehicle',v.id),!owned&&save.wallet<v.price);
      b.className='vehicle';b.dataset.vehicle=v.id;b.setAttribute('aria-pressed',String(save.vehicle===v.id));
      for(const [tag,label] of [['span',v.icon],['b',t(v.name)],['small',t(v.id+'Desc')],['small',owned?t(save.vehicle===v.id?'selected':'choose'):t('buy')+' · '+v.price.toLocaleString()+' €']]){const n=document.createElement(tag);n.textContent=label;b.append(n);}return b;
    }));
    $('upgrades').replaceChildren(...Object.entries(P.config.upgrades).map(([key,prices])=>{
      const level=save.upgrades[save.vehicle][key],cost=prices[level],b=button('',()=>action('upgrade',key),cost===undefined||save.wallet<cost);b.dataset.upgrade=key;
      for(const [tag,label] of [['b',t(key)+' · '+(level+1)+'/4'],['small',t(key+'Info')],['span',cost===undefined?t('max'):t('buy')+' · '+cost+' €']]){const n=document.createElement(tag);n.textContent=label;b.append(n);}return b;
    }));
    $('districts').replaceChildren(...Object.entries(P.config.districts).map(([name,price])=>{
      const open=save.districts.includes(name),b=button((open?'✓ ':'🔒 ')+name+' · '+(open?t('open'):price.toLocaleString()+' €'),()=>action('district',name),open||save.wallet<price);b.dataset.district=name;return b;
    }));
    missions(save,t);
  }
  function missions(save,t){
    const day=P.missions.day(),daily=save.daily.day===day?save.daily:{progress:{},claimed:[]};
    $('missions').replaceChildren(...P.missions.list(day).map(m=>{
      const li=document.createElement('li'),done=daily.claimed?.includes(m.kind),value=Math.min(m.target,daily.progress?.[m.kind]||0);
      const label=m.kind==='delivery'?m.target+' '+t('missiondelivery')+' '+m.district:m.kind==='drift'||m.kind==='express'?m.target+' '+t('mission'+m.kind):t('mission'+m.kind);
      li.textContent=(done?'✓ ':'○ ')+label+' · '+Math.floor(value)+'/'+m.target+' · '+m.reward+' €';li.classList.toggle('done',!!done);return li;
    }));
  }
  P.shop={render,missions};
})(window.PX);
