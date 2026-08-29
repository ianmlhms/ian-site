(function(){
'use strict';

const THREE=window.THREE,C=window.DriveMadCore;
const $=(id)=>document.getElementById(id);
const overlay=$('overlay'),message=$('message'),levelsBox=$('levels'),playButton=$('play');
if(!THREE||!C){
  message.textContent='The 3D engine could not start. Reload this page while online.';
  document.title='ROAD_RAGE_BOOT_ERROR';
  return;
}

const WORLD_SCALE=.02,ROAD_HALF=1.65,FIXED_STEP=C.DT,MAX_FRAME=.05;
const COLORS={road:0x3e4851,side:0x704a32,mint:0x4dffd2,red:0xef3948,yellow:0xffc83d,steel:0x647685};
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
renderer.setSize(window.innerWidth,window.innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
document.body.insertBefore(renderer.domElement,document.body.firstChild);

const scene=new THREE.Scene();scene.fog=new THREE.Fog(0x9ac7dc,18,48);
const camera=new THREE.PerspectiveCamera(42,window.innerWidth/window.innerHeight,.1,100);
const hemi=new THREE.HemisphereLight(0xd9f2ff,0x24351f,1.75);scene.add(hemi);
const sun=new THREE.DirectionalLight(0xffedc5,3.2);sun.position.set(-6,13,9);sun.castShadow=true;
sun.shadow.mapSize.set(1024,1024);sun.shadow.camera.left=-13;sun.shadow.camera.right=13;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-7;sun.shadow.bias=-.0004;scene.add(sun);

function canvasTexture(draw,width,height){
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d');draw(context,width,height);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
const skyTexture=canvasTexture((ctx,w,h)=>{const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#467ea9');g.addColorStop(.5,'#96c9dd');g.addColorStop(1,'#f3c787');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);},16,256);
skyTexture.mapping=THREE.EquirectangularReflectionMapping;scene.background=skyTexture;
const roadTexture=canvasTexture((ctx,w,h)=>{
  ctx.fillStyle='#45505a';ctx.fillRect(0,0,w,h);
  for(let i=0;i<220;i++){const v=52+Math.random()*45|0;ctx.fillStyle=`rgb(${v},${v+5},${v+7})`;ctx.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1);}
  ctx.fillStyle='rgba(235,216,145,.22)';for(let x=0;x<w;x+=32)ctx.fillRect(x,3,17,2);
},256,64);roadTexture.wrapS=roadTexture.wrapT=THREE.RepeatWrapping;roadTexture.repeat.set(1,.6);

const worldRoot=new THREE.Group(),sceneryRoot=new THREE.Group(),fxRoot=new THREE.Group();scene.add(sceneryRoot,worldRoot,fxRoot);
let terrain=null,car=null,state='menu',levelIndex=0,ticks=0,accumulator=0,lastTime=0;
let carView=null,propViews=[],contactShadow=null,flagView=null,crashClock=0,winDelay=0;
const keys={up:false,down:false,left:false,right:false};
const particles=[];

function clearGroup(group){while(group.children.length){const child=group.children[0];group.remove(child);child.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material){const mats=Array.isArray(obj.material)?obj.material:[obj.material];for(const mat of mats)mat.dispose();}});}}
function worldX(x){return x*WORLD_SCALE;}
function worldY(y){return(C.BASE_Y-y)*WORLD_SCALE;}

function makeScenery(){
  clearGroup(sceneryRoot);
  const mountainMat=new THREE.MeshStandardMaterial({color:0x557f86,roughness:1,flatShading:true});
  const farMat=new THREE.MeshStandardMaterial({color:0x6f96a0,roughness:1,flatShading:true});
  for(let i=0;i<34;i++){
    const h=2.4+(i%5)*.7,mesh=new THREE.Mesh(new THREE.ConeGeometry(2.3+(i%4)*.5,h,5),i%2?mountainMat:farMat);
    mesh.position.set(i*5-12,-1.4+h*.5,-10-(i%3)*2);mesh.rotation.y=(i*.73)%Math.PI;sceneryRoot.add(mesh);
  }
  const cloudMat=new THREE.MeshLambertMaterial({color:0xffffff,transparent:true,opacity:.48});
  for(let i=0;i<12;i++){
    const cloud=new THREE.Group();
    for(let j=0;j<3;j++){const puff=new THREE.Mesh(new THREE.SphereGeometry(.45+j*.1,10,7),cloudMat);puff.position.set(j*.55,Math.sin(j)*.1,0);cloud.add(puff);}
    cloud.position.set(i*10-8,6+(i%4)*.65,-12);sceneryRoot.add(cloud);
  }
}

function makeTerrain(){
  const positions=[],uvs=[],indices=[],sidePositions=[],sideIndices=[];
  for(let i=0;i<terrain.hs.length;i++){
    const x=worldX(i*C.STEP),y=worldY(terrain.hs[i]);
    positions.push(x,y,-ROAD_HALF,x,y,ROAD_HALF);uvs.push(i/18,0,i/18,1);
  }
  for(let i=0;i<terrain.hs.length-1;i++){
    if(!terrain.solid[i]||!terrain.solid[i+1])continue;
    const a=i*2,b=a+2;indices.push(a,b,a+1,a+1,b,b+1);
    for(const z of [-ROAD_HALF,ROAD_HALF]){
      const start=sidePositions.length/3,x0=worldX(i*C.STEP),x1=worldX((i+1)*C.STEP),y0=worldY(terrain.hs[i]),y1=worldY(terrain.hs[i+1]);
      sidePositions.push(x0,y0,z,x1,y1,z,x0,-6,z,x1,-6,z);sideIndices.push(start,start+2,start+1,start+1,start+2,start+3);
    }
  }
  const topGeometry=new THREE.BufferGeometry();topGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));topGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));topGeometry.setIndex(indices);topGeometry.computeVertexNormals();
  const top=new THREE.Mesh(topGeometry,new THREE.MeshStandardMaterial({map:roadTexture,color:COLORS.road,roughness:.88,metalness:.04,side:THREE.DoubleSide}));top.receiveShadow=true;worldRoot.add(top);
  const sideGeometry=new THREE.BufferGeometry();sideGeometry.setAttribute('position',new THREE.Float32BufferAttribute(sidePositions,3));sideGeometry.setIndex(sideIndices);sideGeometry.computeVertexNormals();
  const sides=new THREE.Mesh(sideGeometry,new THREE.MeshStandardMaterial({color:COLORS.side,roughness:1,side:THREE.DoubleSide}));sides.receiveShadow=true;worldRoot.add(sides);
  const waterMat=new THREE.MeshPhongMaterial({color:0x258bb5,transparent:true,opacity:.72,shininess:90});
  for(let i=0;i<terrain.water.length;){if(!terrain.water[i]){i++;continue;}const start=i,wy=terrain.water[i];while(i<terrain.water.length&&terrain.water[i])i++;const width=worldX((i-start)*C.STEP),water=new THREE.Mesh(new THREE.PlaneGeometry(width,ROAD_HALF*2),waterMat);water.rotation.x=-Math.PI/2;water.position.set(worldX((start+i)*C.STEP/2),worldY(wy),0);worldRoot.add(water);}
  const boostMat=new THREE.MeshStandardMaterial({color:COLORS.yellow,emissive:0xff7b00,emissiveIntensity:1.8,roughness:.45});
  for(const boost of terrain.boosts){for(let x=boost.x0+18;x<boost.x1-5;x+=32){const pad=new THREE.Mesh(new THREE.BoxGeometry(.34,.045,2.65),boostMat);pad.position.set(worldX(x),worldY(C.groundY(terrain,x))+.035,0);pad.rotation.z=-Math.atan(C.slopeAt(terrain,x));worldRoot.add(pad);}}
}

