(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.DriveMadCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
/* core physics + levels (DOM-free) */

const STEP=10,DT=1/60,GRAVITY=900,BASE_Y=420,CAR_START_X=180;
const WHEEL_RADIUS=13,WHEEL_REST=22,WHEEL_TRAVEL=12,MOUNT_X=31,MOUNT_Y=8;
const CHASSIS_MASS=2.5,CHASSIS_INERTIA=3600,SPRING_K=185,DAMPER_K=20;
const DRIVE_TORQUE=6900,REVERSE_TORQUE=5200,BRAKE_TORQUE=11000,WHEEL_INERTIA=80;
const GRIP=1.12,SLIP_STIFFNESS=25,AIR_TORQUE=18500,MAX_SPEED=470;
const BOOST_FORCE=850,ROLL_RESIST=0.9965,MAX_NORMAL=6200;
const TAU=Math.PI*2;

function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
function smooth(t){return t*t*(3-2*t);}
function rotate(x,y,a){const c=Math.cos(a),s=Math.sin(a);return{x:x*c-y*s,y:x*s+y*c};}
function dot(a,b){return a.x*b.x+a.y*b.y;}
function cross(rx,ry,fx,fy){return rx*fy-ry*fx;}
function copyProp(p){return JSON.parse(JSON.stringify(p));}

const LEVELS=[
 {name:'Ignition',hint:'Hold gas. Feel the suspension settle over the rollers.',parts:[['flat',300],['bumps',3,120,24],['flat',360]]},
 {name:'Launch School',hint:'Build speed, then use gas or brake in the air to match the landing.',parts:[['boost',180],['launch',170,64],['gap',155],['down',250,45],['flat',320]]},
 {name:'The Balancer',hint:'Ease onto the see-saw, then power off its falling edge.',parts:[['flat',150],['seesaw',250],['flat',260],['hill',300,55],['flat',180]]},
 {name:'Barrel Run',hint:'Barrels are real bodies. Keep momentum and shove through.',parts:[['down',180,25],['barrels',4,68],['bumps',3,95,24],['flat',310]]},
 {name:'Loose Boards',hint:'The bridge starts collapsing as soon as a wheel loads it.',parts:[['boost',150],['bridge',360,7],['flat',220],['launch',135,45],['gap',145],['flat',260]]},
 {name:'Hammer Time',hint:'Read the swing, then commit under the wrecking ball.',parts:[['flat',230],['hammer',300,150],['up',260,82],['down',220,82],['flat',260]]},
 {name:'Turntable',hint:'The powered platform will change your launch angle.',parts:[['boost',170],['spinner',250],['gap',120],['flat',260],['bumps',3,100,22],['flat',180]]},
 {name:'The Press',hint:'Brake outside the crusher, then sprint through on the opening.',parts:[['flat',220],['crusher',270],['boost',150],['launch',150,58],['gap',200],['flat',300]]},
 {name:'Counterweight',hint:'Climb hard, balance briefly, and avoid looping backward.',parts:[['up',310,125],['seesaw',270],['down',250,80],['barrels',3,72],['flat',260]]},
 {name:'Falling Fast',hint:'No sightseeing: the long bridge will not wait.',parts:[['boost',180],['bridge',490,9],['launch',135,48],['gap',170],['barrels',3,66],['flat',250]]},
 {name:'Pendulum Flight',hint:'Time the hammer and keep the nose level across the water.',parts:[['hammer',250,145],['boost',160],['launch',185,72],['gap',245],['down',280,75],['flat',260]]},
 {name:'Crush Balance',hint:'A crusher into a see-saw: patience first, throttle second.',parts:[['crusher',240],['flat',90],['seesaw',280],['gap',145],['flat',300]]},
 {name:'Moving Parts',hint:'Carry speed through every moving surface.',parts:[['spinner',230],['flat',100],['hammer',250,140],['bridge',300,6],['flat',270]]},
 {name:'Machine Room',hint:'Short safe windows. Brake is as important as gas.',parts:[['crusher',240],['barrels',3,65],['spinner',240],['crusher',220],['flat',260]]},
 {name:'Skyworks',hint:'Fast on the boards, gentle in the air, flat on the landing.',parts:[['boost',170],['bridge',320,6],['launch',170,70],['gap',225],['seesaw',250],['launch',125,42],['gap',145],['flat',260]]},
 {name:'Mad Machine',hint:'Every lesson, one run. Feather the pedals and stay brave.',parts:[['barrels',3,64],['hammer',240,140],['boost',150],['launch',155,56],['gap',185],['spinner',230],['crusher',220],['bridge',330,6],['bumps',3,95,25],['flat',250]]}
];

function buildLevel(def){
  const hs=[],solid=[],water=[],boosts=[],props=[];
  let cy=BASE_Y;
  const cells=(len)=>Math.max(1,Math.round(len/STEP));
  const x=()=>hs.length*STEP;
  const push=(y,isGround,waterY)=>{hs.push(y);solid.push(isGround?1:0);water.push(waterY||0);};
  const flat=(len)=>{for(let i=0,n=cells(len);i<n;i++)push(cy,true,0);};
  const gap=(len,withWater=true)=>{for(let i=0,n=cells(len);i<n;i++)push(cy+700,false,withWater?cy+190:0);};
  const P={
    flat,
    up(len,h){const n=cells(len),y0=cy;for(let i=1;i<=n;i++)push(y0-h*smooth(i/n),true,0);cy=y0-h;},
    down(len,h){P.up(len,-h);},
    hill(len,h){const n=cells(len),y0=cy;for(let i=1;i<=n;i++)push(y0-h*.5*(1-Math.cos(TAU*i/n)),true,0);},
    valley(len,h){P.hill(len,-h);},
    bumps(count,width,height){for(let i=0;i<count;i++)P.hill(width,height);},
    ramp(len,h){const n=cells(len),y0=cy;for(let i=1;i<=n;i++){const t=i/n;push(y0-h*t*t,true,0);}},
    cliff(h){cy+=h;push(cy,true,0);},
    gap(len){gap(len,true);},
    boost(len){const x0=x();flat(len);boosts.push({x0,x1:x()});},
    launch(len,h){const x0=x(),y0=cy;P.ramp(len,h);props.push({type:'launch',x0,x1:x(),y0,y1:y0-h});},
    seesaw(len){const x0=x();gap(len,false);props.push({type:'seesaw',x:x0+len/2,y:cy-5,len,angle:0,av:0,loadTorque:0});},
    spinner(len){const x0=x();gap(len,false);props.push({type:'spinner',x:x0+len/2,y:cy-5,len,angle:-.08,av:0,motor:.24,loadTorque:0});},
    bridge(len,count){const x0=x(),n=count||Math.max(4,Math.round(len/55)),w=len/n;gap(len,false);for(let i=0;i<n;i++)props.push({type:'bridge',x:x0+w*(i+.5),y:cy-4,len:w-3,angle:0,av:0,vy:0,timer:-1,delay:.48+i*.035,falling:false,loadTorque:0});},
    barrels(count,spacing){const start=x()+70;flat(count*spacing+140);for(let i=0;i<count;i++)props.push({type:'barrel',x:start+i*spacing,y:cy-17,r:17,vx:0,vy:0,spin:0});},
    hammer(len,arm){const x0=x();flat(len);props.push({type:'hammer',x:x0+len*.56,pivotY:cy-(arm||145)-36,arm:arm||145,ballR:24,phase:props.length*.9+.4,angle:0,omega:1.05});},
    crusher(len){const x0=x();flat(len);props.push({type:'crusher',x:x0+len*.52,groundY:cy,w:82,h:88,topY:cy-205,phase:(props.length*.37+.18)%1,period:3.8,y:cy-205});}
  };
  flat(CAR_START_X+210);
  for(const part of def.parts){const fn=P[part[0]];if(!fn)throw new Error('Unknown level part: '+part[0]);fn.apply(null,part.slice(1));}
  const flagX=x()+190;flat(440);
  return{hs,solid,water,boosts,props:props.map(copyProp),flagX,len:hs.length*STEP,hint:def.hint,name:def.name,time:0};
}

function terrainIndex(t,x){return clamp(Math.floor(x/STEP),0,t.hs.length-1);}
function groundY(t,x){
  const i=clamp(Math.floor(x/STEP),0,t.hs.length-2),f=clamp((x-i*STEP)/STEP,0,1);
  if(!t.solid[i]&&!t.solid[i+1])return Infinity;
  if(!t.solid[i])return t.hs[i+1];
  if(!t.solid[i+1])return t.hs[i];
  return t.hs[i]*(1-f)+t.hs[i+1]*f;
}
function isSolid(t,x){return t.solid[terrainIndex(t,x)]===1;}
function slopeAt(t,x){
  const a=groundY(t,x-5),b=groundY(t,x+5);
  return Number.isFinite(a)&&Number.isFinite(b)?(b-a)/10:0;
}
function waterAt(t,x){return t.water[terrainIndex(t,x)]||0;}
function inBoost(t,x){return t.boosts.some(b=>x>=b.x0&&x<=b.x1);}

function newCar(x,y){
  return{x,y,vx:0,vy:0,angle:0,av:0,mass:CHASSIS_MASS,inertia:CHASSIS_INERTIA,
    wheels:[{mountX:-MOUNT_X,omega:0,spin:0,compression:0,contact:false,x:x-MOUNT_X,y:y+MOUNT_Y+WHEEL_REST},
      {mountX:MOUNT_X,omega:0,spin:0,compression:0,contact:false,x:x+MOUNT_X,y:y+MOUNT_Y+WHEEL_REST}],
    grounded:0,crashed:false,won:false,crumple:0,airTurn:0,prevAngle:0};
}
function carMidX(c){return c.x;}
function carMidY(c){return c.y;}
function carAngle(c){return c.angle;}
function carSpeed(c){return c.vx;}

function plankSurface(p,x){
  if(p.falling&&p.y>BASE_Y+330)return null;
  const ca=Math.cos(p.angle),sa=Math.sin(p.angle);
  if(Math.abs(ca)<.25)return null;
  const local=(x-p.x)/ca;
  if(Math.abs(local)>p.len*.5)return null;
  return{y:p.y+local*sa,slope:Math.tan(p.angle),body:p,local};
}
function surfaceAt(t,x){
  let best=null;
  const gy=groundY(t,x);
  if(Number.isFinite(gy))best={y:gy,slope:slopeAt(t,x),body:null,local:0};
  for(const p of t.props){
    if(p.type!=='seesaw'&&p.type!=='spinner'&&p.type!=='bridge')continue;
    const s=plankSurface(p,x);
    if(s&&(!best||s.y<best.y+28))best=s;
  }
  return best;
}
function surfaceVelocity(s){
  if(!s.body)return{x:0,y:0};
  const p=s.body;
  return{x:(p.vx||0)-p.av*Math.sin(p.angle)*s.local,y:(p.vy||0)+p.av*Math.cos(p.angle)*s.local};
}
function addForce(acc,c,fx,fy,px,py){acc.fx+=fx;acc.fy+=fy;acc.torque+=cross(px-c.x,py-c.y,fx,fy);}

function stepPlatforms(t){
  for(const p of t.props){
    if(p.type==='seesaw'){
      p.av+=((p.loadTorque||0)/9200-Math.sin(p.angle)*3.4-p.av*1.7)*DT;
      p.angle=clamp(p.angle+p.av*DT,-.38,.38);p.loadTorque=0;
    }else if(p.type==='spinner'){
      p.av+=(p.motor-p.av)*Math.min(1,DT*2.7)+(p.loadTorque||0)/15000*DT;
      p.angle+=p.av*DT;p.loadTorque=0;
    }else if(p.type==='bridge'){
      if(p.timer>=0&&!p.falling){p.timer+=DT;if(p.timer>=p.delay)p.falling=true;}
      if(p.falling){p.vy+=GRAVITY*DT;p.y+=p.vy*DT;p.av+=(p.loadTorque||0)/2100*DT+.34*DT;p.angle+=p.av*DT;}
      p.loadTorque=0;
    }else if(p.type==='barrel'){
      p.vy+=GRAVITY*DT;p.x+=p.vx*DT;p.y+=p.vy*DT;
      const gy=groundY(t,p.x);
      if(Number.isFinite(gy)&&p.y+p.r>gy){p.y=gy-p.r;p.vy=0;p.vx*=.992;p.spin+=p.vx/p.r*DT;}
    }else if(p.type==='hammer'){
      p.angle=Math.sin(t.time*p.omega+p.phase)*1.03;
      const oldX=p.ballX==null?p.x:p.ballX;
      p.ballX=p.x+Math.sin(p.angle)*p.arm;p.ballY=p.pivotY+Math.cos(p.angle)*p.arm;p.ballVx=(p.ballX-oldX)/DT;
    }else if(p.type==='crusher'){
      const u=((t.time/p.period+p.phase)%1+1)%1;
      let f=0;
      if(u<.23)f=smooth(u/.23);else if(u<.43)f=1;else if(u<.62)f=1-smooth((u-.43)/.19);
      const oldY=p.y;p.y=p.topY+f*(p.groundY-p.h-p.topY-8);p.vy=(p.y-oldY)/DT;
    }
  }
}

function collideProps(t,c,ev){
  for(const p of t.props){
    if(p.type==='barrel'){
      const dx=p.x-c.x,dy=p.y-c.y,rr=p.r+35;
      if(dx*dx+dy*dy>rr*rr)continue;
      const d=Math.hypot(dx,dy)||1,nx=dx/d,ny=dy/d,closing=(c.vx-p.vx)*nx+(c.vy-p.vy)*ny;
      if(closing>0){p.vx+=nx*closing*.62;p.vy+=ny*closing*.25;c.vx-=nx*closing*.12;ev.bump=true;}
      const pen=rr-d;p.x+=nx*pen*.35;p.y+=ny*pen*.35;
    }else if(p.type==='hammer'){
      const dx=c.x-(p.ballX||p.x),dy=c.y-(p.ballY||p.pivotY+p.arm),rr=p.ballR+30;
      if(dx*dx+dy*dy<rr*rr){c.crashed=true;c.crumple=1;c.vx+=Math.sin(p.angle)*180;c.vy+=120;ev.smash=true;}
    }else if(p.type==='crusher'){
      if(Math.abs(c.x-p.x)<p.w*.5+34&&c.y+21>p.y&&c.y-27<p.y+p.h){c.crashed=true;c.crumple=1;ev.smash=true;}
    }
  }
}

function stepCar(t,c,input){
  const ev={};
  if(c.crashed||c.won)return ev;
  t.time+=DT;stepPlatforms(t);
  const acc={fx:-c.vx*.018,fy:c.mass*GRAVITY,torque:-c.av*48};
  let contacts=0,totalCompression=0;
  for(let index=0;index<c.wheels.length;index++){
    const w=c.wheels[index],mountOffset=rotate(w.mountX,MOUNT_Y,c.angle);
    const mount={x:c.x+mountOffset.x,y:c.y+mountOffset.y};
    const axis=rotate(0,1,c.angle),probeX=mount.x+axis.x*WHEEL_REST;
    const surface=surfaceAt(t,probeX);
    let distance=WHEEL_REST,normalForce=0;
    w.contact=false;w.compression=0;
    if(surface&&axis.y>.28){
      distance=(surface.y-mount.y)/axis.y-WHEEL_RADIUS;
      if(distance<=WHEEL_REST+WHEEL_TRAVEL&&distance>-WHEEL_RADIUS*2){
        distance=clamp(distance,0,WHEEL_REST);
        const compression=WHEEL_REST-distance;
        const m=surface.slope,inv=1/Math.hypot(1,m),tangent={x:inv,y:m*inv},normal={x:m*inv,y:-inv};
        const contact={x:mount.x+axis.x*distance,y:mount.y+axis.y*distance+WHEEL_RADIUS};
        const rv=surfaceVelocity(surface),rx=contact.x-c.x,ry=contact.y-c.y;
        const pointVel={x:c.vx-c.av*ry-rv.x,y:c.vy+c.av*rx-rv.y};
        const vn=dot(pointVel,normal);
        normalForce=clamp(SPRING_K*compression-DAMPER_K*vn,0,MAX_NORMAL);
        const drive=index===0?1:.38;
        let torque=0;
        if(input.up)torque=DRIVE_TORQUE*drive;
        if(input.down){torque=c.vx>38?-BRAKE_TORQUE*Math.sign(w.omega||1):-REVERSE_TORQUE*drive;}
        w.omega+=torque/WHEEL_INERTIA*DT;
        const vt=dot(pointVel,tangent),slip=w.omega*WHEEL_RADIUS-vt;
        let friction=clamp(slip*SLIP_STIFFNESS,-normalForce*GRIP,normalForce*GRIP);
        if(input.down&&c.vx>38)friction=clamp(friction-c.vx*4,-normalForce*GRIP,normalForce*GRIP);
        if(input.up&&inBoost(t,probeX)){friction+=BOOST_FORCE;ev.boost=true;}
        addForce(acc,c,normal.x*normalForce+tangent.x*friction,normal.y*normalForce+tangent.y*friction,contact.x,contact.y);
        w.omega-=friction*WHEEL_RADIUS/WHEEL_INERTIA*DT;
        w.contact=true;w.compression=compression;contacts++;totalCompression+=compression;
        if(surface.body){
          surface.body.loadTorque=(surface.body.loadTorque||0)+cross(contact.x-surface.body.x,contact.y-surface.body.y,-normal.x*normalForce,-normal.y*normalForce);
          if(surface.body.type==='bridge'&&surface.body.timer<0)surface.body.timer=0;
        }
        if(vn< -170){ev.land=Math.max(ev.land||0,-vn);}
      }
    }
    if(!w.contact){
      const drive=index===0?1:.38;
      if(input.up)w.omega+=DRIVE_TORQUE*drive/WHEEL_INERTIA*DT;
      else if(input.down)w.omega-=REVERSE_TORQUE*drive/WHEEL_INERTIA*DT;
    }
    w.omega*=w.contact?ROLL_RESIST:.998;
    w.omega=clamp(w.omega,-70,95);w.spin+=w.omega*DT;
    w.x=mount.x+axis.x*distance;w.y=mount.y+axis.y*distance;
  }
  c.grounded=contacts;
  if(!contacts){
    const tilt=(input.up||input.left?-1:0)+(input.down||input.right?1:0);
    acc.torque+=tilt*AIR_TORQUE;c.airTurn+=c.angle-c.prevAngle;
  }else{
    const road=slopeAt(t,c.x),roadAngle=Math.atan(Number.isFinite(road)?road:0);
    const lean=clamp(c.angle-roadAngle,-1.2,1.2);
    acc.torque+=-lean*1050-c.av*125;
    if(totalCompression>27)ev.squash=totalCompression;
  }
  c.prevAngle=c.angle;
  c.vx=clamp(c.vx+acc.fx/c.mass*DT,-250,MAX_SPEED);
  c.vy=clamp(c.vy+acc.fy/c.mass*DT,-620,900);
  c.av=clamp(c.av+acc.torque/c.inertia*DT,-7.5,7.5);
  c.x+=c.vx*DT;c.y+=c.vy*DT;c.angle+=c.av*DT;
  if(Math.abs(c.airTurn)>TAU){ev.flip=true;c.airTurn=0;}
  collideProps(t,c,ev);
  if(!c.crashed&&Math.cos(c.angle)>-.3){
    const b0=rotate(-27,17,c.angle),b1=rotate(27,17,c.angle),bottom=[b0,b1];
    let penetration=0;
    for(const b of bottom){const wx=c.x+b.x,wy=c.y+b.y,s=surfaceAt(t,wx);if(s)penetration=Math.max(penetration,wy-s.y);}
    if(penetration>0){
      c.y-=Math.min(penetration,55);
      if(c.vy>0){if(c.vy>145)ev.land=Math.max(ev.land||0,c.vy);c.vy*=-.08;}
      c.av*=.72;
    }
  }
  const roofA=rotate(-27,-24,c.angle),roofB=rotate(25,-24,c.angle);
  const roofs=[{x:c.x+roofA.x,y:c.y+roofA.y},{x:c.x+roofB.x,y:c.y+roofB.y}];
  for(const r of roofs){const s=surfaceAt(t,r.x);if(s&&r.y>s.y+2&&Math.cos(c.angle)<-.55){c.crashed=true;c.crumple=1;ev.roof=true;break;}}
  const wy=waterAt(t,c.x);
  if((wy&&c.y>wy)||c.y>BASE_Y+720){c.crashed=true;c.crumple=1;ev.fell=true;}
  if(!c.crashed&&c.x>t.flagX){c.won=true;ev.win=true;}
  return ev;
}

function botInput(t,c,levelIndex){
  const input={up:true,down:false,left:false,right:false};
  const memory=t.bot||(t.bot={hammerCommit:null,crusherCommit:null});
  const crusher=t.props.find(p=>p.type==='crusher'&&p.x>c.x-30&&p.x<c.x+300);
  const hammer=t.props.find(p=>p.type==='hammer'&&p.x>c.x-30&&p.x<c.x+500);
  if(crusher&&c.x<crusher.x-95){
    if(memory.crusherCommit!==crusher.x&&crusher.y<crusher.topY+24&&(crusher.vy||0)<=5)memory.crusherCommit=crusher.x;
    if(memory.crusherCommit!==crusher.x){input.up=false;input.down=c.vx>24;}
  }
  if(hammer&&memory.hammerCommit!==hammer.x){
    const stagingX=hammer.x-hammer.arm-85;
    const remaining=stagingX-c.x;
    const ballX=hammer.ballX==null?hammer.x:hammer.ballX;
    const safe=ballX>hammer.x-55&&ballX<hammer.x&&(hammer.ballVx||0)>0;
    if(c.x>stagingX-45&&safe)memory.hammerCommit=hammer.x;
    if(memory.hammerCommit!==hammer.x){
      input.up=remaining>120?c.vx<150:remaining>20?c.vx<70:false;
      input.down=remaining>120?c.vx>175:remaining>20?c.vx>95:c.vx>12;
    }
  }
  const a=((c.angle+Math.PI)%TAU+TAU)%TAU-Math.PI;
  const roadAngle=Math.atan(slopeAt(t,c.x)||0),lean=a-roadAngle;
  if(c.grounded&&lean<-.62){input.up=false;input.down=true;}
  if(c.grounded&&lean>.72){input.up=true;input.down=false;}
  if(!c.grounded){
    const gy0=groundY(t,c.x+25),gy1=groundY(t,c.x+95);
    const target=Number.isFinite(gy0)&&Number.isFinite(gy1)?clamp(Math.atan2(gy1-gy0,70),-.42,.42):0;
    const d=((c.angle-target+Math.PI)%TAU+TAU)%TAU-Math.PI;
    if(d>.06){input.up=true;input.down=false;}else if(d<-.06){input.up=false;input.down=true;}else{input.up=false;input.down=false;}
  }
  if(levelIndex===2&&c.x>520&&c.x<700){input.up=c.angle<.16;input.down=c.angle>.22;}
  return input;
}

return{STEP,DT,GRAVITY,BASE_Y,CAR_START_X,WHEEL_RADIUS,WHEEL_REST,MOUNT_X,MOUNT_Y,LEVELS,
  buildLevel,groundY,isSolid,slopeAt,waterAt,inBoost,surfaceAt,newCar,stepCar,stepPlatforms,
  carMidX,carMidY,carAngle,carSpeed,botInput,clamp,rotate};
});
