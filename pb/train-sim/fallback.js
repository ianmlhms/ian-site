/* Lokféierer: minimal stand-ins so the game still runs when a module is missing or throws.
 * Only used by train-sim.js via TS.fallback.<name>; it installs a stand-in into TS.<name> only if that is absent. */
(function () {
  'use strict';
  const TS = (window.TS = window.TS || {});
  const installed = [];

  const infra = {
    create(scene, track, options) {
      const group = new THREE.Group();
      const railMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96, metalness: 0.6, roughness: 0.4 });
      const platMat = new THREE.MeshStandardMaterial({ color: 0xb9bcc0, roughness: 0.9 });
      const ballast = new THREE.MeshStandardMaterial({ color: 0x6d6a66, roughness: 1 });
      const step = 12, n = Math.ceil(track.length / step);
      const bGeo = new THREE.BoxGeometry(3.2, 0.3, step + 0.2), rGeo = new THREE.BoxGeometry(0.08, 0.16, step + 0.2);
      const mb = new THREE.InstancedMesh(bGeo, ballast, n), mr = new THREE.InstancedMesh(rGeo, railMat, n * 2);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
      for (let i = 0; i < n; i++) {
        const f = track.frameAt(Math.min(track.length, i * step + step / 2));
        q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.tangent.clone().negate()));
        p.copy(f.pos).addScaledVector(f.up, -0.15); m.compose(p, q, one); mb.setMatrixAt(i, m);
        for (const side of [-0.7175, 0.7175]) { p.copy(f.pos).addScaledVector(f.right, side).addScaledVector(f.up, -0.08); m.compose(p, q, one); mr.setMatrixAt(i * 2 + (side > 0 ? 1 : 0), m); }
      }
      group.add(mb, mr);
      const platforms = [];
      (track.stations || []).forEach((st, index) => {
        const len = (st.platformEnd || st.s + 60) - (st.platformStart || st.s - 120), mid = ((st.platformEnd || st.s + 60) + (st.platformStart || st.s - 120)) / 2;
        const f = track.frameAt(mid), sign = st.side === 'left' ? -1 : 1;
        const box = new THREE.Mesh(new THREE.BoxGeometry(4, 0.9, len), platMat);
        box.position.copy(f.pos).addScaledVector(f.right, sign * 3.7); box.position.y = f.pos.y - 0.45 + 0.9 - 0.9 / 2 + 0.45;
        box.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(f.right, f.up, f.tangent.clone().negate()));
        group.add(box); platforms.push({ group: box, stationIndex: index });
      });
      scene.add(group);
      return { update() {}, dispose() { scene.remove(group); }, setSignalAspect() {}, setCrossing() {}, platformHeight: 0.9, stationObjects: platforms };
    },
  };

  const landscape = {
    create(scene, track) {
      const group = new THREE.Group();
      const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
      sun.position.set(80, 120, 40);
      sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
      const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x58603e, 0.9);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x5f7d45, roughness: 1 }));
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.receiveShadow = true;
      group.add(sun, sun.target, hemi, ground);
      scene.add(group); scene.background = new THREE.Color(0x9ec3e6); scene.fog = new THREE.Fog(0x9ec3e6, 400, 3000);
      return {
        sun,
        update(s, camera) { ground.position.x = camera.position.x; ground.position.z = camera.position.z; sun.target.position.copy(camera.position); sun.position.copy(camera.position).add(new THREE.Vector3(80, 120, 40)); },
        setTimeOfDay(h) { const day = h > 6.5 && h < 19.5; hemi.intensity = day ? 0.9 : 0.15; sun.intensity = day ? 2.2 : 0.1; scene.background.set(day ? 0x9ec3e6 : 0x0b1020); },
        setWeather() {}, dispose() { scene.remove(group); },
      };
    },
  };

  const trains = {
    create(cfg) {
      const group = new THREE.Group(), cars = [];
      const len = cfg.carLength || 22, n = cfg.cars || 1;
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color((cfg.livery && cfg.livery.body) || '#a82a26'), roughness: 0.5 });
      for (let i = 0; i < n; i++) {
        const car = new THREE.Group(), body = new THREE.Mesh(new THREE.BoxGeometry(2.9, 3.4, len - 0.6), mat);
        body.position.y = 0.55 + 1.7; body.castShadow = true; car.add(body); group.add(car);
        cars.push({ group: car, length: len, bogieOffset: len * 0.34, doors: [{ side: 'left', zLocal: -len * 0.25, width: 1.3 }, { side: 'left', zLocal: len * 0.25, width: 1.3 }, { side: 'right', zLocal: -len * 0.25, width: 1.3 }, { side: 'right', zLocal: len * 0.25, width: 1.3 }] });
      }
      return { group, cars, totalLength: len * n, setDoors() {}, setLights() {}, setPantograph() {}, setWheelSpin() {}, setWipers() {}, dispose() {} };
    },
  };

  const menu = {
    render(container, o) {
      container.replaceChildren();
      const box = document.createElement('div');
      box.style.cssText = 'max-width:420px;padding:24px';
      const h = document.createElement('h1'); h.textContent = 'Lokféierer';
      const mk = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'display:block;margin:8px 0;padding:12px 18px;font-size:16px'; b.addEventListener('click', fn); return b; };
      box.append(h, mk('Karriär', () => o.onStart('career', o.save.route, o.save.train)), mk('Endlos fueren', () => o.onStart('endless', o.save.route, o.save.train)));
      container.appendChild(box);
    },
  };

  const fallbacks = { infra, landscape, trains, menu };
  for (const name of Object.keys(fallbacks)) {
    if (!TS[name]) { TS[name] = fallbacks[name]; installed.push(name); }
  }
  TS.fallback = Object.assign({}, fallbacks, { installed });
})();