function box(w,h,d,color,metalness=.05){const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshStandardMaterial({color,roughness:.62,metalness}));mesh.castShadow=true;mesh.receiveShadow=true;return mesh;}
function cylinder(radius,length,color){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,length,18),new THREE.MeshStandardMaterial({color,roughness:.65,metalness:.12}));mesh.rotation.x=Math.PI/2;mesh.castShadow=true;return mesh;}

function makeCar(){
  const group=new THREE.Group(),body=box(1.55,.38,.88,COLORS.red,.22);body.position.y=.02;group.add(body);
  const nose=box(.48,.25,.86,0xff5965,.18);nose.position.set(.68,.14,0);group.add(nose);
  const roof=box(.72,.34,.75,0xc62536,.18);roof.position.set(-.08,.36,0);group.add(roof);
  const glass=box(.5,.22,.765,0x8ddcf1,.05);glass.position.set(.05,.39,0);group.add(glass);
  const bumper=box(.16,.13,.94,0x27313a,.65);bumper.position.set(.83,-.05,0);group.add(bumper);
  const driver=new THREE.Mesh(new THREE.SphereGeometry(.13,14,10),new THREE.MeshStandardMaterial({color:0xffd0a0}));driver.position.set(-.12,.65,0);driver.castShadow=true;group.add(driver);
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(.145,14,8,0,Math.PI*2,0,Math.PI*.55),new THREE.MeshStandardMaterial({color:0x162b42,roughness:.4}));helmet.position.copy(driver.position);group.add(helmet);
  const brakeMat=new THREE.MeshStandardMaterial({color:0xff1f2d,emissive:0xff0000,emissiveIntensity:.4});
  for(const z of [-.3,.3]){const light=new THREE.Mesh(new THREE.BoxGeometry(.055,.13,.17),brakeMat);light.position.set(-.79,.04,z);group.add(light);}
  const wheelViews=[];
  for(let i=0;i<2;i++){
    const pivot=new THREE.Group(),tyre=cylinder(.29,.28,0x111418);pivot.add(tyre);
    const hub=cylinder(.115,.3,0xc5d1da);pivot.add(hub);
    for(let j=0;j<5;j++){const spoke=box(.22,.025,.31,0x8496a3,.5);spoke.rotation.z=j*Math.PI/5;pivot.add(spoke);}
    group.add(pivot);wheelViews.push(pivot);
  }
  group.userData={body,roof,glass,brakeMat,wheels:wheelViews};group.traverse(o=>{if(o.isMesh)o.castShadow=true;});worldRoot.add(group);return group;
}

