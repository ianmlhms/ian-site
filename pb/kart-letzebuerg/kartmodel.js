/* Kart Lëtzebuerg — the kart and driver models (low-poly, vertex-coloured, original design). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE;
  let wheelGeo = null, wheelMat = null, hubMat = null, bodyMat = null, shadowMat = null, shadowGeo = null, bubbleGeo = null, bubbleMat = null, nameCache = {};

  function shared() {
    if (wheelGeo) return;
    wheelGeo = new T.CylinderGeometry(0.43, 0.43, 0.4, 12); wheelGeo.rotateZ(Math.PI / 2);
    wheelMat = new T.MeshLambertMaterial({ color: 0x1b1b22 });
    hubMat = new T.MeshLambertMaterial({ color: 0xdddddd });
    bodyMat = new T.MeshLambertMaterial({ vertexColors: true });
    shadowGeo = new T.PlaneGeometry(3.6, 4.6); shadowGeo.rotateX(-Math.PI / 2);
    shadowMat = new T.MeshBasicMaterial({ map: KL.tex.shadow(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    bubbleGeo = new T.SphereGeometry(1.9, 16, 12);
    bubbleMat = new T.MeshBasicMaterial({ color: 0x6ee7b7, transparent: true, opacity: 0.28, blending: T.AdditiveBlending, depthWrite: false });
  }

  KL.buildKartMesh = function buildKartMesh(driver, opts) {
    shared();
    opts = opts || {};
    const root = new T.Group(), tilt = new T.Group();
    root.add(tilt);
    const B = new KL.Batch(), D = new KL.Batch();
    const body = KL.col(driver.body), trim = KL.col(driver.trim), dark = KL.col('#2a2b33'), metal = KL.col('#b9bcc6');
    // chassis
    B.box(0, 0.3, 0.05, 1.5, 0.34, 2.5, 0, body, { topCol: KL.shade(body, 1.2) });
    B.box(0, 0.32, 1.45, 1.0, 0.26, 0.95, 0, body, { topCol: KL.shade(body, 1.2) });
    B.box(0, 0.5, 1.9, 0.7, 0.14, 0.5, 0, trim);                                // nose cap
    B.box(0.93, 0.34, 0.1, 0.34, 0.42, 1.5, 0, trim); B.box(-0.93, 0.34, 0.1, 0.34, 0.42, 1.5, 0, trim);   // side pods
    B.box(0, 0.64, -0.95, 1.0, 0.5, 0.75, 0, dark);                             // engine
    B.box(0, 1.0, -1.05, 1.5, 0.1, 0.5, 0, body, { topCol: KL.shade(body, 1.25) }); // spoiler wing
    B.box(0.62, 0.74, -1.05, 0.1, 0.34, 0.3, 0, trim); B.box(-0.62, 0.74, -1.05, 0.1, 0.34, 0.3, 0, trim);
    B.box(0.3, 0.55, -1.52, 0.2, 0.2, 0.34, 0, metal); B.box(-0.3, 0.55, -1.52, 0.2, 0.2, 0.34, 0, metal);  // exhausts
    B.box(0, 0.62, 0.2, 0.9, 0.5, 0.3, 0, KL.shade(trim, 0.9));                 // seat back
    B.box(0, 0.78, 0.68, 0.34, 0.22, 0.34, 0, dark);                            // steering column
    // driver
    const skin = KL.col('#f4c9a3');
    D.box(0, 0.78, 0.2, 0.62, 0.6, 0.42, 0, trim);
    D.box(0.42, 0.98, 0.45, 0.2, 0.2, 0.5, 0.0, trim); D.box(-0.42, 0.98, 0.45, 0.2, 0.2, 0.5, 0, trim);        // arms
    D.sphere(0, 1.62, 0.18, 0.36, 9, skin, { noise: 1 });
    D.sphere(0, 1.72, 0.14, 0.4, 9, trim, { sy: 0.78 });                                                         // helmet
    D.box(0, 1.55, 0.5, 0.52, 0.16, 0.1, 0, dark);                                                                // visor
    const hs = driver.head;
    if (hs === 'fox' || hs === 'cat') { for (const sx of [-1, 1]) D.cyl(sx * 0.24, 1.9, 0.12, hs === 'fox' ? 0.14 : 0.12, 0.01, hs === 'fox' ? 0.42 : 0.3, 4, body); }
    else if (hs === 'horn') { for (const sx of [-1, 1]) D.cyl(sx * 0.3, 1.9, 0.14, 0.09, 0.01, 0.4, 5, KL.col('#fff2c2')); }
    else D.sphere(0, 2.08, 0.1, 0.11, 5, body);
    const bodyMesh = B.toMesh(bodyMat), driverMesh = D.toMesh(bodyMat);
    tilt.add(bodyMesh);
    const dg = new T.Group(); dg.add(driverMesh); tilt.add(dg);
    // wheels
    const wheels = [];
    for (const [x, z, front] of [[0.86, 1.2, 1], [-0.86, 1.2, 1], [0.9, -1.05, 0], [-0.9, -1.05, 0]]) {
      const holder = new T.Group(); holder.position.set(x, 0.43, z);
      const spin = new T.Mesh(wheelGeo, wheelMat); holder.add(spin);
      const hub = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.42, 6).rotateZ(Math.PI / 2), hubMat); spin.add(hub);
      tilt.add(holder); wheels.push({ holder, spin, front });
      if (!front) { holder.scale.set(1.12, 1.12, 1.12); }
    }
    const shadow = new T.Mesh(shadowGeo, shadowMat); shadow.renderOrder = 2;
    root.userData = { tilt, driver: dg, wheels, bodyMesh, shadow, driverData: driver, bubble: null };
    return root;
  };

  KL.makeBubble = function () { shared(); return new T.Mesh(bubbleGeo, bubbleMat); };
  KL.nameSprite = function (name) {
    if (nameCache[name]) { const c = nameCache[name].clone(); c.material = nameCache[name].material.clone(); return c; }
    const tex = KL.tex.label(name, { w: 256, h: 64, size: 34, fg: '#fff', stroke: 'rgba(0,0,0,.75)' });
    const m = new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false });
    const sp = new T.Sprite(m); sp.scale.set(4.2, 1.05, 1); sp.renderOrder = 10; nameCache[name] = sp; const c = sp.clone(); c.material = m.clone(); return c;
  };
})();
