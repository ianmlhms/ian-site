/* Kart Lëtzebuerg — renderer: scene, sky, lights, weather, track meshes, karts, items, effects and the chase camera (three@0.160 global). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE;
  const { clamp, lerp, damp } = KL;
  const _c = new T.Color();

  const SKY_VS = `varying vec3 vDir; void main(){ vDir=normalize(position); vec4 p=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*p; gl_Position.z=gl_Position.w*0.9999; }`;
  const SKY_FS = `
    varying vec3 vDir; uniform vec3 uZen; uniform vec3 uHor; uniform vec3 uSun; uniform vec3 uSunCol; uniform float uNight;
    void main(){
      float h=clamp(vDir.y,0.0,1.0); float t=pow(h,0.55);
      vec3 col=mix(uHor,uZen,t);
      float sd=max(dot(normalize(vDir),normalize(uSun)),0.0);
      col+=uSunCol*(pow(sd,48.0)*0.9+pow(sd,6.0)*0.25)*(1.0-uNight*0.6);
      col=mix(col,uHor,smoothstep(0.0,-0.25,vDir.y)); gl_FragColor=vec4(pow(col,vec3(0.4545)),1.0);
    }`;

  KL.Renderer = class Renderer {
    constructor(canvas, opts) {
      opts = opts || {};
      this.canvas = canvas; this.quality = opts.quality || 'medium'; this.q = KL.QUALITY[this.quality];
      this.renderer = new T.WebGLRenderer({ canvas, antialias: this.quality !== 'low', powerPreference: 'high-performance', alpha: false });
      this.renderer.setClearColor(0x88aacc);
      KL.maxAniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(62, 1, 0.3, this.q.far);
      this.fog = new T.Fog(0xaaccee, 100, 500); this.scene.fog = this.fog;
      this.hemi = new T.HemisphereLight(0xffffff, 0x888888, 1); this.scene.add(this.hemi);
      this.sun = new T.DirectionalLight(0xffffff, 1.4); this.sun.position.set(-40, 80, 30); this.scene.add(this.sun);
      this.group = new T.Group(); this.scene.add(this.group);       // track scenery
      this.mats = {}; this.kartMeshes = new Map(); this.itemMeshes = new Map(); this.nightAmount = 0; this.animators = [];
      this.weatherName = 'day'; this.time = 0; this.shake = 0;
      this.cam = { x: 0, y: 5, z: 0, yaw: 0, lx: 0, ly: 0, lz: 0, fov: 62, snap: true };
      this.makeSky();
      this.fx = { add: new KL.Particles(420, true), norm: new KL.Particles(420, false) };
      this.scene.add(this.fx.add.points, this.fx.norm.points);
      this.makeRain();
      this.resize();
      this.emitAcc = {};
    }

    /* ----- sky ------------------------------------------------------------------------------------------------------------ */
    makeSky() {
      this.skyMat = new T.ShaderMaterial({ vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, fog: false,
        uniforms: { uZen: { value: new T.Color() }, uHor: { value: new T.Color() }, uSun: { value: new T.Vector3(0, 1, 0) }, uSunCol: { value: new T.Color() }, uNight: { value: 0 } } });
      this.sky = new T.Mesh(new T.SphereGeometry(400, 24, 14), this.skyMat); this.sky.renderOrder = -10; this.sky.frustumCulled = false; this.scene.add(this.sky);
      const sp = [], rnd = KL.rng(4);
      for (let i = 0; i < 360; i++) { const a = rnd() * 6.283, h = 0.08 + rnd() * 0.92, r = Math.sqrt(1 - h * h); sp.push(Math.cos(a) * r * 380, h * 380, Math.sin(a) * r * 380); }
      const sg = new T.BufferGeometry(); sg.setAttribute('position', new T.Float32BufferAttribute(sp, 3));
      this.starMat = new T.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
      this.stars = new T.Points(sg, this.starMat); this.stars.frustumCulled = false; this.scene.add(this.stars);
      this.clouds = new T.Group();
      const cm = new T.SpriteMaterial({ map: KL.tex.cloud(), transparent: true, depthWrite: false, fog: false, opacity: 0.9 }); this.cloudMat = cm;
      for (let i = 0; i < 14; i++) { const s = new T.Sprite(cm); const a = rnd() * 6.283; s.position.set(Math.cos(a) * 340, 60 + rnd() * 70, Math.sin(a) * 340); s.scale.set(150 + rnd() * 110, 60 + rnd() * 30, 1); this.clouds.add(s); }
      this.scene.add(this.clouds);
      this.moon = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0xdfe8ff, transparent: true, depthWrite: false, fog: false, opacity: 0 })); this.moon.scale.set(60, 60, 1); this.scene.add(this.moon);
    }
    makeRain() {
      const n = 520, pos = new Float32Array(n * 6), rnd = KL.rng(12);
      this.rainSeed = []; for (let i = 0; i < n; i++) this.rainSeed.push([(rnd() - 0.5) * 70, rnd() * 30, (rnd() - 0.5) * 70]);
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3));
      this.rainMat = new T.LineBasicMaterial({ color: 0xcfe0f0, transparent: true, opacity: 0.45, depthWrite: false, fog: false });
      this.rain = new T.LineSegments(g, this.rainMat); this.rain.frustumCulled = false; this.rain.visible = false; this.scene.add(this.rain);
    }
    updateRain(dt) {
      if (!this.rain.visible) return;
      const pos = this.rain.geometry.attributes.position.array, cx = this.cam.x, cy = this.cam.y, cz = this.cam.z;
      for (let i = 0; i < this.rainSeed.length; i++) {
        const s = this.rainSeed[i]; s[1] -= dt * 28; if (s[1] < 0) s[1] += 30;
        const x = cx + ((((s[0] + 35) % 70) + 70) % 70) - 35, z = cz + ((((s[2] + 35) % 70) + 70) % 70) - 35, y = cy - 8 + s[1];
        pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z; pos[i * 6 + 3] = x - 0.12; pos[i * 6 + 4] = y + 1.4; pos[i * 6 + 5] = z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    /* ----- materials --------------------------------------------------------------------------------------------------------- */
    makeMaterials(theme) {
      const M = this.mats = {};
      const phong = (map, spec) => new T.MeshPhongMaterial({ map, vertexColors: true, specular: new T.Color(spec || 0x111111), shininess: 10 });
      M.asphalt = phong(KL.tex.asphalt({ centre: theme.centre || 'dash' }), 0x222222);
      M.cobble = phong(KL.tex.cobble(), 0x1a1a1a);
      M.verge = phong(theme.verge === 'grass' ? KL.tex.grass('#6fae4a', '#4d8f3a', '#8ccf5c') : KL.tex.slabs(), 0x151515);
      M.kerb = new T.MeshLambertMaterial({ vertexColors: true, map: KL.tex.kerb() });
      M.wall = new T.MeshLambertMaterial({ vertexColors: true, map: KL.tex.stone() });
      const fa = KL.tex.facade(theme.facade || 'old');
      M.building = new T.MeshLambertMaterial({ vertexColors: true, map: fa.map, emissive: new T.Color(0xffd48a), emissiveMap: fa.emissive, emissiveIntensity: 0 });
      M.roof = new T.MeshLambertMaterial({ vertexColors: true });
      M.plain = new T.MeshLambertMaterial({ vertexColors: true });
      M.plainEmissive = new T.MeshBasicMaterial({ vertexColors: true });
      M.ground = new T.MeshLambertMaterial({ map: theme.ground === 'grass' ? KL.tex.grass(theme.groundColor || '#5e8f3f', '#487432', '#78a851') : KL.tex.slabs(), vertexColors: true });
      M.lampHead = new T.MeshBasicMaterial({ color: 0xfff2b0 });
      M.checker = new T.MeshBasicMaterial({ map: KL.tex.checker(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      M.pads = new T.MeshBasicMaterial({ map: KL.tex.chevrons(), vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      M.glowAdd = new T.MeshBasicMaterial({ map: KL.tex.glow(), color: 0xffe3a0, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      this.lights = [];     // emissive things that follow the night amount
    }

    clearTrack() {
      this.animators = []; this.lampHeads = null; this.lampPools = null; this.glowPoints = [];
      while (this.group.children.length) { const o = this.group.children.pop(); o.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); }
      for (const [, m] of this.kartMeshes) this.scene.remove(m.root);
      this.kartMeshes.clear();
      for (const [, m] of this.itemMeshes) this.scene.remove(m);
      this.itemMeshes.clear();
      if (this.boxMesh) { this.scene.remove(this.boxMesh); this.boxMesh = null; }
    }

    /* ----- track ----------------------------------------------------------------------------------------------------------------- */
    loadTrack(track, race) {
      this.clearTrack();
      const def = track.def, theme = def.theme || {};
      this.track = track; this.theme = theme;
      this.makeMaterials(theme);
      const M = this.mats, rnd = KL.rng(KL.hashStr(def.id));
      const add = (batch, mat, o) => { if (!batch || !batch.count) return null; const m = batch.toMesh(mat); m.matrixAutoUpdate = false; m.updateMatrix(); if (o && o.name) m.name = o.name; this.group.add(m); return m; };
      this.add = add;
      const road = KL.scenery.road(track, theme);
      add(road.asphalt, M.asphalt); add(road.cobble, M.cobble);
      const sides = KL.scenery.sides(track, theme);
      add(sides.verge, M.verge); add(sides.kerb, M.kerb); add(sides.wall, M.wall);
      const dec = KL.scenery.decals(track, def.pads ? race.pads : []);
      add(dec.pads, M.pads); add(dec.checker, M.checker);
      this.buildGround(track, theme);
      const cityData = theme.osm && KL.osm && KL.osm[theme.osm];
      if (cityData) this.buildCity(track, theme, cityData, rnd);
      else if (theme.buildings !== false) {
        const b = KL.scenery.buildings(track, theme, rnd, this.q);
        add(b.walls, M.building); add(b.roofs, M.roof); add(b.extra, M.plain);
      }
      this.buildLamps(track, theme, rnd);
      this.buildSkyline(track, theme, rnd);
      const S = { THREE: T, KL, track, def, theme, rnd, mats: M, add, group: this.group, quality: this.q, renderer: this, race };
      if (def.decorate) def.decorate(S);
      this.buildStartLine(track);
      // item boxes
      const boxGeo = new T.BoxGeometry(1.7, 1.7, 1.7);
      this.boxMesh = new T.InstancedMesh(boxGeo, new T.MeshBasicMaterial({ map: KL.tex.itemBox(), transparent: true, opacity: 0.92 }), Math.max(1, race.boxes.length));
      this.boxMesh.frustumCulled = false; this.scene.add(this.boxMesh);
      this.setWeather(this.weatherName, true);
    }

    /* real street fabric from baked OSM footprints (city.js) */
    buildCity(track, theme, data, rnd) {
      const terr = track.terrain || track.def.terrain || (() => 0), M = this.mats, add = this.add;
      const city = KL.scenery.osmCity(track, theme, data, rnd, terr, this.q);
      this.city = city;
      KL.scenery.osmTrees(track, theme, data, city, rnd, terr, this.q, theme.treeKeepClear);
      if (theme.boulevardTrees) KL.scenery.boulevardTrees(track, theme, data, city, rnd, terr, this.q);
      for (const c of city.chunks.values()) { add(c.walls, M.building); add(c.roofs, M.roof); add(c.extra, M.plain); add(c.found, M.wall); add(c.trees, M.plain); }
      this.cityCount = city.count;
    }

    buildGround(track, theme) {
      const B = new KL.Batch(), terr = track.terrain || track.def.terrain || (() => 0);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (let i = 0; i < track.N; i++) { x0 = Math.min(x0, track.X[i]); x1 = Math.max(x1, track.X[i]); z0 = Math.min(z0, track.Z[i]); z1 = Math.max(z1, track.Z[i]); }
      const fine = theme.groundCell || 16, coarse = fine * 4, inner = 150, outer = 640;
      const gy = theme.groundY != null ? theme.groundY : -0.15;
      const base = KL.col(theme.groundTint || '#ffffff');
      const H = (x, z) => gy + terr(x, z);
      const col = (x, z) => (theme.groundColorAt ? theme.groundColorAt(x, z, terr(x, z)) : base);
      const gm = theme.osm && KL.osm && KL.osm[theme.osm] && theme.groundMap;
      if (gm) { const t = KL.tex.cityMap(KL.osm[theme.osm], { x0: gm.x0, z0: gm.z0, size: gm.size, px: this.q.mapPx || 2048, paving: gm.paving, paint: gm.paint }); this.mats.ground.map = t; this.mats.ground.needsUpdate = true; }
      const uv = gm ? (x, z) => [(x - gm.x0) / gm.size, 1 - (z - gm.z0) / gm.size] : (x, z) => [x / 8, z / 8];
      const quad = (xa, za, xb, zb) => {
        const A = [xa, H(xa, za), za], Bq = [xb, H(xb, za), za], C = [xb, H(xb, zb), zb], D = [xa, H(xa, zb), zb];
        B.quadUV(A, D, C, Bq, col((xa + xb) / 2, (za + zb) / 2), uv(xa, za), uv(xa, zb), uv(xb, zb), uv(xb, za));
      };
      const ix0 = Math.floor((x0 - inner) / coarse) * coarse, iz0 = Math.floor((z0 - inner) / coarse) * coarse, ix1 = Math.ceil((x1 + inner) / coarse) * coarse, iz1 = Math.ceil((z1 + inner) / coarse) * coarse;
      for (let x = ix0; x < ix1; x += fine) for (let z = iz0; z < iz1; z += fine) quad(x, z, x + fine, z + fine);
      const ox0 = ix0 - outer, oz0 = iz0 - outer, ox1 = ix1 + outer, oz1 = iz1 + outer;
      for (let x = ox0; x < ox1; x += coarse) for (let z = oz0; z < oz1; z += coarse) { if (x >= ix0 && x + coarse <= ix1 && z >= iz0 && z + coarse <= iz1) continue; quad(x, z, x + coarse, z + coarse); }
      const m = B.toMesh(this.mats.ground); m.matrixAutoUpdate = false; this.group.add(m);
      // endless plane far beyond the grid (below the lowest terrain so valleys stay visible)
      const lowest = theme.farDrop != null ? theme.farDrop : 0;
      const far = new T.Mesh(new T.PlaneGeometry(9000, 9000), new T.MeshBasicMaterial({ color: 0xffffff })); far.rotation.x = -Math.PI / 2; far.position.set((x0 + x1) / 2, gy - 0.3 + lowest, (z0 + z1) / 2);
      this.farPlane = far; this.farPlane.material.color.set(theme.farColor || '#9a9690'); this.group.add(far);
    }

    buildLamps(track, theme, rnd) {
      if (theme.lamps === false) return;
      const lamp = KL.scenery.lamp();
      const spacing = theme.lampSpacing || 30;
      const poles2 = new KL.Batch(), heads2 = new KL.Batch(), pools2 = new KL.Batch();
      let k = 0;
      for (let s = 8; s < track.length; s += spacing) {
        const ci = Math.floor(s / track.step) % track.N;
        if (track.ZONE[ci] >= 0 && track.zones[track.ZONE[ci]].noLamps) continue;
        const sides = theme.lampBothSides ? [-1, 1] : [(k++ % 2) ? -1 : 1];
        for (const sdx of sides) {
          const lim = track.HW[ci] + (sdx < 0 ? track.WL[ci] : track.WR[ci]) - 0.4;
          const p = track.at(s, sdx * lim);
          // local +x of the lamp model must point to the road: world direction = (-right * sdx) = (tz*sdx, ... ) ; yaw such that (cos yaw, -sin yaw) = dir
          const dx = p.tz * sdx, dz = -p.tx * sdx;       // -right*sdx where right = (-tz, tx)
          const yaw = Math.atan2(-dz, dx);
          poles2.addBatch(lamp.pole, p.x, p.y + 0.14, p.z, yaw); heads2.addBatch(lamp.head, p.x, p.y + 0.14, p.z, yaw);
          const q = track.at(s, sdx * (lim - 2.6));
          const r = 6.5, y0 = q.y + 0.07;
          pools2.quadUV([q.x - r, y0, q.z - r], [q.x - r, y0, q.z + r], [q.x + r, y0, q.z + r], [q.x + r, y0, q.z - r], [1, 0.9, 0.62], [0, 0], [0, 1], [1, 1], [1, 0]);
        }
      }
      this.add(poles2, this.mats.plain); this.lampHeads = this.add(heads2, this.mats.lampHead);
      const pm = this.add(pools2, new T.MeshBasicMaterial({ map: KL.tex.glow(), vertexColors: true, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      this.lampPools = pm;
    }

    buildSkyline(track, theme, rnd) {
      if (theme.skyline === false) return;
      const B = new KL.Batch(), cx = (Math.min(...track.X) + Math.max(...track.X)) / 2, cz = (Math.min(...track.Z) + Math.max(...track.Z)) / 2;
      const base = KL.col(theme.skylineColor || '#aab3c6');
      const n = theme.skylineCount || 90;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + rnd() * 0.05, r = (theme.skylineR || 520) + rnd() * 260;
        const w = 20 + rnd() * 40, h = (theme.skylineH ? theme.skylineH[0] + rnd() * (theme.skylineH[1] - theme.skylineH[0]) : 25 + rnd() * 50);
        B.box(cx + Math.cos(a) * r, -3, cz + Math.sin(a) * r, w, h + 3, w * (0.7 + rnd() * 0.6), rnd() * 3, KL.shade(base, 0.8 + rnd() * 0.3));
      }
      this.skylineMesh = this.add(B, this.mats.plain);
    }

    buildStartLine(track) {
      // gantry over the line
      const B = new KL.Batch(), p = track.at(0, 0), hw = p.hw + 1.2;
      const fx = p.tx, fz = p.tz, rx = -p.tz, rz = p.tx, yaw = Math.atan2(p.tx, p.tz);
      const post = (side) => B.box(p.x + rx * side * hw, p.y, p.z + rz * side * hw, 0.7, 7.2, 0.7, yaw, KL.col('#d9323c'));
      post(-1); post(1);
      B.box(p.x, p.y + 6.4, p.z, hw * 2 + 0.8, 1.7, 0.9, yaw, KL.col('#d9323c'), { topCol: KL.col('#ff5a5f') });
      this.add(B, this.mats.plain);
      const lbl = new T.Mesh(new T.PlaneGeometry(hw * 2 - 1, 1.35), new T.MeshBasicMaterial({ map: KL.tex.label(this.theme.startText || 'KART LËTZEBUERG', { w: 1024, h: 140, size: this.theme.startText && this.theme.startText.length > 18 ? 62 : 92, fg: '#fff', bg: '#c6212b' }), side: T.DoubleSide }));
      lbl.position.set(p.x - fx * 0.5, p.y + 6.4, p.z - fz * 0.5); lbl.rotation.y = yaw + Math.PI; this.group.add(lbl);
      const lbl2 = lbl.clone(); lbl2.position.set(p.x + fx * 0.5, p.y + 6.4, p.z + fz * 0.5); lbl2.rotation.y = yaw; this.group.add(lbl2);
    }

    /* ----- weather & time of day ------------------------------------------------------------------------------------------------- */
    setWeather(name, force) {
      const W = KL.WEATHER[name] || KL.WEATHER.day;
      if (!force && name === this.weatherName && this.weatherSet) return;
      this.weatherName = name; this.weatherSet = true; this.W = W;
      const night = W.night, th = this.theme || {};
      const tint = th.weatherTint && th.weatherTint[name];
      _c.set(tint && tint.fog || W.fog); this.fog.color.copy(_c); this.renderer.setClearColor(_c);
      this.fog.near = W.fogNear * (th.fogScale || 1); this.fog.far = Math.min(W.fogFar, this.q.far) * (th.fogScale || 1);
      const hm = tint && tint.hemi ? tint.hemi : W.hemi;
      this.hemi.color.set(hm[0]); this.hemi.groundColor.set(hm[1]); this.hemi.intensity = hm[2] * 2.0 * (th.ambient || 1);
      this.sun.color.set(W.sun[0]); this.sun.intensity = W.sun[1] * 1.7 * (th.sunBoost || 1); this.sunDir = new T.Vector3(...W.sun[2]).normalize();
      this.skyMat.uniforms.uZen.value.set(tint && tint.sky ? tint.sky[0] : W.sky[0]); this.skyMat.uniforms.uHor.value.set(tint && tint.sky ? tint.sky[1] : W.sky[1]);
      this.skyMat.uniforms.uSun.value.copy(this.sunDir); this.skyMat.uniforms.uSunCol.value.set(W.sun[0]); this.skyMat.uniforms.uNight.value = night;
      this.starMat.opacity = clamp((night - 0.5) * 2, 0, 1); this.moon.material.opacity = clamp((night - 0.6) * 2.2, 0, 0.9);
      this.cloudMat.opacity = night > 0.5 ? 0.12 : 0.88; this.cloudMat.color.set(name === 'rain' || name === 'fog' ? '#b5bcc4' : name === 'sunset' ? '#ffc9a8' : '#ffffff');
      this.nightAmount = night;
      const wet = W.wet, M = this.mats;
      if (M.asphalt) {
        for (const m of [M.asphalt, M.cobble, M.verge]) { m.shininess = 10 + wet * 70; m.specular.setScalar(0.07 + wet * 0.5); m.color.setScalar(1 - wet * 0.32); }
        M.building.emissiveIntensity = clamp((night - 0.2) * 1.3, 0, 1.1);
        if (this.lampHeads) this.lampHeads.material.color.set(night > 0.45 ? 0xffefb0 : 0x9a9588);
        if (this.lampPools) this.lampPools.material.opacity = clamp((night - 0.3) * 1.2, 0, 0.55);
        M.ground.color.setScalar(1 - wet * 0.15);
      }
      if (th.onWeather) th.onWeather(this, name, W);
      this.rain.visible = !!W.rain;
      for (const g of this.glowPoints || []) g.material.opacity = clamp((night + (name === 'fog' ? 0.5 : 0)) * 0.9, 0.15, 1);
      this.rainMat.opacity = 0.35 + (name === 'night' ? 0.1 : 0);
      if (this.sunDir) this.sun.position.copy(this.sunDir).multiplyScalar(120);
      this.moon.position.set(-this.sunDir.x * 300 * 0 + 120, 240, -250);
    }

    setQuality(name) {
      this.quality = name; this.q = KL.QUALITY[name] || KL.QUALITY.medium;
      this.camera.far = this.q.far; this.camera.updateProjectionMatrix();
      this.resize();
    }

    resize() {
      const c = this.canvas, w = c.clientWidth || c.parentElement.clientWidth || 800, h = c.clientHeight || c.parentElement.clientHeight || 600;
      const dpr = Math.min(window.devicePixelRatio || 1, this.q.dpr) * (this.dprScale || 1);
      this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      this.w = w; this.h = h;
    }

    /* ----- karts / items ------------------------------------------------------------------------------------------------------------ */
    ensureKarts(R) {
      for (const k of R.karts) {
        if (this.kartMeshes.has(k.id)) continue;
        const root = KL.buildKartMesh(k.driver);
        const shadow = root.userData.shadow; this.scene.add(shadow);
        const name = KL.nameSprite(k.name); name.position.set(0, 3.4, 0); root.add(name); root.userData.name = name;
        const bubble = KL.makeBubble(); bubble.position.y = 0.9; bubble.visible = false; root.add(bubble); root.userData.bubble = bubble;
        const head = new T.Mesh(new T.PlaneGeometry(5.2, 10), new T.MeshBasicMaterial({ map: KL.tex.glow(), color: 0xfff0c0, transparent: true, opacity: 0, blending: T.AdditiveBlending, depthWrite: false, fog: false }));
        head.rotation.x = -Math.PI / 2; head.position.set(0, 0.25, 7); head.renderOrder = 3; root.add(head); root.userData.head = head;
        this.scene.add(root);
        this.kartMeshes.set(k.id, { root, prev: null });
        name.visible = false; name.material.opacity = 0;
      }
    }

    syncRace(R, alpha, dt, focusId) {
      this.ensureKarts(R); this.raceRef = R;
      const t = this.time;
      for (const k of R.karts) {
        const m = this.kartMeshes.get(k.id), root = m.root, u = root.userData;
        let x = k.x, y = k.y, z = k.z, yaw = k.yaw;
        if (k.px != null && !k.teleported) { x = lerp(k.px, k.x, alpha); y = lerp(k.py, k.y, alpha); z = lerp(k.pz, k.z, alpha); let dy = k.yaw - k.pyaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); yaw = k.pyaw + dy * alpha; }
        k.ix = x; k.iy = y; k.iz = z; k.iyaw = yaw;
        const hopy = k.hopY > 0 ? Math.sin(Math.min(1, k.hopY) * Math.PI) * 0.35 : 0;
        const air = k.grounded ? 0 : 0;
        root.position.set(x, y + hopy, z);
        root.rotation.y = yaw + k.spinVis;
        const flicker = k.invuln > 0 && k.spinT <= 0 && k.frozenT > 0 ? ((Math.floor(t * 18) % 2) ? 0.25 : 1) : 1;
        root.visible = flicker > 0.3;
        // lean into the turn / drift, pitch on boost
        const lean = (-k.steer * 0.07) + (k.drift.state === 2 ? -k.drift.dir * 0.16 : 0);
        u.tilt.rotation.z = damp(u.tilt.rotation.z, lean, 12, dt);
        u.tilt.rotation.x = damp(u.tilt.rotation.x, k.boostT > 0 ? -0.07 : (k.grounded ? 0 : clamp(-k.vy * 0.02, -0.25, 0.25)), 8, dt);
        u.driver.rotation.y = damp(u.driver.rotation.y, k.steer * 0.35 + (k.drift.state === 2 ? k.drift.dir * 0.3 : 0), 10, dt);
        u.driver.rotation.z = damp(u.driver.rotation.z, k.steer * 0.12, 10, dt);
        for (const w of u.wheels) { w.spin.rotation.x = k.wheelSpin / 0.43; if (w.front) w.holder.rotation.y = -k.steer * 0.5 - (k.drift.state === 2 ? k.drift.dir * 0.25 : 0); }
        const sh = u.shadow; sh.position.set(x, y + 0.04, z); sh.rotation.y = yaw; sh.visible = root.visible; sh.material.opacity = 1;
        u.bubble.visible = k.shieldT > 0 && (k.shieldT > 2 || Math.floor(t * 8) % 2 === 0);
        if (u.bubble.visible) u.bubble.scale.setScalar(1 + Math.sin(t * 6) * 0.03);
        u.head.material.opacity = this.nightAmount > 0.25 ? 0.5 * this.nightAmount : 0;
        k.teleported = false;
        this.emitKartFx(k, m, dt, x, y, z, yaw);
      }
      // item boxes
      const bm = this.boxMesh, dummy = this._dummy || (this._dummy = new T.Object3D());
      R.boxes.forEach((b, i) => {
        dummy.position.set(b.x, b.y + Math.sin(t * 2 + i) * 0.18, b.z); dummy.rotation.set(t * 0.8 + i, t * 1.1 + i * 0.5, 0);
        dummy.scale.setScalar(b.active ? 1 : clamp(1 - b.respawn / 0.0001, 0, 0.001));
        if (!b.active && b.respawn < 0.6) dummy.scale.setScalar(clamp(1 - b.respawn / 0.6, 0, 1) * 0.0 + (0.6 - b.respawn) / 0.6 * 0.9);
        dummy.updateMatrix(); bm.setMatrixAt(i, dummy.matrix);
      });
      bm.instanceMatrix.needsUpdate = true;
      // projectiles and traps
      const seen = new Set();
      for (const it of R.items) {
        seen.add(it);
        let mesh = this.itemMeshes.get(it);
        if (!mesh) { mesh = this.makeItemMesh(it); this.itemMeshes.set(it, mesh); this.scene.add(mesh); }
        this.syncItem(it, mesh, t, dt, R);
      }
      for (const [it, mesh] of this.itemMeshes) if (!seen.has(it)) { this.scene.remove(mesh); mesh.traverse((c) => { if (c.geometry && c.userData.own) c.geometry.dispose(); }); this.itemMeshes.delete(it); }
    }

    makeItemMesh(it) {
      const g = new T.Group();
      if (it.type === 'oil') {
        const m = new T.Mesh(new T.PlaneGeometry(5.2, 5.2), new T.MeshBasicMaterial({ map: KL.tex.oil(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
        m.rotation.x = -Math.PI / 2; m.rotation.z = Math.random() * 6; g.add(m);
      } else if (it.type === 'orb') {
        g.add(new T.Mesh(new T.SphereGeometry(0.75, 14, 10), new T.MeshBasicMaterial({ color: 0x55d6ff })));
        const ring = new T.Mesh(new T.TorusGeometry(1.05, 0.09, 6, 18), new T.MeshBasicMaterial({ color: 0xffffff })); ring.userData.spin = 1; g.add(ring);
        const glow = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0x55d6ff, blending: T.AdditiveBlending, transparent: true, depthWrite: false })); glow.scale.set(3.6, 3.6, 1); g.add(glow);
      } else if (it.type === 'rocket') {
        const B = new KL.Batch();
        B.cyl(0, -0.9, 0, 0.42, 0.42, 1.8, 8, KL.col('#e9e9ef'), {});
        B.cyl(0, 0.9, 0, 0.42, 0.02, 0.9, 8, KL.col('#e5392b'));
        for (let a = 0; a < 3; a++) { const an = a * 2.094; B.box(Math.cos(an) * 0.55, -1.0, Math.sin(an) * 0.55, 0.12, 0.7, 0.5, -an, KL.col('#e5392b')); }
        const m = B.toMesh(new T.MeshLambertMaterial({ vertexColors: true })); m.rotation.x = Math.PI / 2; m.userData.own = true; const holder = new T.Group(); holder.add(m); g.add(holder);
        const fl = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0xffa040, blending: T.AdditiveBlending, transparent: true, depthWrite: false })); fl.scale.set(2.6, 2.6, 1); fl.position.set(0, 0, -1.4); g.add(fl);
      } else if (it.type === 'comet') {
        const core = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0xe0a8ff, blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false })); core.scale.set(16, 16, 1); g.add(core);
        const core2 = new T.Sprite(new T.SpriteMaterial({ map: KL.tex.glow(), color: 0xffffff, blending: T.AdditiveBlending, transparent: true, depthWrite: false, fog: false })); core2.scale.set(7, 7, 1); g.add(core2);
        const mark = new T.Mesh(new T.RingGeometry(3, 4.2, 28), new T.MeshBasicMaterial({ color: 0xc77dff, transparent: true, opacity: 0.8, side: T.DoubleSide, depthWrite: false })); mark.rotation.x = -Math.PI / 2; mark.userData.mark = true; g.add(mark);
      }
      return g;
    }

    syncItem(it, mesh, t, dt, R) {
      if (it.type === 'oil') { mesh.position.set(it.x, it.y + 0.09, it.z); }
      else if (it.type === 'orb') { mesh.position.set(it.x, it.y, it.z); mesh.children[1].rotation.x += dt * 8; mesh.children[1].rotation.y += dt * 5; if (Math.random() < 0.7) this.fx.add.spawn(it.x, it.y, it.z, 0, 0.3, 0, 0.3, 1.5, 0.2, 0.3, 0.8, 1, 0.8, 1, 0); }
      else if (it.type === 'rocket') { mesh.position.set(it.x, it.y, it.z); mesh.rotation.y = it.yaw; this.fx.add.spawn(it.x - Math.sin(it.yaw) * 1.5, it.y, it.z - Math.cos(it.yaw) * 1.5, 0, 0.5, 0, 0.45, 1.8, 0.3, 1, 0.55, 0.2, 0.9, 1, 0); if (Math.random() < 0.5) this.fx.norm.spawn(it.x - Math.sin(it.yaw) * 2, it.y, it.z - Math.cos(it.yaw) * 2, 0, 0.6, 0, 0.8, 0.8, 2.4, 0.6, 0.6, 0.6, 0.35, 1, 0); }
      else if (it.type === 'comet') {
        const tg = it.target != null ? R.byId[it.target] : null;
        mesh.position.set(it.x || 0, (it.ty || 0) + it.y, it.z || 0);
        const mark = mesh.children[2]; if (tg) { mark.position.set(tg.x - mesh.position.x, tg.y + 0.15 - mesh.position.y, tg.z - mesh.position.z); mark.rotation.z += dt * 2; mark.scale.setScalar(1 + Math.sin(t * 8) * 0.12); }
        if (Math.random() < 0.9) this.fx.add.spawn(mesh.position.x, mesh.position.y, mesh.position.z, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, 0.9, 5, 0.5, 0.8, 0.5, 1, 0.8, 1, 0);
      }
    }

    emitKartFx(k, m, dt, x, y, z, yaw) {
      const q = this.q.particles;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz, rz = fx;
      const acc = (this.emitAcc[k.id] = (this.emitAcc[k.id] || 0) + dt);
      if (acc < 0.03 / Math.max(0.3, q)) return;
      this.emitAcc[k.id] = 0;
      const sp = k.speed;
      // drift sparks
      if (k.drift.state === 2 && k.grounded) {
        const lv = k.drift.level, col = lv === 0 ? [1, 0.95, 0.7] : lv === 1 ? [0.3, 0.6, 1] : lv === 2 ? [1, 0.6, 0.15] : [1, 0.3, 0.95];
        for (const sd of [-1, 1]) {
          const px = x - fx * 1.2 + rx * sd * 0.95, pz = z - fz * 1.2 + rz * sd * 0.95;
          this.fx.add.spawn(px, y + 0.2, pz, (Math.random() - 0.5) * 5 - fx * 2, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 5 - fz * 2, 0.3, 0.3, 0.05, col[0], col[1], col[2], 0.85, 1.5, 9);
        }
        if (Math.random() < 0.4) this.fx.norm.spawn(x - fx * 1.4, y + 0.3, z - fz * 1.4, (Math.random() - 0.5) * 2, 0.8, (Math.random() - 0.5) * 2, 0.7, 0.9, 2.0, 0.78, 0.78, 0.78, 0.25, 2, 0);
      }
      // boost flames
      if (k.boostT > 0) {
        const kind = k.boostKind;
        const col = kind === 3 ? [1, 0.35, 0.95] : kind === 2 ? [1, 0.55, 0.15] : [0.35, 0.75, 1];
        for (const sd of [-0.3, 0.3]) this.fx.add.spawn(x - fx * 1.7 + rx * sd, y + 0.6, z - fz * 1.7 + rz * sd, -fx * 7 + (Math.random() - 0.5), 0.2, -fz * 7 + (Math.random() - 0.5), 0.26, 0.36, 0.05, col[0] * 0.8, col[1] * 0.8, col[2] * 0.8, 0.5, 1, 0);
      }
      // dust / grass when off the road, rain spray
      if (k.surf === 1 && sp > 6 && k.grounded) this.fx.norm.spawn(x - fx * 1.3 + (Math.random() - 0.5) * 1.5, y + 0.2, z - fz * 1.3 + (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 3, 1.4, (Math.random() - 0.5) * 3, 0.6, 0.9, 2.2, 0.55, 0.5, 0.4, 0.35, 2, 0);
      else if (this.W && this.W.wet > 0.5 && sp > 12 && k.grounded) this.fx.norm.spawn(x - fx * 1.5, y + 0.3, z - fz * 1.5, (Math.random() - 0.5) * 2, 0.9, (Math.random() - 0.5) * 2, 0.5, 0.8, 1.8, 0.8, 0.85, 0.9, 0.2, 2, 0);
      if (k.spinT > 0 && Math.random() < 0.7) this.fx.add.spawn(x + (Math.random() - 0.5) * 2, y + 2.2, z + (Math.random() - 0.5) * 2, 0, 2, 0, 0.5, 0.8, 0.25, 1, 0.9, 0.3, 1, 1, 0);
    }

    burst(x, y, z, kind) {
      const n = Math.round((kind === 'comet' ? 70 : 34) * Math.max(0.5, this.q.particles));
      for (let i = 0; i < n; i++) {
        const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), v = (6 + Math.random() * 12) * (kind === 'comet' ? 1.5 : 1);
        const col = kind === 'comet' ? [0.8, 0.5, 1] : kind === 'orb' ? [0.4, 0.85, 1] : [1, 0.6 + Math.random() * 0.3, 0.2];
        this.fx.add.spawn(x, y + 0.8, z, Math.cos(a) * r * v, Math.abs(u) * v * 0.8 + 2, Math.sin(a) * r * v, 0.55 + Math.random() * 0.4, 1.3, 0.2, col[0], col[1], col[2], 1, 2.2, 9);
      }
      for (let i = 0; i < 10; i++) this.fx.norm.spawn(x + (Math.random() - 0.5) * 2, y + 1, z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4, 2 + Math.random() * 3, (Math.random() - 0.5) * 4, 1.1, 2, 6, 0.3, 0.3, 0.34, 0.5, 1.5, 0);
      this.shake = Math.max(this.shake, kind === 'comet' ? 0.7 : 0.3);
    }
    confetti(x, y, z) {
      for (let i = 0; i < 46; i++) { const c = [[1, 0.3, 0.4], [0.3, 0.8, 1], [1, 0.85, 0.2], [0.5, 1, 0.5], [0.9, 0.5, 1]][i % 5]; this.fx.norm.spawn(x + (Math.random() - 0.5) * 6, y + 5 + Math.random() * 3, z + (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 8, 4 + Math.random() * 5, (Math.random() - 0.5) * 8, 2.4, 0.4, 0.3, c[0], c[1], c[2], 1, 0.6, 10); }
    }
    snapKarts() { for (const [, m] of this.kartMeshes) m.snap = true; }

    /* ----- chase camera ------------------------------------------------------------------------------------------------------------ */
    updateCamera(k, dt, opts) {
      opts = opts || {};
      const c = this.cam;
      const sp = k ? k.speed : 0;
      if (!k) return;
      const heading = k.yaw;
      // follow the heading, but a little towards the travel direction so drifts stay readable
      let want = heading;
      if (sp > 4) { const va = Math.atan2(k.vx, k.vz); let d = va - heading; d = Math.atan2(Math.sin(d), Math.cos(d)); want = heading + clamp(d, -0.6, 0.6) * 0.4; }
      if (opts.rear) want += Math.PI;
      let d = want - c.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      c.yaw += d * (c.snap ? 1 : 1 - Math.exp(-(k.drift.state === 2 ? 3.2 : 6) * dt));
      const dist = (opts.far || 7.4) + sp * 0.035 + (k.boostT > 0 ? 0.9 : 0), hgt = (opts.high || 3.15) + sp * 0.012;
      const tx = k.x - Math.sin(c.yaw) * dist, tz = k.z - Math.cos(c.yaw) * dist, ty = k.y + hgt;
      const f = c.snap ? 1 : 1 - Math.exp(-14 * dt);
      c.x = lerp(c.x, tx, f); c.z = lerp(c.z, tz, f); c.y = lerp(c.y, ty, c.snap ? 1 : 1 - Math.exp(-9 * dt));
      const lookAhead = 5.5;
      const lx = k.x + Math.sin(c.yaw) * lookAhead, lz = k.z + Math.cos(c.yaw) * lookAhead, ly = k.y + 1.5;
      c.lx = lerp(c.lx, lx, f); c.ly = lerp(c.ly, ly, f); c.lz = lerp(c.lz, lz, f);
      const fovT = 60 + clamp(sp / 41, 0, 1.2) * 14 + (k.boostT > 0 ? 9 : 0);
      c.fov = damp(c.fov, fovT, 4, dt);
      c.snap = false;
      this.shake = Math.max(0, this.shake - dt * 1.8);
      const sh = this.shake, rs = () => (Math.random() - 0.5) * sh * 0.8;
      this.camera.position.set(c.x + rs(), c.y + rs(), c.z + rs());
      this.camera.lookAt(c.lx, c.ly, c.lz);
      if (Math.abs(this.camera.fov - c.fov) > 0.05) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
      // wrong-way / roll
      this.camera.rotation.z += (k.drift.state === 2 ? -k.drift.dir * 0.035 : 0);
      c.px = this.camera.position.x; c.py = this.camera.position.y; c.pz = this.camera.position.z;
    }

    /* name labels: only a few, never overlapping; the rivals right ahead/behind the player come first, then the nearest ones */
    updateLabels(dt) {
      const R = this.raceRef; if (!R) return;
      const cam = this.camera, H = this._lblV || (this._lblV = new T.Vector3()), fovT = Math.tan((cam.fov * Math.PI) / 360), asp = cam.aspect || 1.5;
      cam.updateMatrixWorld();
      const hu = R.karts.find((k) => k.human), hp = hu ? hu.place : 0, list = [];
      for (const k of R.karts) {
        if (k.human) continue;
        const m = this.kartMeshes.get(k.id); if (!m) continue;
        const u = m.root.userData, dd = Math.hypot(k.ix - cam.position.x, k.iz - cam.position.z);
        H.set(k.ix, k.iy + 3.4, k.iz).project(cam);
        const sc = clamp(dd * 0.05, 1.2, 3.4), w = 4.2 * sc * 0.5, h = 1.05 * sc * 0.5, viewH = 2 * dd * fovT;
        const ok = H.z < 1 && dd > 7 && dd < 85 && Math.abs(H.x) < 1.1 && Math.abs(H.y) < 1.1;
        u.name.scale.set(w, h, 1);
        list.push({ u, k, dd, ok, nx: H.x, ny: H.y, nw: (w / (viewH * asp)) * 2, nh: (h / viewH) * 2, pri: Math.abs(k.place - hp) === 1 ? dd - 60 : dd });
      }
      list.sort((a, b) => a.pri - b.pri);
      const taken = []; let n = 0;
      for (const c of list) {
        let show = c.ok && n < 4;
        if (show) for (const t of taken) if (Math.abs(c.nx - t.nx) < (c.nw + t.nw) * 0.55 && Math.abs(c.ny - t.ny) < (c.nh + t.nh) * 0.75) { show = false; break; }
        if (show) { taken.push(c); n++; }
        const target = show ? clamp((85 - c.dd) / 30, 0, 1) : 0, mat = c.u.name.material;
        mat.opacity = lerp(mat.opacity, target, 1 - Math.exp(-10 * (dt || 0.016))); c.u.name.visible = mat.opacity > 0.03;
      }
    }

    render(dt) {
      this.time += dt;
      this.updateLabels(dt);
      const sc = this.h * this.renderer.getPixelRatio() / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
      this.fx.add.update(dt, sc); this.fx.norm.update(dt, sc);
      const cp = this.camera.position;
      this.sky.position.copy(cp); this.stars.position.copy(cp); this.clouds.position.set(cp.x, 0, cp.z); this.moon.position.set(cp.x + 120, 240, cp.z - 250);
      for (const a of this.animators) a(dt, this.time);
      this.updateRain(dt);
      this.renderer.render(this.scene, this.camera);
    }
  };
})();