function makePropViews(){
  propViews=[];
  for(const prop of terrain.props){
    let view;
    if(prop.type==='seesaw'||prop.type==='spinner'||prop.type==='bridge'){
      view=box(worldX(prop.len),.16,3.05,prop.type==='spinner'?0xd7a82e:prop.type==='bridge'?0x84552f:0x637987,.18);
      if(prop.type==='seesaw'||prop.type==='spinner'){const pivot=cylinder(.22,3.25,0x26343d);pivot.position.set(worldX(prop.x),worldY(prop.y)-.28,0);worldRoot.add(pivot);}
    }else if(prop.type==='barrel'){
      view=new THREE.Group();const barrel=cylinder(worldX(prop.r),.68,0xc36a2a);view.add(barrel);
      for(const z of [-.28,.28]){const band=new THREE.Mesh(new THREE.TorusGeometry(worldX(prop.r)+.008,.026,8,18),new THREE.MeshStandardMaterial({color:0x30383e,metalness:.7,roughness:.35}));band.position.z=z;view.add(band);}
    }else if(prop.type==='hammer'){
      view=new THREE.Group();const arm=box(.12,worldX(prop.arm),.18,0x4d5861,.7);arm.position.y=-worldX(prop.arm)/2;view.add(arm);const ball=new THREE.Mesh(new THREE.IcosahedronGeometry(worldX(prop.ballR),1),new THREE.MeshStandardMaterial({color:0x3b444b,metalness:.72,roughness:.32}));ball.position.y=-worldX(prop.arm);ball.castShadow=true;view.add(ball);
    }else if(prop.type==='crusher'){
      view=new THREE.Group();const head=box(worldX(prop.w),worldX(prop.h),2.9,0x687681,.72);head.position.y=-worldX(prop.h)/2;view.add(head);
      for(const x of [-.55,0,.55]){const tooth=box(.28,.28,2.8,0x414b53,.75);tooth.rotation.z=Math.PI/4;tooth.position.set(x,-worldX(prop.h)-.05,0);view.add(tooth);}
      const rail=box(.25,4,3.1,0x303942,.75);
      rail.position.set(worldX(prop.x),worldY(prop.groundY)+1.45,0);worldRoot.add(rail);
    }else{view=new THREE.Group();}
    view.userData.prop=prop;worldRoot.add(view);propViews.push(view);
  }
}

function makeFinish(){
  const group=new THREE.Group(),pole=cylinder(.035,2.15,0xe4e8eb);pole.rotation.x=0;pole.position.y=1.05;group.add(pole);
  for(let row=0;row<3;row++)for(let col=0;col<5;col++){const tile=box(.19,.19,.035,(row+col)%2?0x111318:0xffffff);tile.position.set(.12+col*.19,1.87-row*.19,0);group.add(tile);}
  group.position.set(worldX(terrain.flagX),worldY(C.groundY(terrain,terrain.flagX)),0);worldRoot.add(group);return group;
}

