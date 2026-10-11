(function (P) {
  'use strict';
  const T = THREE, cache = new Map();
  const materials = {
    paint: P.material('car-paint', { vertexColors: true, roughness: .32, metalness: .22 }),
    trim: P.material('car-trim', { vertexColors: true, roughness: .55, metalness: .5 }),
    glass: P.material('car-glass', { color: '#83a5b1', roughness: .12, metalness: .65 }),
    lights: P.material('car-lights', { vertexColors: true, emissive: '#ffffff', emissiveIntensity: .5, roughness: .25 }),
    tyre: P.material('tyre', { color: '#242826', roughness: .95 }),
    hub: P.material('wheel-hub', { color: '#b8b9b2', roughness: .3, metalness: .8 }),
  };
  materials.lights.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor;'); };
  P.makeVehicle = function (spec, color = '#edb44e', headlights = false) {
    const group = new T.Group(), body = new T.Group(); group.add(body);
    const length = spec.length, bus = spec.id === 'bus', van = spec.id === 'van' || spec.id === 'truck', truck=spec.id==='truck',sport=spec.id==='sport', large = bus || van;
    const width = bus ? 2.65 : van ? 2.25 : 2, wb = length * .64, cz = -wb / 2;
    const key = spec.id + ':' + color + ':' + (spec.parcel !== false);
    if (!cache.has(key)) {
      const buckets = new Map();
      const add = (kind, geometry, x, y, z, tint = '#ffffff') => {
        P.tint(geometry, tint); geometry.translate(x, y, z + cz);
        if (!buckets.has(kind)) buckets.set(kind, []); buckets.get(kind).push(geometry);
      };
      const b = (kind, x, y, z, w, h, d, tint) => add(kind, P.bevelBox(w, h, d, Math.min(.09, h / 4)), x, y, z, tint);
      add('paint', P.bevelBox(width, large ? 1 : .72, length, .18), 0, .91, 0, color);
      b('trim', 0, .65, 0, width * .94, .18, length * .94, '#333c39');
      if(truck){
        add('paint',P.bevelBox(width,2.1,length*.34,.15),0,1.9,-length*.3,color);
        b('glass',0,2.2,-length/2-.04,width*.85,1.2,.06);
        b('trim',0,2.4,length*.18,width*1.1,2.7,length*.58,'#c9d4cd');
      }else if (large) {
        add('paint', P.bevelBox(width * .98, bus ? 1.85 : 1.7, length * .93, .18), 0, bus ? 2.02 : 1.9, .04, color);
        b('glass', 0, 2.1, -length / 2 - .045, width * .84, bus ? 1.4 : 1.05, .06);
        b('glass', 0, 2.05, length / 2 + .025, width * .78, .9, .06);
        for (const s of [-1, 1]) {
          if (bus) {
            for (let z = -length / 2 + .6; z < length / 2 - .4; z += 1.1) b('glass', s * (width / 2 + .01), 2.17, z, .055, .93, .92);
            b('trim', s * (width / 2 + .04), 1.42, 0, .05, .12, length * .92, '#edf0dd');
            b('glass', s * (width / 2 + .03), 1.65, -length * .28, .055, 2, 1.08);
          } else {
            b('glass', s * (width / 2 + .015), 2.03, -length * .29, .055, .9, 1.12);
            b('trim', s * (width / 2 + .025), 1.4, length * .09, .06, .035, length * .58, '#987b3d');
            b('trim', s * (width / 2 + .04), 1.58, -length * .16, .07, .07, .25, '#e1dfce');
          }
        }
        b('trim', 0, bus ? 3.02 : 2.84, 0, width * .7, .08, length * .8, '#e6dfcb');
      } else {
        // Tapered cabin with a raked windscreen and rear glass, rather than a stack of boxes.
        const cabin = new T.BufferGeometry(), w0 = width * .45, w1 = width * .36, y0 = 1.25, y1 = sport?1.75:2.03;
        const verts = [-w0,y0,-1.05,w0,y0,-1.05,w1,y1,-.5,-w1,y1,-.5, -w0,y0,1.25,w0,y0,1.25,w1,y1,.79,-w1,y1,.79];
        cabin.setAttribute('position', new T.Float32BufferAttribute(verts, 3));
        cabin.setIndex([0,3,2,0,2,1, 4,5,6,4,6,7, 0,4,7,0,7,3, 1,2,6,1,6,5, 3,7,6,3,6,2]); cabin.computeVertexNormals();
        add('glass', cabin, 0, 0, .13);
        add('paint', P.bevelBox(width * .76, .12, 1.46, .06), 0, sport?1.8:2.08, .28, color);
        for (const s of [-1, 1]) {
          b('paint', s * .79, 1.7, .35, .065, .75, .12, color);
          b('trim', s * (width / 2 + .03), 1.23, 0, .05, .035, 2.6, '#655b44');
          b('trim', s * 1.1, 1.66, -.72, .26, .2, .32, '#3b4847');
          b('trim', s * (width / 2 + .04), 1.34, .61, .04, .05, .23, '#dfdacb');
        }
        // Parcel strapped on the roof is a shaped cardboard box with a tape strip.
        if(sport){b('trim',0,1.7,length*.38,width*1.1,.12,.45,'#244e58');b('lights',0,1.14,-length/2-.09,width*.85,.1,.07,'#75e7dc');}
        if (spec.parcel !== false&&!sport) {
          add('paint', P.bevelBox(.84, .48, .8, .04), 0, 2.39, .31, '#bb8d59');
          b('trim', 0, 2.637, .31, .11, .014, .81, '#e5d2ad');
        }
      }
      for (const s of [-1, 1]) {
        b('lights', s * width * .32, 1.08, -length / 2 - .085, large ? .45 : .48, .24, .065, '#fff1c3');
        b('lights', s * width * .36, 1.03, length / 2 + .07, .29, .31, .065, '#cd4935');
        b('trim', s * (width / 2 + .08), .77, -wb / 2, .08, .12, 1.18, '#333936');
        b('trim', s * (width / 2 + .08), .77, wb / 2, .08, .12, 1.18, '#333936');
      }
      b('trim', 0, .78, -length / 2 - .045, width * .9, .16, .1, '#424c48');
      b('trim', 0, .78, length / 2 + .045, width * .9, .16, .1, '#424c48');
      b('trim', 0, 1.04, -length / 2 - .1, width * .29, .12, .07, '#34403f');
      b('trim', 0, .86, length / 2 + .11, .5, .16, .025, '#f4ecd5');
      cache.set(key, [...buckets].map(([kind, gs]) => ({ kind, geometry: P.merge(gs) })));
    }
    for (const part of cache.get(key)) { const mesh = new T.Mesh(part.geometry, materials[part.kind]); mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh); }
    const radius = bus ? .59 : van ? .51 : .46;
    const tire = new T.CylinderGeometry(radius, radius, .3, 20); tire.rotateZ(Math.PI / 2);
    const hubParts = [];
    for (const side of [-1,1]) {
      const rim = new T.TorusGeometry(radius * .58,.035,6,20); rim.rotateY(Math.PI / 2); rim.translate(side * .165,0,0); hubParts.push(rim);
    }
    const axle = new T.CylinderGeometry(radius * .16,radius * .16,.34,12); axle.rotateZ(Math.PI / 2); hubParts.push(axle);
    for (let i = 0; i < 5; i++) {
      const spoke = new T.BoxGeometry(.34,radius * .56,.05); spoke.translate(0,radius * .3,0); spoke.rotateX(i * Math.PI * 2 / 5); hubParts.push(spoke);
    }
    const hub = P.merge(hubParts);
    const tires = new T.InstancedMesh(tire, materials.tyre, 4), hubs = new T.InstancedMesh(hub, materials.hub, 4);
    tires.castShadow = hubs.castShadow = true; tires.instanceMatrix.setUsage(T.DynamicDrawUsage); hubs.instanceMatrix.setUsage(T.DynamicDrawUsage);
    group.add(tires, hubs);
    let spin = 0; const dummy = new T.Object3D(), q = new T.Quaternion(), axis = new T.Vector3(1, 0, 0);
    group.userData.update = function (speed, steering, dt, roll = 0, pitch = 0, night = 0) {
      spin -= speed * dt / radius;
      for (let i = 0; i < 4; i++) {
        dummy.position.set((i % 2 ? 1 : -1) * (width / 2 + .04), radius + .13, i < 2 ? -wb : 0);
        dummy.rotation.set(0, i < 2 ? steering : 0, 0); q.setFromAxisAngle(axis, spin); dummy.quaternion.multiply(q); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
        tires.setMatrixAt(i, dummy.matrix); hubs.setMatrixAt(i, dummy.matrix);
      }
      tires.instanceMatrix.needsUpdate = hubs.instanceMatrix.needsUpdate = true; if (!tires.boundingSphere) { tires.computeBoundingSphere(); hubs.computeBoundingSphere(); }
      body.rotation.z = roll; body.rotation.x = pitch;
      group.userData.frontSteer = steering; group.userData.wheelSpin = spin;
      group.userData.headlamps?.forEach(l => { l.intensity = night * 160; l.visible = night > .02; });
    };
    group.userData.wheelbase = wb;
    if (headlights) {
      group.userData.headlamps = [-1, 1].map(s => {
        const l = new T.SpotLight('#fff0cc', 0, 42, .39, .7, 1.6); l.visible = false; l.position.set(s * width * .32, 1.1, -length / 2 + cz - .1);
        const target = new T.Object3D(); target.position.set(s * width * .32, 0, -40); group.add(target); l.target = target; group.add(l); return l;
      });
    }
    group.userData.update(0, 0, 0); return group;
  };
})(window.PX);
