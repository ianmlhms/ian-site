/* Local flavour: roadworks, cameras, rain and reachable stars, using pooled geometry. */
(function(P){
  'use strict';
  const T=THREE,C=P.config,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const RADARS=[{x:-115,z:3},{x:-168,z:-115},{x:110,z:87},{x:252,z:-110}];
  const STARS=[[-278,-230],[-278,-125],[-278,-20],[-278,80],[-278,180],[-278,260],[-205,-278],[-100,-278],[20,-278],[130,-278],[240,-278],[278,-220],[278,-110],[278,10],[278,130],[278,250],[-210,285],[-100,285],[10,285],[120,285],[240,285],[-125,174],[126,145],[244,164],[218,148,12]];
  function limit(point){return Math.max(Math.abs(point.x),Math.abs(point.z))>235?C.limits.outer:P.career.districtAt(point)==='Alstad'?C.limits.oldTown:C.limits.town;}
  function fine(){return 0;}   // no radars any more
  function height(point){
    if(point.x>=231&&point.x<=244&&point.z>=85&&point.z<=145)return (point.z-85)/5;
    if(point.x>=204&&point.x<=244&&point.z>=141&&point.z<=154)return 12;
    if(Math.abs(point.x+278)<5&&point.z>188&&point.z<240)return Math.max(0,3*(1-Math.abs(point.z-214)/26));
    return 0;
  }
  function shortcut(point){return Math.abs(point.x+278)<5&&point.z>188&&point.z<240;}
  function build(scene){
    const geometry=[],dummy=new T.Object3D(),barriers=[],lastPass=new Map(),stars=STARS.map(([x,z,y=0],id)=>({x,z,y,id}));
    function box(list,color,x,y,z,w,h,d){const g=P.tint(new T.BoxGeometry(w,h,d),color);g.translate(x,y,z);list.push(g);}
    function sign(label,x,y,z,bg='#fff7db',w=5){
      const canvas=document.createElement('canvas');canvas.width=512;canvas.height=160;const ctx=canvas.getContext('2d');
      ctx.fillStyle=bg;ctx.fillRect(0,0,512,160);ctx.fillStyle='#283930';ctx.font='bold 48px system-ui';ctx.textAlign='center';ctx.fillText(label,256,96);
      const material=new T.SpriteMaterial({map:new T.CanvasTexture(canvas)}),sprite=new T.Sprite(material);sprite.position.set(x,y,z);sprite.scale.set(w,w*160/512,1);scene.add(sprite);return sprite;
    }
    // no speed limits, radars or limit signs: the goal is to deliver as fast as possible (Ian, 14 Oct 2026)
    const roadworks=(x,z,district,vertical)=>{
      const group=new T.Group(),parts=[];
      for(let i=-2;i<=2;i++){box(parts,'#ed9c35',vertical?x+i*3:x,1,vertical?z:z+i*3,vertical?2:.5,1.8,vertical?.5:2);}
      for(let i=-2;i<=2;i++)box(parts,'#fff1cf',vertical?x+i*3:x,1.4,vertical?z:z+i*3,vertical?1.5:.55,.25,vertical?.55:1.5);
      const mesh=new T.Mesh(P.merge(parts),P.material('works',{vertexColors:true}));group.add(mesh);scene.add(group);
      barriers.push({group,label:sign('',x,4,z,'#ffdfa4',12),district});
    };
    for(const z of P.roads.filter(z=>z<232))roadworks(19,z,z< -42?'Kirchberg':'Belair',false);
    for(const x of P.roads)roadworks(x,234,x<14?'Ateliers':'Parc de la Pétrusse',true);
    const mesh=new T.Mesh(P.merge(geometry),P.material('radars',{vertexColors:true}));scene.add(mesh);
    const roadMat=P.material('shortcuts',{color:'#b7a88b',roughness:.8});
    const carParkPath=new T.Mesh(new T.BoxGeometry(7,.08,84),roadMat);carParkPath.position.set(190,.25,126);scene.add(carParkPath);
    const path=new T.Mesh(new T.BoxGeometry(6,.08,84),roadMat);path.position.set(126,.25,126);scene.add(path);
    for(const [z,slope] of [[201,-1],[227,1]]){const bridge=new T.Mesh(new T.BoxGeometry(9,.35,Math.hypot(26,3)),roadMat);bridge.position.set(-278,1.5,z);bridge.rotation.x=slope*Math.atan2(3,26);scene.add(bridge);}
    const ramp=new T.Mesh(new T.BoxGeometry(12,.4,Math.hypot(60,12)),roadMat);ramp.rotation.x=-Math.atan2(12,60);ramp.position.set(237,6,115);scene.add(ramp);
    const deck=new T.Mesh(new T.BoxGeometry(40,.5,13),roadMat);deck.position.set(224,11.75,147.5);scene.add(deck);
    sign('↗ ⭐',237,2,80,'#ffdfa4',5);
    const starMesh=new T.InstancedMesh(new T.OctahedronGeometry(1.1),P.material('parcel-stars',{color:'#ffc94a',emissive:'#e9a322',emissiveIntensity:.65}),25);starMesh.frustumCulled=false;scene.add(starMesh);
    const rainPositions=new Float32Array(600*3),random=P.missions.rng('rain');for(let i=0;i<rainPositions.length;i+=3){rainPositions[i]=(random()-.5)*90;rainPositions[i+1]=random()*28;rainPositions[i+2]=(random()-.5)*90;}
    const rainGeometry=new T.BufferGeometry();rainGeometry.setAttribute('position',new T.BufferAttribute(rainPositions,3));
    const rain=new T.Points(rainGeometry,new T.PointsMaterial({color:'#b8d9e6',size:.15,transparent:true,opacity:.7}));rain.visible=false;scene.add(rain);
    let previousWeather=null;
    function refresh(save,t){
      for(const b of barriers){const locked=!save.districts.includes(b.district);b.group.visible=b.label.visible=locked;
        const canvas=b.label.material.map.image,ctx=canvas.getContext('2d');ctx.fillStyle='#ffdfa4';ctx.fillRect(0,0,512,160);ctx.fillStyle='#283930';ctx.font='bold 34px system-ui';ctx.textAlign='center';ctx.fillText(t('locked')+' — '+C.districts[b.district].toLocaleString()+' €',256,96);b.label.material.map.needsUpdate=true;}
    }
    function update(player,save,weather,dt,now){
      let count=0;for(const s of stars){if(save.stars.includes(s.id))continue;dummy.position.set(s.x,s.y+2+Math.sin(now*.002+s.id)*.3,s.z);dummy.rotation.set(0,now*.001,Math.PI/4);dummy.scale.setScalar(1);dummy.updateMatrix();starMesh.setMatrixAt(count++,dummy.matrix);}starMesh.count=count;starMesh.instanceMatrix.needsUpdate=true;
      if(weather!==previousWeather){const road=P.material('asphalt');road.roughness=weather==='rain'?.28:.98;road.color.set(weather==='rain'?'#84999e':'#ffffff');previousWeather=weather;}
      rain.visible=weather==='rain';rain.position.set(player.x,0,player.z);
      if(rain.visible){for(let i=1;i<rainPositions.length;i+=3){rainPositions[i]-=dt*20;if(rainPositions[i]<0)rainPositions[i]+=28;}rainGeometry.attributes.position.needsUpdate=true;}
    }
    function cameraFine(){return 0;}
    function collect(player,save){return stars.find(s=>!save.stars.includes(s.id)&&Math.hypot(s.x-player.x,s.z-player.z)<3.5&&Math.abs(height(player)-s.y)<2);}
    return {refresh,update,cameraFine,collect,reset:()=>lastPass.clear(),stars,barriers};
  }
  P.lux={build,limit,fine,height,shortcut,radars:RADARS};
})(window.PX);