function buildWorld(){
  clearGroup(worldRoot);clearGroup(fxRoot);particles.length=0;makeTerrain();makePropViews();flagView=makeFinish();carView=makeCar();
  const shadowTexture=canvasTexture((ctx,w,h)=>{const g=ctx.createRadialGradient(w/2,h/2,2,w/2,h/2,w/2);g.addColorStop(0,'rgba(0,0,0,.55)');g.addColorStop(1,'rgba(0,0,0,0)');ctx.fillStyle=g;ctx.fillRect(0,0,w,h);},64,64);
  contactShadow=new THREE.Mesh(new THREE.PlaneGeometry(1.9,.72),new THREE.MeshBasicMaterial({map:shadowTexture,transparent:true,depthWrite:false}));contactShadow.rotation.x=-Math.PI/2;worldRoot.add(contactShadow);
}

function syncProps(){
  terrain.props.forEach((prop,index)=>{
    const view=propViews[index];if(!view)return;
    if(prop.type==='hammer'){view.position.set(worldX(prop.x),worldY(prop.pivotY),0);view.rotation.z=prop.angle;}
    else if(prop.type==='crusher'){view.position.set(worldX(prop.x),worldY(prop.y),0);}
    else{view.position.set(worldX(prop.x),worldY(prop.y),0);view.rotation.z=-prop.angle;if(prop.type==='barrel')view.rotation.z=-prop.spin;}
  });
}

function syncCar(){
  if(!carView||!car)return;
  carView.position.set(worldX(car.x),worldY(car.y),0);
  carView.rotation.z=-car.angle+(state==='dead'?Math.min(crashClock,1.4)*2.1:0);
  const data=carView.userData;
  car.wheels.forEach((wheel,index)=>{
    const local=C.rotate(wheel.x-car.x,wheel.y-car.y,-car.angle),view=data.wheels[index];
    view.position.set(worldX(local.x),-worldX(local.y),0);view.rotation.z=car.angle-wheel.spin;
  });
  const crush=state==='dead'?Math.min(1,crashClock*2):0;
  data.body.scale.x=1-crush*.28;data.roof.rotation.z=crush*.24;data.roof.position.y=.36-crush*.12;data.glass.scale.y=1-crush*.45;
  data.brakeMat.emissiveIntensity=keys.down?5:.45;
  const gy=C.groundY(terrain,car.x);contactShadow.visible=Number.isFinite(gy);if(contactShadow.visible){contactShadow.position.set(worldX(car.x),worldY(gy)+.025,0);contactShadow.material.opacity=Math.max(.12,.46-Math.abs(car.y-gy+43)*.005);}
}

function spawnParticles(event){
  let count=0,color=0xb99b72,speed=1;
  if(event.land){count=Math.min(16,5+event.land/35|0);speed=Math.min(3,event.land/120);if(event.land>280)color=0xff9b38;}
  if(event.boost&&ticks%5===0){count=2;color=COLORS.yellow;speed=1.7;}
  if(event.smash||event.roof){count=22;color=0xff9b38;speed=4;}
  for(let i=0;i<count;i++){
    const material=new THREE.MeshBasicMaterial({color,transparent:true}),mesh=new THREE.Mesh(new THREE.IcosahedronGeometry(.035+Math.random()*.035,0),material);
    mesh.position.set(worldX(car.x)+(Math.random()-.5)*.8,worldY(car.y)-.2,Math.random()-.5);
    fxRoot.add(mesh);particles.push({mesh,vx:(Math.random()-.5)*speed,vy:Math.random()*speed+.4,vz:(Math.random()-.5)*speed,life:.55+Math.random()*.45});
  }
}
function updateParticles(dt){
  for(let i=particles.length-1;i>=0;i--){const p=particles[i];p.life-=dt;p.vy-=4.5*dt;p.mesh.position.x+=p.vx*dt;p.mesh.position.y+=p.vy*dt;p.mesh.position.z+=p.vz*dt;p.mesh.material.opacity=Math.max(0,p.life);if(p.life<=0){fxRoot.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();particles.splice(i,1);}}
}

function storageGet(key){try{return localStorage.getItem(key);}catch(error){return null;}}
function storageSet(key,value){try{localStorage.setItem(key,String(value));return true;}catch(error){return false;}}
const doneLvls=()=>+(storageGet('pb_dm_done')||0);
const bestTime=(level)=>+(storageGet('pb_dm_bt_'+level)||0);
window.score=doneLvls();

