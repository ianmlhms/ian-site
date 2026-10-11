/* Arcade bicycle model: axle slip angles generate lateral tyre forces and yaw torque. */
(function (P) {
  'use strict';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  P.drive=function(p,spec,input,dt){
    const bus=spec.id==='bus',van=spec.id==='van',gas=input.has('gas'),brake=input.has('brake');
    const steer=Number(input.has('left'))-Number(input.has('right'));
    let v=p.longitudinal||0,lat=p.lateral||0,r=p.yawRate||0;
    const prior=v,speed=Math.abs(v),wb=spec.length*.64,lf=wb*.46,lr=wb*.54;
    const maxSteer=Math.min((bus?.44:van?.5:.56)/(1+speed*.045),Math.atan(wb*(bus?7.8:10)*(1+(p.rearRelease||0)*.45)/Math.max(30,speed*speed)));
    p.steering=(p.steering||0)+(steer*maxSteer-(p.steering||0))*(1-Math.exp(-(bus?4.2:8)*dt));
    if(gas)v+=(v<-.3?spec.accel*1.6:spec.accel*Math.max(.08,1-(Math.max(0,v)/spec.speed)**1.7))*dt;
    else if(brake){
      if(v>.15){v=Math.max(0,v-(bus?13:19)*dt);p.reverseDelay=.25;}
      else if((p.reverseDelay||0)>0)p.reverseDelay-=dt;
      else v-=spec.accel*.44*dt;
    }else v=Math.sign(v)*Math.max(0,Math.abs(v)-(.65+Math.abs(v)*.035)*dt);
    const hand=input.has('drift')?clamp((v-5.56)/2.5,0,1):0;
    p.rearRelease=(p.rearRelease||0)+(hand-(p.rearRelease||0))*(1-Math.exp(-(hand?3.8:2.7)*dt));
    const grip=spec.grip||1;
    const rearGrip=1-p.rearRelease*(bus?.1:van?.45:.65),direction=v<0?-1:1,u=Math.max(3.5,Math.abs(v));
    const frontSlip=Math.atan2(lat+lf*r,u)-p.steering*direction,rearSlip=Math.atan2(lat-lr*r,u);
    const ff=clamp(-frontSlip*(bus?24:32)*grip,-6.8*grip,6.8*grip),fr=clamp(-rearSlip*(bus?30:36)*rearGrip*grip,-7.5*rearGrip*grip,7.5*rearGrip*grip);
    if(Math.abs(v)<3.5){r+=(v/wb*Math.tan(p.steering)-r)*(1-Math.exp(-10*dt));lat*=Math.exp(-12*dt);p.rearRelease*=Math.exp(-8*dt);}
    else {lat+=(ff+fr-v*r)*dt;r+=((lf*ff-lr*fr)/(wb*wb*.23)-r*.23)*dt;
      const target=v/wb*Math.tan(p.steering);r+=(target-r)*(1-Math.exp(-(1-p.rearRelease*.65)*4*dt));
      v+=lat*r*dt;r=clamp(r,-1.0,1.0);lat=clamp(lat,-u*.85,u*.85);}
    v*=Math.exp(-(.22*p.rearRelease+Math.abs(frontSlip*ff+rearSlip*fr)*.018)*dt);v=clamp(v,-spec.speed*.28,spec.speed);
    p.yaw+=r*dt;p.vx=-Math.sin(p.yaw)*v-Math.cos(p.yaw)*lat;p.vz=-Math.cos(p.yaw)*v+Math.sin(p.yaw)*lat;
    p.x+=p.vx*dt;p.z+=p.vz*dt;p.longitudinal=v;p.lateral=lat;p.yawRate=r;p.speed=Math.hypot(v,lat);
    p.slip=Math.atan2(lat,Math.max(1,Math.abs(v)));p.tyreSlip=Math.max(Math.abs(frontSlip),Math.abs(rearSlip));
    p.roll=(p.roll||0)+(-clamp((ff+fr)*.008,-.085,.085)-(p.roll||0))*(1-Math.exp(-5*dt));
    p.pitch=(p.pitch||0)+(clamp((v-prior)/Math.max(.001,dt)*.003,-.035,.05)-(p.pitch||0))*(1-Math.exp(-5*dt));
  };
  P.confine=function(p,extent=3){
    const limit=P.edge-extent,soft=limit-15;let leaving=false;
    for(const axis of ['x','z']){
      const n=p[axis],a=Math.abs(n),sign=Math.sign(n),velocity=axis==='x'?'vx':'vz';
      if(a>soft){
        leaving=true;
        if(sign*p[velocity]>0){p[velocity]*=clamp((limit-a)/15,0,1);p.longitudinal*=.985;p.lateral*=.985;}
        p[axis]=sign*Math.min(limit,a);
        if(a>=limit){p[velocity]=-sign*.8;p.longitudinal*=.9;p.lateral*=.9;p[axis]-=sign*.04;}
      }
    }
    return leaving;
  };
})(window.PX);
