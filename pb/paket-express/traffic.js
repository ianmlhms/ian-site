/* Lane graph, signal phases, queues, crossings and pooled vehicle instances. */
(function(P){
  'use strict';
  const T=THREE,roads=P.roads,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const colors=['#bb6250','#77a5b1','#e7dec9','#65816c','#466a86','#b39963','#b7bcc1'];
  const offset=e=>({x:-e.z*3,z:e.x*3}),yaw=e=>Math.atan2(-e.x,-e.z);
  P.createTraffic=function(scene){
    const cars=[],junctions=[],peds=[],batches=[],dummy=new T.Object3D();
    let time=0,active=46,turns=0,honks=0,stops=0,visible=0,respawns=0,setting='normal',spots=[],random=Math.random;
    for(const x of roads)for(const z of roads)if(x>=0&&z>=0)junctions.push({x,z,offset:(roads.indexOf(x)+roads.indexOf(z))%3*2});
    const signal=(j,axis)=>{const t=(time+j.offset)%24;return axis==='x'?(t<9?'green':t<10?'amber':'red'):(t>=12&&t<21?'green':t>=21&&t<22?'amber':'red');};
    function makeBatch(kind,spec){
      // Dedicated low-poly traffic LOD: two draws per body type, rather than full player detail per car.
      const paint=[],detail=[],length=spec.length,w=kind==='bus'?2.6:kind==='auto'?2:2.3;
      const box=(bucket,color,x,y,z,bw,bh,bd)=>{const g=P.tint(new T.BoxGeometry(bw,bh,bd),color);g.translate(x,y,z);bucket.push(g);};
      box(paint,'#ffffff',0,.85,0,w,.75,length);
      if(kind==='auto') {
        box(paint,'#ffffff',0,1.7,.3,w*.8,.65,length*.48);
        box(detail,'#7196a0',0,1.72,-length*.19,w*.75,.53,.06);
        for(const side of [-1,1])box(detail,'#658996',side*w*.407,1.72,.35,.06,.5,length*.43);
      }else if(kind==='truck'){
        box(paint,'#ffffff',0,1.6,-length*.3,w,1.5,length*.35);
        box(detail,'#96bac2',0,2,-length*.48,w*.86,.85,.06);
        box(detail,'#7c8e87',0,1.3,length*.2,w,1.4,length*.62);
        for(const side of [-1,1])box(detail,'#e0d5b5',side*.5,2.3,length*.15,.85,.8,2.2);
      }else{
        box(paint,'#ffffff',0,1.9,0,w*.98,1.8,length*.95);
        box(detail,'#86a8b4',0,2.05,-length*.48,w*.85,1.15,.06);
        for(const side of [-1,1]) {
          if(kind==='bus')for(let z=-length/2+.8;z<length/2-.4;z+=1.3)box(detail,'#628493',side*w*.5,2.15,z,.06,.85,1.05);
          else box(detail,'#70929e',side*w*.5,2.05,-length*.27,.06,.9,1.05);
          box(detail,'#f4efdd',side*w*.5,1.3,0,.06,.12,length*.9);
        }
      }
      for(const side of [-1,1])for(const z of [-length*.32,length*.32]){
        const g=P.tint(new T.CylinderGeometry(.45,.45,.28,8),'#28332e');g.rotateZ(Math.PI/2);g.translate(side*w/2,.57,z);detail.push(g);
      }
      for(const side of [-1,1]){box(detail,'#ffedb9',side*w*.3,.98,-length/2-.03,.4,.22,.06);box(detail,'#d04f3b',side*w*.32,.98,length/2+.03,.28,.28,.06);}
      const parts=[paint,detail].map((gs,i)=>{const material=P.material(i?'traffic-detail':'traffic-paint',{vertexColors:true,roughness:i?.65:.38,metalness:i?.1:.18});const mesh=new T.InstancedMesh(P.merge(gs),material,140);mesh.userData.paint=i===0;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;scene.add(mesh);return mesh;});
      batches.push({kind,parts,spec});
    }
    makeBatch('auto',{id:'auto',length:4.1});makeBatch('van',{id:'van',length:5.3});makeBatch('bus',{id:'bus',length:8});makeBatch('truck',{id:'van',length:7});
    for(let k=0;k<5;k++)for(const axis of ['x','z'])for(let ri=0;ri<7;ri++)for(const direction of [-1,1]){
      const index=cars.length,e={x:axis==='x'?direction:0,z:axis==='z'?direction:0},o=offset(e),r=roads[ri],t=-210+((k+ri)%6)*84+(direction<0?-8:8);
      const kind=index%19===0?'bus':index%13===0?'truck':index%5===0?'van':'auto';
      const c={id:index,kind,color:colors[index%colors.length],x:axis==='x'?t:r+o.x,z:axis==='z'?t:r+o.z,e,road:r,speed:5,targetSpeed:kind==='bus'?8:kind==='truck'?7:10+index%4,length:kind==='bus'?8:kind==='truck'?7:kind==='van'?5.3:4.1,blocked:0,hornCooldown:0,turn:null,active:true,stopReason:''};
      cars.push(c);prepare(c);
    }
    function prepare(c){
      const axis=c.e.x?'x':'z',n=c[axis],d=c.e[axis],sorted=d>0?roads:roads.slice().reverse();
      let next=sorted.find(r=>(r-n)*d>14.05);if(next===undefined)next=d>0?252:-252;
      c.j={x:axis==='x'?next:c.road,z:axis==='z'?next:c.road};
      c.end={x:c.j.x-c.e.x*14+offset(c.e).x,z:c.j.z-c.e.z*14+offset(c.e).z};
      c.signal=junctions.find(j=>j.x===c.j.x&&j.z===c.j.z);
    }
    function chooseTurn(c){
      const incoming=c.e,choices=[incoming,{x:-incoming.z,z:incoming.x},{x:incoming.z,z:-incoming.x}].filter(e=>Math.abs(c.j.x+e.x*84)<=252&&Math.abs(c.j.z+e.z*84)<=252);
      const outgoing=choices.length?(random()<.55&&choices.includes(incoming)?incoming:choices[Math.floor(random()*choices.length)]):{x:-incoming.x,z:-incoming.z};
      const o=offset(outgoing),start={x:c.x,z:c.z},end={x:c.j.x+outgoing.x*14+o.x,z:c.j.z+outgoing.z*14+o.z};
      c.turn={points:[start,{x:start.x+incoming.x*12,z:start.z+incoming.z*12},{x:end.x-outgoing.x*12,z:end.z-outgoing.z*12},end],outgoing,progress:0,length:incoming.x===outgoing.x&&incoming.z===outgoing.z?28:24};
      if(outgoing.x!==incoming.x||outgoing.z!==incoming.z)turns++;
    }
    const furniture=[],bulbs=[];
    junctions.forEach(j=>{
      for(const e of [{x:1,z:0},{x:-1,z:0},{x:0,z:1},{x:0,z:-1}]){
        const o=offset(e),x=j.x-e.x*15+o.x*3,z=j.z-e.z*15+o.z*3;
        furniture.push({x,y:2.1,z,w:.12,h:4.2,d:.12},{x:x+e.x*.5,y:3.8,z:z+e.z*.5,w:.65,h:1.9,d:.55});
        for(let k=0;k<3;k++)bulbs.push({x:x+e.x*.55,y:4.4-k*.6,z:z+e.z*.55,j,axis:e.x?'x':'z',color:['red','amber','green'][k]});
      }
      for(let k=0;k<4;k++)peds.push({j,axis:k%2?'x':'z',side:k<2?-1:1,t:0,x:0,z:0,crossing:false});
    });
    const poles=new T.InstancedMesh(new T.BoxGeometry(1,1,1),P.material('traffic-poles',{color:'#384b48'}),furniture.length);poles.frustumCulled=false;scene.add(poles);
    furniture.forEach((p,i)=>{dummy.position.set(p.x,p.y,p.z);dummy.scale.set(p.w,p.h,p.d);dummy.updateMatrix();poles.setMatrixAt(i,dummy.matrix);});
    const lamps=new T.InstancedMesh(new T.SphereGeometry(.21,8,6),new T.MeshBasicMaterial(),bulbs.length);lamps.frustumCulled=false;scene.add(lamps);
    const personParts=[],torso=P.tint(new T.BoxGeometry(.45,.75,.28),'#ffffff');torso.translate(0,1,0);personParts.push(torso);
    const head=P.tint(new T.SphereGeometry(.19,8,6),'#dbc29e');head.translate(0,1.58,0);personParts.push(head);
    for(const side of [-1,1]){const leg=P.tint(new T.BoxGeometry(.13,.6,.16),'#41535c');leg.translate(side*.14,.35,0);personParts.push(leg);}
    const people=new T.InstancedMesh(P.merge(personParts),P.material('pedestrians',{vertexColors:true}),peds.length);people.frustumCulled=false;scene.add(people);
    function pedestrians(){
      peds.forEach((p,i)=>{
        const phase=(time+p.j.offset)%24,redStart=p.axis==='x'?10:22,redTime=(phase-redStart+24)%24;
        const width=p.axis==='x'?(p.j.z>0?16:p.j.z===0?13:11):(p.j.x>0?16:p.j.x===0?13:11),span=width+3,along=clamp(redTime/10,0,1),cycle=Math.floor((time+p.j.offset-redStart)/24),across=p.side*(cycle%2===0?1:-1)*(span/2-span*along);
        p.crossing=redTime<10;p.x=p.j.x+(p.axis==='x'?11:across);p.z=p.j.z+(p.axis==='x'?across:11);
        if(!p.crossing){p.x+=p.axis==='x'?Math.sin(time*.4+i)*2:0;p.z+=p.axis==='z'?Math.sin(time*.4+i)*2:0;}p.t=along;
      });
    }
    function update(dt,player,quality,honk){
      time+=dt;active=Math.min(P.config.traffic[setting].count,P.config.qualityCaps[quality]);pedestrians();
      const snapshots=cars.slice(0,active).map(c=>({x:c.x,z:c.z,e:{...c.e},length:c.length,id:c.id,speed:c.speed}));
      cars.forEach((c,i)=>{
        c.active=i<active;if(!c.active)return;
        let desired=c.targetSpeed;c.stopReason='';
        const gap=Math.hypot(c.end.x-c.x,c.end.z-c.z);
        if(!c.turn&&c.signal&&signal(c.signal,c.e.x?'x':'z')!=='green'){desired=Math.min(desired,Math.sqrt(8*Math.max(0,gap-.7)));c.stopReason='signal';}
        for(const other of snapshots){
          if(other.id===c.id)continue;
          const dx=other.x-c.x,dz=other.z-c.z,ahead=dx*c.e.x+dz*c.e.z,side=Math.abs(dx*c.e.z-dz*c.e.x);
          if(ahead>0&&side<2.3&&ahead<35){const safe=Math.max(0,(ahead-(c.length+other.length)/2-2.2)/(1.1+c.speed*.02));if(safe<desired){desired=safe;c.stopReason='queue';}}
        }
        const dx=player.x-Math.sin(player.yaw||0)*1.3-c.x,dz=player.z-Math.cos(player.yaw||0)*1.3-c.z,ahead=dx*c.e.x+dz*c.e.z,side=Math.abs(dx*c.e.z-dz*c.e.x);
        if(ahead>-1&&ahead<28&&side<2.8){desired=Math.min(desired,Math.max(0,(ahead-c.length/2-4)/1.25));c.stopReason='player';}
        for(const p of peds)if(p.crossing){const dx=p.x-c.x,dz=p.z-c.z,a=dx*c.e.x+dz*c.e.z;if(a>0&&a<16&&Math.abs(dx*c.e.z-dz*c.e.x)<3){desired=0;c.stopReason='pedestrian';}}
        c.blocked=c.stopReason==='player'?c.blocked+dt:0;c.hornCooldown=Math.max(0,c.hornCooldown-dt);
        if(c.blocked>1.8&&c.hornCooldown===0){c.hornCooldown=5;honks++;if(Math.hypot(dx,dz)<45)honk?.(c.kind);}
        c.speed+=clamp(desired-c.speed,-6*dt,2*dt);if(c.speed<.2&&c.stopReason==='signal')stops++;
        c.stuck=c.speed<.3?(c.stuck||0)+dt:0;
        if(c.stuck>P.config.stuckSeconds||spots.some(p=>Math.hypot(c.x-p.x,c.z-p.z)<10)){respawn(c,player);return;}
        let travel=c.speed*dt;
        if(!c.turn){
          if(travel>=gap){if(c.signal&&signal(c.signal,c.e.x?'x':'z')!=='green')travel=Math.max(0,gap-.7);else{c.x=c.end.x;c.z=c.end.z;chooseTurn(c);travel=Math.max(0,travel-gap);}}
          if(!c.turn){c.x+=c.e.x*travel;c.z+=c.e.z*travel;}
        }
        if(c.turn){
          const turn=c.turn,t=turn.progress=Math.min(1,turn.progress+travel/turn.length),u=1-t,[a,b,d,e]=turn.points;
          c.x=u*u*u*a.x+3*u*u*t*b.x+3*u*t*t*d.x+t*t*t*e.x;c.z=u*u*u*a.z+3*u*u*t*b.z+3*u*t*t*d.z+t*t*t*e.z;
          const tx=3*u*u*(b.x-a.x)+6*u*t*(d.x-b.x)+3*t*t*(e.x-d.x),tz=3*u*u*(b.z-a.z)+6*u*t*(d.z-b.z)+3*t*t*(e.z-d.z),len=Math.hypot(tx,tz);c.e={x:tx/len,z:tz/len};
          if(t===1){c.e=turn.outgoing;c.road=c.e.x?c.j.z:c.j.x;c.turn=null;prepare(c);}
        }
        c.yaw=yaw(c.e);
      });
    }
    function respawn(c,player){
      const candidates=[];
      for(const axis of ['x','z'])for(const road of roads)for(const along of [-210,-126,-42,42,126,210]){
        const direction=random()<.5?-1:1,e={x:axis==='x'?direction:0,z:axis==='z'?direction:0},o=offset(e);
        const point={x:axis==='x'?along:road+o.x,z:axis==='z'?along:road+o.z,e,road};
        if(Math.hypot(point.x-player.x,point.z-player.z)>230&&!spots.some(p=>Math.hypot(point.x-p.x,point.z-p.z)<12))candidates.push(point);
      }
      const point=candidates.find(p=>!cars.some(other=>other!==c&&other.active&&Math.hypot(p.x-other.x,p.z-other.z)<16))||candidates[0];
      if(!point)throw new Error('No out-of-sight traffic spawn');
      Object.assign(c,point,{speed:6,turn:null,stuck:0,blocked:0,stopReason:''});prepare(c);respawns++;
    }
    function configure(next,seed=null,deliverySpots=[]){
      if(!P.config.traffic[next])throw new Error('Unknown traffic setting');
      setting=next;spots=deliverySpots.map(p=>({x:p.x,z:p.z}));
      if(seed!==null){
        random=P.missions.rng(seed);time=0;respawns=0;
        cars.forEach((c,i)=>{
          const axis=i%2?'x':'z',road=roads[Math.floor(i/2)%7],direction=Math.floor(i/14)%2?1:-1;
          c.e={x:axis==='x'?direction:0,z:axis==='z'?direction:0};const o=offset(c.e),along=-220+(Math.floor(i/28)%5)*85+random()*12;
          c.x=axis==='x'?along:road+o.x;c.z=axis==='z'?along:road+o.z;c.road=road;c.speed=5;c.turn=null;c.stuck=0;c.blocked=0;prepare(c);
        });
      }
    }
    function render(player,quality){
      const range={high:225,medium:165,low:110}[quality];visible=0;
      for(const batch of batches){let n=0;
        for(const c of cars)if(c.active&&c.kind===batch.kind&&Math.hypot(c.x-player.x,c.z-player.z)<range){
          dummy.position.set(c.x,.05,c.z);dummy.rotation.set(0,c.yaw??yaw(c.e),0);dummy.scale.set(1,1,1);dummy.updateMatrix();batch.parts.forEach(m=>{m.setMatrixAt(n,dummy.matrix);if(m.userData.paint)m.setColorAt(n,new T.Color(c.color));});n++;
        }
        visible+=n;batch.parts.forEach(m=>{m.count=n;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;});
      }
      bulbs.forEach((l,i)=>{dummy.position.set(l.x,l.y,l.z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(Math.hypot(l.x-player.x,l.z-player.z)<range?1:0);dummy.updateMatrix();lamps.setMatrixAt(i,dummy.matrix);lamps.setColorAt(i,new T.Color(signal(l.j,l.axis)===l.color?{red:'#ff4731',amber:'#ffc544',green:'#57e59b'}[l.color]:'#243633'));});lamps.instanceMatrix.needsUpdate=true;lamps.instanceColor.needsUpdate=true;
      peds.forEach((p,i)=>{dummy.position.set(p.x,.15+(p.crossing?Math.abs(Math.sin(time*7+i))*.035:0),p.z);dummy.rotation.set(0,p.axis==='x'?0:Math.PI/2,Math.sin(time*7+i)*.035);dummy.scale.setScalar(Math.hypot(p.x-player.x,p.z-player.z)<range?1:0);dummy.updateMatrix();people.setMatrixAt(i,dummy.matrix);people.setColorAt(i,new T.Color(['#c99359','#6f9fbc','#b65a53','#719171'][i%4]));});people.instanceMatrix.needsUpdate=true;people.instanceColor.needsUpdate=true;
    }
    function blockTrial(){
      const saved=cars.map(c=>structuredClone(c)),old={time,active,turns,honks,stops,respawns,spots};spots=[];
      const c=cars.find(c=>c.active&&c.kind==='auto');
      if(!c){spots=old.spots;return {stopped:false,honked:false};}
      cars.filter(other=>other!==c).forEach(other=>{Object.assign(other,{x:150,z:171,e:{x:1,z:0},road:168,speed:0,turn:null,stuck:0,blocked:0});prepare(other);});
      Object.assign(c,{x:-220,z:-249,e:{x:1,z:0},road:-252,speed:9,blocked:0,stuck:0,hornCooldown:0,turn:null});prepare(c);
      const player={x:c.x+c.e.x*24,z:c.z+c.e.z*24+1.3,yaw:0},before={x:c.x,z:c.z};
      for(let i=0;i<300;i++)update(1/60,player,'high');
      const result={stopped:c.speed<.3,honked:honks>old.honks,moved:Math.hypot(c.x-before.x,c.z-before.z),gap:Math.hypot(player.x-c.x,player.z-1.3-c.z)};
      cars.forEach((c,i)=>Object.assign(c,saved[i]));({time,active,turns,honks,stops,respawns,spots}=old);return result;
    }
    return {cars,update,render,configure,blockTrial,stats:()=>({count:active,visible,turns,honks,stops,respawns,setting,signals:junctions.length,pedestrians:peds.length,types:[...new Set(cars.slice(0,active).map(c=>c.kind))]}),signals:()=>junctions.map(j=>({...j,xLight:signal(j,'x'),zLight:signal(j,'z')}))};
  };
})(window.PX);