/* cloud sync: preserve the established PixelBreak save round-trip */
function dmSnapshot(){const bt={};for(let i=0;i<16;i++){const t=bestTime(i);if(t)bt[i]=t}return{v:1,done:doneLvls(),bt}}
function dmApply(sv){if(!sv||sv.v!==1)return;
  if((sv.done||0)>doneLvls())storageSet('pb_dm_done',sv.done);
  for(const k in (sv.bt||{})){const t=+sv.bt[k],cur=bestTime(+k);if(t&&(!cur||t<cur))storageSet('pb_dm_bt_'+k,t)}
  window.score=Math.max(window.score||0,doneLvls());}
function dmPush(){try{parent.postMessage({__pbSave:1,data:dmSnapshot()},'*')}catch(e){}}
dmApply(window.__pbSave);
window.addEventListener('message',e=>{const d=e.data;if(d&&d.__pbLoadSave===1)dmApply(d.data)});
try{parent.postMessage({__pbWantSave:1},'*')}catch(e){}

let audioContext=null,engineOsc=null,engineGain=null;
function startAudio(){
  if(audioContext){if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});return;}
  try{audioContext=new(window.AudioContext||window.webkitAudioContext)();engineOsc=audioContext.createOscillator();engineGain=audioContext.createGain();const filter=audioContext.createBiquadFilter();engineOsc.type='sawtooth';filter.type='lowpass';filter.frequency.value=420;engineGain.gain.value=0;engineOsc.connect(filter);filter.connect(engineGain);engineGain.connect(audioContext.destination);engineOsc.start();}catch(error){audioContext=null;}
}
function updateAudio(){if(!audioContext||!engineOsc)return;engineOsc.frequency.value=58+Math.abs(car?car.wheels[0].omega:0)*2.4;engineGain.gain.value=state==='play'?(keys.up?.045:.018):0;}

function setPlayUI(active){$('hud').classList.toggle('hidden',!active);$('restart').classList.toggle('hidden',!active);$('touch').classList.toggle('hidden',!active);}
function refreshLevels(){
  levelsBox.replaceChildren();const done=doneLvls();
  C.LEVELS.forEach((level,index)=>{const button=document.createElement('button');button.textContent=String(index+1);button.disabled=index>done;if(index<done)button.classList.add('done');button.title=level.name;button.addEventListener('click',()=>startLevel(index));levelsBox.appendChild(button);});
}
function showMenu(){
  state='menu';setPlayUI(false);overlay.classList.remove('hidden');message.textContent='Balance the throttle, work the suspension, and survive sixteen short obstacle courses.\nWASD / arrows to drive and tilt. Touch pedals work anywhere on iPad.';playButton.textContent='DRIVE';refreshLevels();
}
function startLevel(index){
  levelIndex=C.clamp(index,0,C.LEVELS.length-1);terrain=C.buildLevel(C.LEVELS[levelIndex]);car=C.newCar(C.CAR_START_X,C.groundY(terrain,C.CAR_START_X)-43);ticks=0;accumulator=0;crashClock=0;winDelay=0;state='play';
  keys.up=keys.down=keys.left=keys.right=false;$('gas').classList.remove('on');$('brake').classList.remove('on');camera.userData.ready=false;buildWorld();syncProps();syncCar();overlay.classList.add('hidden');setPlayUI(true);
  $('levelText').textContent=`${levelIndex+1} / ${C.LEVELS.length}`;$('timeText').textContent='0.0s';const best=bestTime(levelIndex);$('bestText').textContent=best?(best/60).toFixed(1)+'s':'—';$('hint').textContent=terrain.hint;startAudio();
}
function crash(){if(state!=='play')return;state='dead';crashClock=0;$('hint').textContent='CRASHED — press gas, Space, or ↻ to retry';}
function win(){
  if(state!=='play')return;state='won';winDelay=0;const previous=bestTime(levelIndex);if(!previous||ticks<previous)storageSet('pb_dm_bt_'+levelIndex,ticks);
  if(levelIndex+1>doneLvls()){storageSet('pb_dm_done',levelIndex+1);window.score=levelIndex+1;}dmPush();$('hint').textContent='FINISH!';
}
function showWin(){
  setPlayUI(false);overlay.classList.remove('hidden');message.textContent=`${C.LEVELS[levelIndex].name} complete in ${(ticks/60).toFixed(1)}s${bestTime(levelIndex)===ticks?' — new best!':''}`;playButton.textContent=levelIndex+1<C.LEVELS.length?'NEXT STAGE':'LEVEL SELECT';refreshLevels();
}
playButton.addEventListener('click',()=>{if(state==='won'){if(levelIndex+1<C.LEVELS.length)startLevel(levelIndex+1);else showMenu();}else startLevel(Math.min(doneLvls(),C.LEVELS.length-1));});
$('restart').addEventListener('click',()=>startLevel(levelIndex));

const keyMap={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
window.addEventListener('keydown',event=>{
  const mapped=keyMap[event.key];if(mapped){if(state==='dead'&&mapped==='up')startLevel(levelIndex);keys[mapped]=true;startAudio();event.preventDefault();return;}
  if(event.key==='r'||event.key==='R'){if(state!=='menu')startLevel(levelIndex);event.preventDefault();return;}
  if(event.key===' '){if(state==='dead')startLevel(levelIndex);else if(state==='won')levelIndex+1<C.LEVELS.length?startLevel(levelIndex+1):showMenu();else if(state==='menu')playButton.click();event.preventDefault();}
});
window.addEventListener('keyup',event=>{const mapped=keyMap[event.key];if(mapped){keys[mapped]=false;event.preventDefault();}});
window.addEventListener('blur',()=>{keys.up=keys.down=keys.left=keys.right=false;});
function bindPedal(id,key){
  const element=$(id),release=event=>{keys[key]=false;element.classList.remove('on');if(element.hasPointerCapture&&element.hasPointerCapture(event.pointerId))element.releasePointerCapture(event.pointerId);};
  element.addEventListener('pointerdown',event=>{event.preventDefault();if(state==='dead')startLevel(levelIndex);element.setPointerCapture(event.pointerId);keys[key]=true;element.classList.add('on');startAudio();});
  element.addEventListener('pointerup',release);element.addEventListener('pointercancel',release);element.addEventListener('lostpointercapture',()=>{keys[key]=false;element.classList.remove('on');});
}
bindPedal('gas','up');bindPedal('brake','down');

function simulate(){
  if(state!=='play')return;
  ticks++;const event=C.stepCar(terrain,car,keys);syncProps();spawnParticles(event);
  if(car.crashed)crash();else if(car.won)win();$('timeText').textContent=(ticks/60).toFixed(1)+'s';
}
function updateCamera(dt){
  if(!car)return;const speedLead=C.clamp(car.vx*.004,0,1.65),targetX=worldX(car.x)+speedLead,targetY=worldY(car.y)+.75;
  if(!camera.userData.ready){camera.position.set(targetX-.2,targetY+1,12);camera.userData.ready=true;}
  const follow=1-Math.exp(-dt*4.2);camera.position.x+=(targetX-camera.position.x)*follow;camera.position.y+=(targetY-camera.position.y)*follow;camera.position.z=12;
  camera.lookAt(targetX+.45,targetY-.15,0);camera.rotation.z+=(-car.angle*.035-camera.rotation.z)*Math.min(1,dt*2.4);
  sun.position.x=camera.position.x-6;sun.target.position.set(camera.position.x,0,0);scene.add(sun.target);
  sceneryRoot.position.x=camera.position.x*.78;
}
function animate(now){
  requestAnimationFrame(animate);const time=now*.001,frame=lastTime?Math.min(MAX_FRAME,time-lastTime):FIXED_STEP;lastTime=time;
  if(state==='play'){accumulator+=frame;while(accumulator>=FIXED_STEP){simulate();accumulator-=FIXED_STEP;}}
  if(state==='dead')crashClock+=frame;if(state==='won'){winDelay+=frame;if(winDelay>.75&&!overlay.classList.contains('hidden')){}else if(winDelay>.75)showWin();}
  updateParticles(frame);syncProps();syncCar();updateCamera(frame);updateAudio();renderer.render(scene,camera);
}
function resize(){renderer.setSize(window.innerWidth,window.innerHeight);camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();}
window.addEventListener('resize',resize,{passive:true});

makeScenery();terrain=C.buildLevel(C.LEVELS[0]);car=C.newCar(C.CAR_START_X,C.groundY(terrain,C.CAR_START_X)-43);buildWorld();syncProps();syncCar();refreshLevels();showMenu();
document.documentElement.dataset.threeReady='1';
if(new URLSearchParams(location.search).has('probe'))document.title='ROAD_RAGE_BOOT_OK_THREE';
requestAnimationFrame(animate);
})();
