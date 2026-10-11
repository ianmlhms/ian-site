/* Six neighbourhoods, metre-scaled masonry, merged district cells and close-range street furniture. */
(function (P) {
  'use strict';
  const T = THREE;
  P.edge = 294; P.roads = [-252, -168, -84, 0, 84, 168, 252];
  P.districts = [
    { name: 'Alstad', x: -126, z: -126, color: '#d9b895' },
    { name: 'Garer Quartier', x: -126, z: 110, color: '#caba98' },
    { name: 'Kirchberg', x: 126, z: -126, color: '#97babc' },
    { name: 'Belair', x: 126, z: 110, color: '#b7c79c' },
    { name: 'Ateliers', x: -165, z: 260, color: '#b7ada0' },
    { name: 'Parc de la Pétrusse', x: 150, z: 260, color: '#8fab88' },
  ];
  P.streetNames = ['Rue des Tilleuls', 'Avenue de la Gare', 'Rue du Marché', 'Groussgaass', 'Boulevard Royal', 'Avenue J. F. Kennedy', 'Bréckewee'];
  P.places = [];
  const labels = ['Post', 'Bäckerei Hoffmann', 'Apdikt', 'Bibliothéik', 'Café de la Place', 'Kirchberg Offices', 'Hotel Bellevue', 'Kierch', 'Kino Aurora', 'Pizzeria Bella', 'Supermarché', 'Polizei', 'Lycée', 'Spidol', 'Crèche', 'Boulangerie', 'Musée', 'Banque', 'Coiffure', 'Restaurant', 'Bistro', 'Pompjeeën', 'Garage', 'Tankstell', 'Schwämm', 'Gare Centrale', 'Bio Buttek', 'Kiosk', 'Fussballterrain', 'Parkhaus', 'Atelier', 'Depot', 'Studio', 'Campus', 'Bureau', 'Conservatoire'];
  let pi = 0;
  for (let iz = 0; iz < 6; iz++) for (let ix = 0; ix < 6; ix++) {
    const x = -210 + ix * 84, z = -210 + iz * 84, road = z - 42;
    const i = pi++;
    P.places.push(Object.freeze({ name: labels[i], x: x + 4, z: road + 3, bx: x + 4, bz: road + 19, district: z > 168 ? x < 0 ? 'Ateliers' : 'Parc de la Pétrusse' : z < 0 ? x < 0 ? 'Alstad' : 'Kirchberg' : x < 0 ? 'Garer Quartier' : 'Belair' }));
  }
  P.places[7] = Object.freeze({ ...P.places[7], x: -165, z: -133, bx: -138, bz: -133 });
  P.places[13] = Object.freeze({ ...P.places[13], bz: -60 });
  P.places[24] = Object.freeze({ ...P.places[24], bz: 118 });
  P.places[28] = Object.freeze({ ...P.places[28], bz: 115 });
  P.places[25] = Object.freeze({ ...P.places[25], x: -126, z: 165, bx: -126, bz: 132 });
  // South-bank jobs make the viaduct part of delivery routes, not just scenery.
  for (let i = 30; i < 36; i++) P.places[i] = Object.freeze({ ...P.places[i], z:255, bz:271 });
  P.places[30] = Object.freeze({ ...P.places[30], name:'Ateliers Municipaux', x:-225, bx:-225, bz:274 });
  P.places[31] = Object.freeze({ ...P.places[31], name:'Dépôt Express', x:-126, bx:-126, bz:274 });
  Object.freeze(P.places);
  P.buildCity = function (scene, obstacles) {
    const cells = new Map(), lamps = [], signChecks = [], landmarks = [];
    let partCount = 0, vertexCount = 0, countryside = false;
    const mat = {
      plaster: P.material('plaster', { map: P.texture('plaster'), bumpMap: P.texture('plaster'), bumpScale: .018, vertexColors: true }),
      brick: P.material('brick', { map: P.texture('brick'), bumpMap: P.texture('brick'), bumpScale: .025, vertexColors: true }),
      slate: P.material('slate', { map: P.texture('slate'), bumpMap: P.texture('slate'), bumpScale: .045, vertexColors: true, roughness: .72 }),
      asphalt: P.material('asphalt', { map: P.texture('asphalt'), roughness: .98, vertexColors: true }),
      paving: P.material('paving', { map: P.texture('paving'), bumpMap: P.texture('paving'), bumpScale: .04, vertexColors: true }),
      grass: P.material('grass', { map: P.texture('grass'), vertexColors: true }),
      stone: P.material('stone', { color: '#ffffff', vertexColors: true }),
      office: P.material('office-glazing', { map: P.texture('office'), metalness: .3, roughness: .2, vertexColors: true }),
      glass: P.material('glass', { color: '#73969f', metalness: .48, roughness: .18, vertexColors: true }),
      metal: P.material('metal', { color: '#ffffff', vertexColors: true, metalness: .55, roughness: .48 }),
      leaves: P.material('leaves', { color: '#ffffff', vertexColors: true, roughness: 1 }),
      glow: P.material('lamp-glow', { color: '#ffe4a0', emissive: '#ffd58c', emissiveIntensity: .12 }),
      water: P.material('water', { color: '#477c83', metalness: .4, roughness: .2 }),
    };
    // One atlas and one material for every shop sign; front-facing UVs never use a reflected transform.
    const atlas = document.createElement('canvas'); atlas.width = 2048; atlas.height = 4096;
    const ag = atlas.getContext('2d'), signs = new Map(); let signIndex = 0;
    mat.sign = P.material('sign-atlas', { map: new T.CanvasTexture(atlas), roughness: .7 }); mat.sign.map.colorSpace = T.SRGBColorSpace;
    function cell(x, z) {
      const ix = Math.floor((x + 294) / 84), iz = Math.floor((z + 294) / 84), key = countryside ? 'countryside' : ix + ':' + iz;
      if (!cells.has(key)) cells.set(key, { x: ix * 84 - 252, z: iz * 84 - 252, countryside, batches: new Map(), instances: new Map(), group: new T.Group(), detail: new T.Group() });
      return cells.get(key);
    }
    const object = new T.Object3D();
    function add(g, material, x, y, z, rotation = 0, detail = false, color = '#ffffff') {
      partCount++; vertexCount += g.attributes.position.count;
      if (color !== null) P.tint(g, color); object.position.set(x, y, z); object.rotation.set(0, rotation, 0); object.scale.set(1, 1, 1); object.updateMatrix(); g.applyMatrix4(object.matrix);
      const c = cell(x, z), key = material.uuid + ':' + detail;
      if (!c.batches.has(key)) c.batches.set(key, { material, detail, gs: [] });
      c.batches.get(key).gs.push(g);
    }
    function box(kind, color, x, y, z, w, h, d, rotation = 0, detail = false) {
      if (detail) { partCount++; vertexCount += 24; }
      const scale = { brick: 1.1, slate: 1.25, plaster: 4, asphalt: 5, paving: 1.2, grass: 6, office: 4 }[kind] || 1;
      if (detail && (kind === 'stone' || kind === 'metal')) {
        const c = cell(x,z), key = mat[kind].uuid;
        if (!c.instances.has(key)) c.instances.set(key,{ material:mat[kind], boxes:[] });
        c.instances.get(key).boxes.push({x,y,z,w,h,d,rotation,color}); return;
      }
      const g = P.boxGeometry(w, h, d, scale);
      if (w > 2000 || d > 2000) {
        const mesh = new T.Mesh(P.tint(g, color), mat[kind]); mesh.position.set(x,y,z); mesh.rotation.y = rotation; mesh.receiveShadow = true; scene.add(mesh); return;
      }
      add(g, mat[kind], x, y, z, rotation, detail, color);
    }
    function cylinder(kind, color, x, y, z, r, h, detail = false, top = r, sides = 10) {
      add(new T.CylinderGeometry(top, r, h, sides), mat[kind], x, y, z, 0, detail, color);
    }
    function sign(label, x, y, z, w, yaw, color = '#254c48') {
      const height = Math.min(1.65,w / 3.6), signKey = label + ':' + w;
      if (!signs.has(signKey)) {
        const n = signIndex++, ax = n % 4 * 512, ay = Math.floor(n / 4) * 128;
        ag.fillStyle = color; ag.fillRect(ax, ay, 512, 128); ag.strokeStyle = '#ead5ab'; ag.lineWidth = 3; ag.strokeRect(ax + 9, ay + 9, 494, 110);
        ag.font = 'bold 67px Arial'; ag.fillStyle = '#fff2d3'; ag.textAlign = 'center'; ag.textBaseline = 'middle'; const squash = Math.min(1,height * 4 / w); ag.save(); ag.translate(ax + 256,ay + 64); ag.scale(squash,1); ag.fillText(label,0,0,474 / squash); ag.restore();
        signs.set(signKey, { ax, ay });
      }
      const { ax, ay } = signs.get(signKey), g = new T.PlaneGeometry(w, height), uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (ax + 3 + uv.getX(i) * 506) / 2048, 1 - (ay + 125 - uv.getY(i) * 122) / 4096);
      add(g, mat.sign, x, y, z, yaw, true); signChecks.push({ label, x, z, yaw });
    }
    function tree(x, z, size = 1) {
      if (z > 197 && z < 223) z = z < 210 ? 195 : 225;
      cylinder('stone', '#776049', x, 2.4 * size, z, .26 * size, 4.8 * size);
      for (let k = 0; k < 6; k++) {
        const a = k * 2.399, spread = k < 3 ? 1.8 : 1.1;
        const g = new T.IcosahedronGeometry((k < 3 ? 2.25 : 1.8) * size, 1);
        g.scale(1, 1.2, .9);
        add(g, mat.leaves, x + Math.cos(a) * spread * size, (4.8 + k * .4) * size, z + Math.sin(a) * spread * size, a, false, ['#5e7947', '#70894f', '#83975d'][k % 3]);
      }
      cylinder('stone', '#b8b2a1', x, .25, z, 1.3 * size, .3, true);
    }
    function lamp(x, z) {
      cylinder('metal', '#394a4a', x, 3.4, z, .075, 6.8, false, .065);
      cylinder('metal', '#394a4a', x, .36, z, .19, .7, true);
      box('metal', '#394a4a', x, 6.75, z, .7, .1, .7);
      box('glow', '#ffffff', x, 7.05, z, .45, .52, .45);
      add(new T.ConeGeometry(.57, .35, 4), mat.metal, x, 7.5, z, Math.PI / 4, false, '#394a4a'); lamps.push({ x, z });
    }
    function bench(x, z, yaw) {
      for (let k = 0; k < 4; k++) box('stone', '#87694d', x, .7, z + k * .15, 2.5, .09, .11, yaw, true);
      box('stone', '#87694d', x, 1.2, z + .6, 2.5, .65, .11, yaw, true);
      for (const s of [-1, 1]) box('metal', '#384442', x + s * .9, .4, z + .25, .1, .65, .55, yaw, true);
    }
    function roof(x, z, w, d, y, rise, yaw) {
      // Triangular gables and two properly UV-mapped pitched slate planes.
      const half = w / 2 + .45, dep = d / 2 + .55, g = new T.BufferGeometry();
      const vs = [-half,0,-dep, 0,rise,-dep, -half,0,dep, 0,rise,-dep, 0,rise,dep, -half,0,dep,
        0,rise,-dep, half,0,-dep, 0,rise,dep, half,0,-dep, half,0,dep, 0,rise,dep];
      for (let i = 0; i < vs.length; i += 9) for (let k = 0; k < 3; k++) [vs[i + k], vs[i + 6 + k]] = [vs[i + 6 + k], vs[i + k]];
      g.setAttribute('position', new T.Float32BufferAttribute(vs, 3)); g.computeVertexNormals();
      const sl = Math.hypot(half, rise) / 1.25, dd = dep * 2 / 1.25;
      g.setAttribute('uv', new T.Float32BufferAttribute([0,0,sl,0,0,dd, sl,0,sl,dd,0,dd, 0,0,sl,0,0,dd, sl,0,sl,dd,0,dd], 2));
      add(g, mat.slate, x, y, z, yaw, false, '#93a6b7');
      const end = new T.BufferGeometry(); end.setAttribute('position', new T.Float32BufferAttribute([-w/2,0,-d/2, w/2,0,-d/2, 0,rise,-d/2, w/2,0,d/2, -w/2,0,d/2, 0,rise,d/2], 3)); const ep = end.attributes.position; for (let i = 0; i < ep.count; i += 3) { const a = new T.Vector3().fromBufferAttribute(ep, i), b = new T.Vector3().fromBufferAttribute(ep, i + 2); ep.setXYZ(i,b.x,b.y,b.z); ep.setXYZ(i+2,a.x,a.y,a.z); } end.computeVertexNormals();
      end.setAttribute('uv', new T.Float32BufferAttribute([0,0,w/4,0,w/8,rise/4,0,0,w/4,0,w/8,rise/4], 2)); add(end, mat.plaster, x, y, z, yaw, false, '#d8cbb6');
    }
    function house(x, z, w, d, floors, color, yaw = 0, label = '', type = 'old') {
      const height = floors * 3.15 + .7, modern = type === 'modern', h = modern ? height * 1.45 : height;
      const local = (lx, ly, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), ly, z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
      const b = (kind, col, lx, ly, lz, bw, bh, bd, detail = false) => box(kind, col, ...local(lx, ly, lz), bw, bh, bd, yaw, detail);
      b(modern ? 'office' : type === 'brick' ? 'brick' : 'plaster', modern ? '#c5dce5' : color, 0, h / 2 + .3, 0, w, h, d);
      b('stone', '#bcb4a4', 0, .6, 0, w + .2, .6, d + .2);
      b('paving', '#e4dfd1', 0, .14, -d / 2 - 1.5, w + .2, .3, 3);
      if (!modern) {
        for (let yy = 1.1; yy < h; yy += .65) for (const edge of [-1, 1]) b('stone', '#ddd4c3', edge * (w / 2 - .2), yy, -d / 2 - .09, .55, .28, .24, true);
        b('metal', '#666a60', w / 2 - .7, h / 2, -d / 2 - .15, .09, h, .1, true);
        for (const side of [-1,1]) b('metal', '#7c8179', 0, h + .3, side * (d / 2 + .43), w + .7, .15, .14, true);
      }
      if (!modern) {
        roof(x, z, w, d, h + .3, w * .31, yaw);
        b('stone', '#d9d1bf', 0, h + .15, 0, w + .5, .35, d + .5);
        b('brick', '#faf5e8', w * .28, h + 2.1, 1.7, 1.1, 3.3, 1);
        b('stone', '#c3bbaa', w * .28, h + 3.8, 1.7, 1.35, .25, 1.3);
        if (floors >= 3) for (const side of w > 15 ? [-1,1] : [1]) {
          const dx = side * w * .34;
          b('plaster',color,dx,h + 1.1,0,2.8,2.15,2.1);
          const q = local(dx,0,0); roof(q[0],q[2],2.3,3,h + 2.27,.95,yaw - side * Math.PI / 2);
          b('glass','#b9c9d1',dx + side * 1.46,h + 1.2,0,.1,1.4,1.2);
          b('stone','#eee8d8',dx + side * 1.53,h + 1.2,0,.12,1.5,.09,true);
          for (const edge of [-1,1]) b('stone','#eee8d8',dx + side * 1.53,h + 1.2,edge * .65,.15,1.55,.1,true);
          b('stone','#eee8d8',dx + side * 1.54,h + 1.95,0,.16,.1,1.4,true);
        }
      } else {
        b('stone', '#cbd3cc', 0, h + .45, 0, w + .5, .5, d + .5);
        for (let fy = 3; fy < h; fy += 3.2) b('metal', '#cad5d3', 0, fy, 0, w + .1, .15, d + .1);
      }
      if (modern) {
        // Continuous curtain walls, aluminium fins and a clear lobby distinguish Kirchberg from Alstad.
        for (let fx = -w / 2; fx <= w / 2; fx += 3.1) for (const side of [-1,1]) b('metal', '#bbcdd1', fx, h / 2, side * (d / 2 + .08), .065, h, .18);
        for (let fz = -d / 2; fz <= d / 2; fz += 3.1) for (const side of [-1,1]) b('metal', '#bbcdd1', side * (w / 2 + .08), h / 2, fz, .18, h, .065);
        b('metal', '#d5dedb', 0, 1.6, -d / 2 - .16, 2.5, 3, .18);
        b('glass', '#d5e6ec', 0, 1.6, -d / 2 - .28, 2.3, 2.8, .05);
        b('metal', '#d2dad5', 0, 1.6, -d / 2 - .33, .06, 2.8, .06);
        if (label) { const s = local(0,3.4,-d / 2 - .31); sign(label,s[0],s[1],s[2],w - 1,yaw + Math.PI,'#304d62'); }
        obstacles.push({ x,z,hx: yaw % Math.PI ? d / 2 : w / 2, hz: yaw % Math.PI ? w / 2 : d / 2 });
        return;
      }
      // Both street-facing and courtyard windows have actual recess, reveals, frames and protruding sills.
      for (const side of [-1, 1]) {
        const front = side * (d / 2 + .06);
        for (let fy = label ? 4.95 : 2.2; fy < h - .7; fy += 3.15) for (let fx = -w / 2 + 2; fx < w / 2 - .8; fx += 3.15) {
          b('stone', '#777970', fx, fy, front, 1.65, 2.16, .13);
          if (floors === 2 && !modern) for (const edge of [-1,1]) {
            b('stone', '#60776d', fx + edge * 1.15, fy, front + side * .12, .55, 1.96, .1, true);
            for (let k = -3; k <= 3; k++) b('stone', '#76887b', fx + edge * 1.15, fy + k * .24, front + side * .18, .48, .045, .06, true);
          }
          b('glass', modern ? '#abc8cb' : '#a7bdc2', fx, fy, front + side * .08, 1.39, 1.87, .07);
          for (const edge of [-1, 1]) b('stone', '#e7e0d0', fx + edge * .77, fy, front + side * .14, .12, 2.15, .18, true);
          b('stone', '#e7e0d0', fx, fy + 1.04, front + side * .14, 1.62, .14, .2, true);
          b('stone', '#ebe2cd', fx, fy - 1.06, front + side * .2, 1.85, .18, .45);
          b('stone', '#dfd9cb', fx, fy, front + side * .16, .065, 1.88, .14, true);
          b('stone', '#dfd9cb', fx, fy - .22, front + side * .16, 1.45, .065, .14, true);
          if (floors >= 3 && fx < 0 && side === -1 && fy < 6.5) {
            b('stone', '#bbb5a7', fx, fy - 1.15, front - .6, 2.15, .18, 1.25, true);
            b('metal', '#394343', fx, fy - .55, front - 1.17, 2.05, .08, .07, true);
            for (let k = -3; k <= 3; k++) b('metal', '#394343', fx + k * .3, fy - .8, front - 1.17, .045, .8, .06, true);
          }
        }
      }
      for (const side of [-1, 1]) for (let fy = 2.3; fy < h - .7; fy += 3.15) for (let fz = -d / 2 + 2.4; fz < d / 2 - 1; fz += 3.25) {
        const sx = side * (w / 2 + .07);
        b('stone', '#777970', sx, fy, fz, .13, 2.12, 1.65);
        b('glass', '#a7bdc2', sx + side * .09, fy, fz, .07, 1.87, 1.39);
        for (const edge of [-1, 1]) b('stone', '#e7e0d0', sx + side * .15, fy, fz + edge * .77, .18, 2.15, .12, true);
        b('stone', '#e7e0d0', sx + side * .15, fy + 1.04, fz, .2, .14, 1.62, true);
        b('stone', '#ebe2cd', sx + side * .21, fy - 1.06, fz, .45, .18, 1.85);
        b('stone', '#dfd9cb', sx + side * .17, fy, fz, .14, 1.87, .065, true);
      }
      b('stone', '#d3cab9', -w * .25, 1.8, -d / 2 - .11, 2.1, 3, .28);
      b('stone', '#554d43', -w * .25, 1.65, -d / 2 - .28, 1.65, 2.7, .13);
      b('glass', '#c4c4af', -w * .25, 2.15, -d / 2 - .36, 1.2, 1.2, .05, true);
      b('metal', '#c1a268', -w * .25 + .5, 1.5, -d / 2 - .39, .06, .22, .07, true);
      if (label) {
        b('stone', '#3f514e', w * .13, 1.75, -d / 2 - .1, w * .57, 2.8, .2);
        b('glass', '#c0d2ce', w * .13, 1.8, -d / 2 - .24, w * .52, 2.45, .06);
        b('metal', '#e0d8c7', w * .13, 1.8, -d / 2 - .31, .1, 2.6, .1, true);
        b('stone', '#eee0be', 0, 3.4, -d / 2 - .33, w - .7, .86, .42);
        const s = local(0, 3.45, -d / 2 - .56); sign(label, s[0], s[1], s[2], w - 1, yaw + Math.PI);
        // Sloped awning with a striped valance, merged into the district detail batch.
        for (let stripe = 0; stripe < Math.floor(w / .65); stripe++) {
          const g = P.boxGeometry(.63, .08, 1.8); g.rotateX(.23);
          add(g, mat.stone, ...local(-w / 2 + .5 + stripe * .65, 3, -d / 2 - 1), yaw, true, stripe % 2 ? '#e9e0c9' : '#536f58');
          b('stone', stripe % 2 ? '#e9e0c9' : '#536f58', -w / 2 + .5 + stripe * .65, 2.75, -d / 2 - 1.88, .63, .3, .08, true);
        }
      }
      obstacles.push({ x, z, hx: yaw % Math.PI ? d / 2 : w / 2, hz: yaw % Math.PI ? w / 2 : d / 2 });
    }
    function landmark(p, i) {
      const x = p.bx, z = p.bz, start = partCount, verts = vertexCount;
      const features = [], kind = ['post','bakery','pharmacy','library','cafe','office','hotel','church','cinema','pizzeria','supermarket','police','school','hospital','nursery','bakery','museum','bank','salon','restaurant','bistro','fire','garage','fuel','pool','station','organic','kiosk','football','parking','workshop','depot','studio','campus','office','music'][i];
      const b = (material,color,lx,y,lz,w,h,d,detail=false) => box(material,color,x+lx,y,z+lz,w,h,d,0,detail);
      const label = (name,lx,y,lz,w,color='#254c48') => sign(name,x+lx,y,z+lz,w,Math.PI,color);
      const block = (w,h,d,color='#eee8db') => {
        b('plaster',color,0,h/2+.3,0,w,h,d); b('stone','#dadbd1',0,h+.45,0,w+.7,.4,d+.7);
        obstacles.push({x,z,hx:w/2,hz:d/2});
      };
      const glass = (w,y,lz,h=3) => {
        b('glass','#c2dde3',0,y,lz,w,h,.1);
        for (let q=-w/2;q<=w/2;q+=2.5) b('metal','#ecede3',q,y,lz-.1,.09,h,.16);
      };
      const windows = (w,h,d) => {
        for (let y=5;y<h;y+=3.2) for (let q=-w/2+2;q<w/2;q+=3.2) {
          b('glass','#b5d3dd',q,y,-d/2-.05,2,1.8,.12);
          b('stone','#ffffff',q,y-.97,-d/2-.17,2.25,.15,.3,true);
        }
      };
      const canopy = (w,lz,color='#dfdfd5',y=3.8) => {
        b('metal',color,0,y,lz,w,.35,5);
        for (const side of [-1,1]) b('metal','#cbd3cb',side*(w/2-.6),y/2,lz-1.7,.16,y,.16);
      };
      const awning = (w,color) => {
        for (let q=0;q<w/.7;q++) { const g=P.boxGeometry(.69,.12,2.6); g.rotateX(.18); add(g,mat.stone,x-w/2+q*.7+.35,3.45,z-8,0,false,q%2?'#fff5df':color); }
      };
      const cross = (lx,y,lz,color,size=1.4) => {
        b('stone',color,lx,y,lz,size*.34,size,.25); b('stone',color,lx,y,lz,size,size*.34,.25);
      };
      const parked = (lx,lz,color,type='van',yaw=0) => {
        // Parked service vehicles are merged with their district, including wheels and emergency markings.
        const v=P.makeVehicle({id:type==='fire'?'van':type,length:type==='fire'?7:type==='bus'?8:type==='van'?5.3:4.1,parcel:false},color);
        v.updateMatrixWorld(true);
        v.traverse(m=> {
          if (m.isMesh && !m.isInstancedMesh) { const g=m.geometry.clone().applyMatrix4(m.matrixWorld); add(g,m.material,x+lx,.05,z+lz,yaw,false,null); }
          if (m.isInstancedMesh) for (let n=0;n<m.count;n++) { const transform=new T.Matrix4();m.getMatrixAt(n,transform); const g=m.geometry.clone().applyMatrix4(transform);add(g,m.material,x+lx,.05,z+lz,yaw,false,null); }
        });
        v.children.filter(m=>m.isInstancedMesh).forEach(m=>{m.geometry.dispose();m.dispose();});
        if (color==='#f4f1e5') { cross(lx,1.9,lz+1,'#d53e36',.9);for(const side of [-1,1]){b('stone','#cf4235',lx+side*1.15,1.35,lz-1.6,.06,.3,4.5);b('stone','#cf4235',lx+side*1.16,2,lz,.06,1,.35);b('stone','#cf4235',lx+side*1.16,2,lz,.06,.35,1);} b('glow','#58a3df',lx,3,lz-2,.9,.2,.4); }
        if(type==='fire') {
          for(const side of [-1,1]) {b('metal','#c4ceca',lx+side*1.15,1.9,lz+.1,.07,1.4,3.8);b('stone','#f1e5d5',lx+side*1.2,1,lz-1.6,.08,.24,6);b('metal','#aebcb8',lx+side*.6,3.15,lz-1.4,.12,.12,5.8);}
          for(let k=-4;k<=1;k+=.5)b('metal','#d5dcd2',lx,3.15,lz+k,1.3,.08,.1);
          b('glow','#439cdc',lx,3,lz-3.8,1.4,.24,.35);
        }
        if(color==='#e2e9ea'){for(const side of [-1,1])b('stone','#306591',lx+side*1.01,1.05,lz-1.5,.08,.38,3.2);b('glow','#449de2',lx,2.25,lz-1.7,1.2,.18,.35);}
        obstacles.push({x:x+lx-Math.sin(yaw)*1.7,z:z+lz-Math.cos(yaw)*1.7,hx:2.9,hz:2.9});
      };
      const terrace = () => {
        for (const lx of [-6,0,6]) {
          cylinder('stone','#e5d3af',x+lx,1,z-11,1.1,.14,true);
          cylinder('metal','#44594c',x+lx,.52,z-11,.1,1,true);
          for (const d of [-1,1]) { b('stone','#7b6750',lx,.55,-11+d*1.6,.7,.12,.7,true);b('metal','#44594c',lx,.3,-11+d*1.6,.06,.6,.06,true); }
          add(new T.ConeGeometry(2,.65,16),mat.stone,x+lx,3.2,z-11,0,false,'#eee1bf');
          b('metal','#777869',lx,2,-11,.06,2.8,.06,true);
        } features.push('terrace');
      };
      if (kind==='hospital') {
        block(32,16,20,'#fbf9ef');windows(32,16,20);
        b('plaster','#e5ebe7',0,2.1,-11.5,14,4.2,3);glass(10,1.9,-13.05,3.1);canopy(16,-14,'#dce5e4');
        label('SPIDOL',0,13,-10.2,12,'#b9433b');cross(-12,13,-10.2,'#dc413b',3);
        b('asphalt','#bdc9c5',22,.15,0,10,.15,26);b('metal','#dce5e4',22,4.2,9,10,.3,3);for(const lx of [18,26])b('metal','#cbd3cb',lx,2.1,9,.15,4.2,.15);label('AMBULANZ',22,4.5,7.4,9,'#a63e35');
        for (const lz of [-4,6]) parked(22,lz,'#f4f1e5');
        const pad=new T.CircleGeometry(5.7,40);pad.rotateX(-Math.PI/2);add(pad,mat.stone,x,16.69,z,0,false,'#477c69');
        const ring=new T.RingGeometry(5,5.35,40);ring.rotateX(-Math.PI/2);add(ring,mat.stone,x,16.71,z,0,false,'#f8f5ce');
        b('stone','#fff9e2',-1.6,16.73,0,.55,.03,5);b('stone','#fff9e2',1.6,16.73,0,.55,.03,5);b('stone','#fff9e2',0,16.73,0,3.5,.03,.55);
        features.push('white-wards','red-cross','entrance-canopy','ambulance-bay','helipad');
      } else if (kind==='post') {
        block(25,8,16,'#efe1ad');windows(25,8,16);glass(20,2,-8.1);b('stone','#f4cc34',0,4.5,-8.2,25,1.9,.3);label('POST',0,4.5,-8.4,13,'#e2b825');
        for (const lx of [-8,-5]) {b('metal','#ebc226',lx,1,-11,1.2,1.9,.8);b('metal','#445b64',lx,1.5,-11.42,.85,.15,.06);}
        for (const lx of [18,24]) parked(lx,6,'#f1c62c');features.push('yellow-brand','post-boxes','delivery-vans');
      } else if (kind==='office') {
        block(20,25+i%3*5,18,'#d0e1e8');b('office','#d0e5ed',0,15,0,20,29,18);b('office','#b9d4e0',15,11,3,8,22,14);
        for (let y=3;y<29;y+=3) b('metal','#d8e6e5',0,y,0,20.1,.15,18.1);
        for (let lx=-10;lx<=10;lx+=2.5) b('metal','#d8e6e5',lx,15,-9.1,.08,29,.12);
        glass(12,2,-9.2);label(p.name.toUpperCase(),0,4.6,-9.3,17,'#345c75');features.push('glass-towers','curtain-wall');
      } else if (kind==='school'||kind==='campus') {
        block(35,9,13,'#e8dbc3');windows(35,10,13);glass(8,2,-6.6);label(kind==='school'?'LYCÉE':'CAMPUS',0,7.5,-6.8,14,'#4d7980');
        b('paving','#e6d7b9',0,.18,16,35,.22,26);b('asphalt','#8fa6a1',6,.32,16,20,.05,17);
        for (const lx of [-4,16]) b('stone','#f8eed7',lx,.36,16,.08,.02,17);
        b('metal','#536e67',16,2.5,16,.14,5,.14);b('stone','#e4e4cc',16,4.7,15.5,.2,1.7,2.6);
        const hoop=new T.TorusGeometry(.45,.045,6,20);hoop.rotateX(Math.PI/2);add(hoop,mat.metal,x+15.3,4.1,z+15.5,0,false,'#be5637');
        for(let k=0;k<7;k++){ const g=new T.TorusGeometry(.5,.045,6,12,Math.PI);add(g,mat.metal,x-14+k*1.6,.35,z+9,0,true,'#4c6c69'); }
        features.push('long-classrooms','schoolyard','basketball','bike-racks');
      } else if(kind==='supermarket'||kind==='organic') {
        block(34,5,16,'#e4e4d6');glass(31,2.3,-8.1,3.8);label(p.name.toUpperCase(),0,4.6,-8.3,26,'#457d69');
        b('asphalt','#b3bfbb',21,.2,11,11,.1,27);
        for(let k=0;k<4;k++) {b('stone','#f6efd8',21,.28,k*6-1,10,.03,.13);if(k<3)parked(22,k*6+2,['#466f83','#b56a57','#e0d4b4'][k],'auto');}
        for(let k=0;k<4;k++){b('metal','#a3b9b6',-12+k*1.1,.9,-10.2,.8,.65,1);b('metal','#425b58',-12+k*1.1,1.3,-9.7,.8,.12,.1);}
        features.push('wide-glass-front','car-park','trolleys');
      } else if(kind==='pool') {
        block(32,8,23,'#dde6df');
        // An open glass pavilion: roof on columns, water and lanes visible through the front.
        b('water','#3dbee4',0,.6,-5,26,.12,12);b('stone','#e9efdb',0,.42,-5,29,.2,15);
        b('water','#3dbee4',0,.64,-5,26,.1,12);
        b('glass','#b5dfdf',0,6.8,-11.6,30,1.9,.08);
        for(const lx of [-15,-10,-5,0,5,10,15]) b('metal','#eff4eb',lx,3.1,-11.6,.13,6,.15);
        // Remove the opaque front wall below the glass by bringing the pavilion forward.
        b('stone','#dfe9dc',0,6,-13.5,32,.35,5);b('water','#30a6d2',0,.62,-13.5,28,.12,4);
        for(const lx of [-14,14]) b('metal','#e3e9df',lx,3,-15.8,.15,6,.15);
        for(let k=-10;k<=10;k+=5)b('stone','#ffe09b',k,.71,-13.5,.1,.025,4);
        label('SCHWÄMM',0,6.3,-16.1,19,'#317d9c');features.push('pool-pavilion','blue-water','swim-lanes');
      } else if(kind==='football') {
        b('grass','#9cc48a',0,.15,10,55,.3,58);b('grass','#9aca89',0,.32,10,46,.1,48);
        for(const lx of [-23,23]) b('stone','#fff7df',lx,.39,10,.15,.025,48);
        for(const lz of [-14,10,34]) b('stone','#fff7df',0,.39,lz,46,.025,.15);
        const circle=new T.RingGeometry(5.8,5.95,40);circle.rotateX(-Math.PI/2);add(circle,mat.stone,x,.39,z+10,0,false,'#fff7df');
        for(const lz of [-14,34]) {for(const lx of [-4,4]) b('metal','#fff9ec',lx,1.6,lz,.13,3.2,.13);b('metal','#fff9ec',0,3.2,lz,8,.13,.13);for(let k=-4;k<=4;k++)b('metal','#dfdfcf',k,1.5,lz+.4,.03,3,.04,true);}
        for(let k=0;k<4;k++) b('stone','#b5b8ae',-27,.6+k*.6,2+k*1.3,5,1.2+k*1.2,22);
        for(const lx of [-26,26]) for(const lz of [-16,35]) {b('metal','#677e74',lx,7,lz,.18,14,.18);b('glow','#ffffff',lx,14,lz,2.8,.6,.4);}
        label('FUSSBALLTERRAIN',0,2,-20,24,'#447655');features.push('marked-pitch','goals','stand','floodlights');
      } else if(kind==='fuel') {
        block(13,4,12,'#e0dcbf');label('TANKSTELL',0,3.3,-6.2,11,'#ce673c');
        canopy(28,-10,'#e3c753',5.3);
        for(const lx of [-8,0,8]) {b('metal','#eeeece',lx,1.1,-10,1.4,2.2,1);b('glass','#294944',lx,1.55,-10.55,.9,.6,.05);b('metal','#292f2b',lx+.8,1,-10,.12,1.7,.15);}
        features.push('pump-islands','petrol-canopy');
      } else if(kind==='fire'||kind==='police') {
        const fire=kind==='fire';block(29,8,16,fire?'#e2c7ad':'#d7e2df');windows(29,8,16);
        for(const lx of [-9,0,9]) {b('metal',fire?'#c64132':'#325e88',lx,2.3,-8.1,7,4.5,.15);for(let y=.4;y<4.5;y+=.45)b('metal',fire?'#ee6b50':'#628aac',lx,y,-8.2,6.8,.055,.08,true);}
        label(fire?'POMPJEEËN':'POLIZEI',0,6.3,-8.3,23,fire?'#a7382e':'#2e547b');parked(18,4,fire?'#cc4233':'#e2e9ea',fire?'fire':'auto');features.push(fire?'red-garage-doors':'blue-police-bays',fire?'fire-truck':'patrol-car');
      } else if(kind==='parking') {
        block(30,12,21,'#cbd0c7');
        for(let y=2;y<12;y+=3) {b('stone','#394f51',0,y,-10.6,28,1.5,.1);b('stone','#9da9a2',0,y-1,-10.9,31,.4,.4);}
        const ramp=P.boxGeometry(6,.5,23);ramp.rotateX(-.25);add(ramp,mat.asphalt,x+19,3,z,0,false,'#c2c7ba');label('P · PARKHAUS',0,10.5,-11.1,22,'#315f8f');features.push('open-decks','access-ramp');
      } else if(kind==='cinema') {
        block(20,10,18,'#ceb6a0');glass(16,2,-9.1);canopy(23,-11,'#ad473a',4.5);label('KINO AURORA',0,5.5,-13.6,20,'#a53633');
        for(let q=-10;q<=10;q++) b('glow','#ffe2a0',q,4.5,-13.6,.16,.18,.18);
        for(const lx of [-6,6]) {b('metal','#a53d33',lx,7.8,-9.2,3,3.5,.15);label('FILM',lx,7.8,-9.4,2.7,'#886b53');}
        features.push('lit-marquee','film-posters');
      } else if(kind==='hotel') {
        block(18,17,17,'#e7d0b1');windows(18,17,17);canopy(10,-11,'#ac4942');glass(9,2,-8.6);label('HOTEL BELLEVUE',0,14.5,-8.7,16,'#704f47');label('★★★★',0,4.5,-8.8,7,'#704f47');features.push('hotel-porch','guest-floors');
      } else if(kind==='library'||kind==='museum'||kind==='bank'||kind==='music') {
        block(22,10,15,'#d9d6c1');
        for(const lx of [-8,-4,4,8]) cylinder('stone','#f2ecd7',x+lx,3.1,z-9,.35,6);
        const pediment=new T.ConeGeometry(12,3,3);pediment.scale(1,1,.17);add(pediment,mat.stone,x,10.6,z-8,Math.PI/2,false,'#eee6d0');
        glass(16,2.8,-7.6,4.6);label(p.name.toUpperCase(),0,7.3,-9.4,20,'#556969');
        if(kind==='library'){for(let k=0;k<12;k++)b('stone',['#a34e3d','#d6ac55','#48798c'][k%3],-6+k*.4,1.8,-7.8,.3,1.4,.15,true);b('brick','#c4aa90',14,3,2,7,6,13);}
        if(kind==='museum'){b('plaster','#e4daca',-15,4,3,8,8,19);b('plaster','#e4daca',15,4,3,8,8,19);cylinder('stone','#bc9d67',x,1.4,z-13,.6,2.8);}
        if(kind==='bank'){b('metal','#c7ab68',0,5,-10.3,15,.4,5);cylinder('metal','#c6a755',x,10.7,z,.8,1.4);}
        if(kind==='music'){cylinder('plaster','#dcc5ae',x+10,4,z+8,9,8,false,9,24);for(let k=0;k<9;k++)b('stone',k%3===0?'#394b49':'#eee9cc',-4+k,2,-7.9,.8,1.7,.14);}
        features.push('civic-colonnade',kind==='library'?'book-display':'pediment');
      } else if(kind==='kiosk') {
        cylinder('plaster','#c7d4bf',x,1.6,z,4,3.2,false,4,8);add(new T.ConeGeometry(5,2,8),mat.metal,x,4.2,z,0,false,'#567c69');label('KIOSK',0,2.8,-4.1,6);features.push('octagonal-kiosk');obstacles.push({x,z,hx:4,hz:4});
      } else {
        const bakery=kind==='bakery', dining=['cafe','pizzeria','bistro','restaurant'].includes(kind), pharmacy=kind==='pharmacy';
        const w=kind==='garage'?23:kind==='nursery'?20:16+i%3, h=kind==='studio'?12:kind==='nursery'?5:6+i%2*2;
        block(w,h,13,bakery?'#efd6a4':pharmacy?'#d9e5d5':kind==='pizzeria'?'#e2c1a3':'#d9d5c4');
        glass(w-2,1.9,-6.6,2.8);windows(w,h,13);
        label(bakery?'BÄCKEREI · 🥖':p.name.toUpperCase(),0,4.6,-6.9,w-1,pharmacy?'#3c8d50':kind==='pizzeria'?'#ae4035':bakery?'#976432':'#49665e');
        if(bakery||dining) awning(w,kind==='pizzeria'?'#c44537':bakery?'#c18f48':'#547e67');
        if(bakery){for(let k=0;k<9;k++){const loaf=new T.SphereGeometry(.45,10,6);loaf.scale(1.3,.55,.55);add(loaf,mat.stone,x-5+k*1.2,1.25,z-6.8,0,true,'#dbac61');}features.push('bread-display','striped-awning');}
        if(pharmacy){cross(w/2+1,5,-7,'#32b16a',2.3);features.push('green-cross');}
        if(dining)terrace();
        if(kind==='nursery'){for(let k=0;k<4;k++)b('stone',['#c76d54','#d4b74d','#659a9a','#7f94bd'][k],-6+k*4,1,-9,2,1.8,2);features.push('colour-play-blocks');}
        if(kind==='garage'){b('metal','#536e65',0,2.1,-6.7,10,3.8,.1);features.push('repair-bay');}
        if(!features.length)features.push(kind+'-front');
      }
      landmarks.push({name:p.name,kind,features,parts:partCount-start,vertices:vertexCount-verts,x,z});
    }
    countryside = true;
    // Oversized foundation reaches well beyond the camera far plane at every playable position.
    box('grass', '#d0d6b8', 0, -4.3, 0, 6000, 1, 6000);
    for (const side of [-1,1]) {
      box('grass', '#cbd2ae', side * 720, -.65, 0, 820, 1, 2300);
      box('grass', '#cbd2ae', 0, -.65, side * 720, 620, 1, 820);
      for (let k = -3; k <= 3; k++) {
        const v = k * 115;
        for (const axis of [0,1]) {
          const x = axis ? v : side * 430, z = axis ? side * 430 : v;
          box('grass', k % 2 ? '#b5bb84' : '#9aa771', x, -.06, z, axis ? 105 : 145, .18, axis ? 145 : 105);
          box('leaves', '#677c4d', x, .65, z + 50, axis ? 102 : 144, 1.3, 1.3);
        }
      }
    }
    for (let i = 0; i < 112; i++) {
      const a = i * Math.PI * 2 / 112, radius = 350 + P.random() * 100;
      const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
      if (P.roads.some(r => Math.abs(x-r)<13 || Math.abs(z-r)<13)) continue;
      tree(x,z,.9 + P.random() * .8);
    }
    for(let i=0;i<220;i++){
      const a=i*Math.PI*2/220,radius=440+P.random()*65,x=Math.cos(a)*radius,z=Math.sin(a)*radius;
      if(P.roads.some(r=>Math.abs(x-r)<13||Math.abs(z-r)<13))continue;
      cylinder('stone','#716752',x,2,z,.2,4);
      const g=new T.ConeGeometry(3.5+P.random()*2,9+P.random()*4,7);add(g,mat.leaves,x,6,z,a,false,i%2?'#5f7b56':'#728d62');
    }
    for (let i = 0; i < 28; i++) {
      const a = i * Math.PI * 2 / 28, radius = 680 + P.random() * 100;
      const g = new T.SphereGeometry(1,20,10); g.scale(95 + P.random()*75,24 + P.random()*16,100 + P.random()*80);
      add(g,mat.grass,Math.cos(a)*radius,-20,Math.sin(a)*radius,0,false,'#99ab8a');
    }
    // Exit roads continue into the forest and disappear in the same fog as the hills.
    for (const r of P.roads) for (const side of [-1,1]) for (const axis of [0,1]) {
      box('asphalt','#bec7bd',axis ? r : side*455,.06,axis ? side*455 : r,axis ? 11 : 322,.2,axis ? 322 : 11);
      for (let k = 310; k < 570; k += 20) box('stone','#e2ddc5',axis ? r : side*k,.18,axis ? side*k : r,axis ? .15 : 6,.02,axis ? 6 : .15);
      const x = axis ? r+9 : side*279, z = axis ? side*279 : r+9;
      box('metal','#596457',x,1.4,z,.1,2.8,.1);
      sign("Dir verloosst d’Stad",x,2.6,z,6,axis ? (side<0 ? 0 : Math.PI) : (side<0 ? -Math.PI/2 : Math.PI/2),'#637653');
    }
    countryside = false;
    // Terrain is split at the river; its bed and embankments are below road level.
    box('grass', '#e2e2c9', 0, -.65, -56, 760, 1, 508);
    box('grass', '#d4dcc7', 0, -.65, 288, 760, 1, 136);
    box('grass', '#829579', 0, -3.6, 209, 760, 1, 24);
    box('water', '#ffffff', 0, -3, 210, 760, .12, 12);
    for (const z of [198, 222]) box('brick', '#a7a597', 0, -1.45, z, 610, 3, 1.2);
    const roadWidth = r => r > 0 ? 16 : r === 0 ? 13 : 11;
    for (const r of P.roads) for (let t = -252; t <= 252; t += 84) for (const axis of ['x', 'z']) {
      const vertical = axis === 'z', w = roadWidth(r), x = vertical ? r : t, z = vertical ? t : r;
      
      box('asphalt', '#c7cec9', x, .08, z, vertical ? w : 84, .24, vertical ? 84 : w);
      for (const side of [-1, 1]) {
        for (const half of [-1, 1]) {
          const crossWidth = roadWidth(t), span = 42 - crossWidth / 2, along = half * (crossWidth / 2 + span / 2);
          box('paving', '#eae1ce', vertical ? x + side * (w / 2 + 1.7) : x + along, .1, vertical ? z + along : z + side * (w / 2 + 1.7), vertical ? 3.4 : span, .4, vertical ? span : 3.4);
          box('stone', '#cec9ba', vertical ? x + side * (w / 2 + .1) : x + along, .23, vertical ? z + along : z + side * (w / 2 + .1), vertical ? .22 : span, .22, vertical ? span : .22);
        }
        for (let offset = -30; offset <= 30; offset += 15) {
          if (Math.abs(offset) < 10) continue;
          if (side === 1) box('stone', '#e2ddc5', vertical ? x : x + offset, .215, vertical ? z + offset : z, vertical ? .16 : 5, .025, vertical ? 5 : .16);
          if (offset === -30 || offset === 30) {
            lamp(vertical ? x + side * (w / 2 + 2) : x + offset, vertical ? z + offset : z + side * (w / 2 + 2));
          }
        }
        for (let stripe = -4; stripe <= 4; stripe += 1.6) box('stone', '#eae5d3', vertical ? x + stripe : x + side * 11, .225, vertical ? z + side * 11 : z + stripe, vertical ? .85 : 3.2, .025, vertical ? 3.2 : .85);
      }
      if (vertical && t === 168) {
        // Stone viaduct: deck, protective railings and piers descend into the small valley.
        box('stone', '#b9b4a5', x, -.35, 210, w + 4, .8, 24);
        for (const side of [-1, 1]) {
          box('stone', '#c9c2af', x + side * (w / 2 + 1.8), .75, 210, .35, 1.1, 24);
          for (const zz of [202, 214]) box('brick', '#dad4c0', x + side * (w / 2 - 1), -2.4, zz, 2, 4.1, 2);
        }
      }
    }
    const pastels = ['#e8d6b9', '#d5c4ad', '#eddab8', '#ceaaaa', '#b6c6c0', '#d1cebb', '#e4d1c0', '#c7d3c5'];
    P.places.forEach((p, i) => {
      const cx = -210 + i % 6 * 84, cz = -210 + Math.floor(i / 6) * 84;
      const type = p.district === 'Kirchberg' ? 'modern' : p.district === 'Ateliers' || i % 5 === 0 ? 'brick' : 'old';
      const floors = type === 'modern' ? 3 + i % 3 : p.district === 'Belair' || p.district.includes('Parc') ? 2 : 2 + i % 3;
      if (i !== 7 && i !== 25 && i !== 30 && i !== 31) landmark(p,i);
      if (i === 28) return;
      if (p.district.includes('Parc')) {
        for (let k = 0; k < 9; k++) tree(cx - 29 + k % 3 * 21, cz - 8 + Math.floor(k / 3) * 19, .8 + P.random() * .3);
        bench(cx, cz, 0); return;
      }
      for (const k of [-1, 1]) {
        if (![0,5,10,12,13,21,23,24,29].includes(i)) house(cx + k * 25, cz - 23, 10, 13, floors, pastels[(i + k + 9) % 8], 0, '', type);
        if (i !== 25) house(cx + k * 23, cz + 23, 12 + i % 3, 13, type === 'modern' ? 4 : 2 + i % 2, pastels[(i + k + 11) % 8], Math.PI, '', type);
      }
      if (![10,12,13,14,20,24,29].includes(i)) tree(cx, cz + 7, 1.15);
      tree(cx + 31, cz + 5, .83);
      if (i % 2 === 0) tree(cx - 32, cz - 30, .95);
      if (i % 3 === 0) tree(cx + 32, cz + 30, .9);
      bench(cx - 12, cz - 32, 0);
      cylinder('metal', '#405854', cx + 14, .65, cz - 33, .4, 1.3, true);
      for (let k = -1; k <= 1; k++) cylinder('metal', '#3e4946', cx + k * 4, .53, cz - 33, .12, 1, true);
      box('stone', '#9e8c73', cx - 9, .5, cz - 32, 2.2, .8, 1.1, 0, true);
      add(new T.IcosahedronGeometry(.65, 1), mat.leaves, cx - 9, 1.1, cz - 32, 0, true, '#668d48');
      // Bus shelters: metal uprights, glass back and an information panel.
      if (i % 6 === 0 || i % 6 === 3) {
        box('metal', '#4b605f', cx + 24, 2.7, cz - 33, 4.8, .15, 2.3, 0, true);
        for (const s of [-1, 1]) box('metal', '#4b605f', cx + 24 + s * 2.2, 1.45, cz - 32.3, .09, 2.6, .1, 0, true);
        box('glass', '#d2e6df', cx + 24, 1.45, cz - 32, 4.5, 2.3, .07, 0, true);
        sign('BUS · AVL', cx + 24, 2.98, cz - 33.1, 3.4, Math.PI);
      }
      // Gardens and low boundaries are solid, rather than painted onto the ground.
      if (p.district === 'Belair') {
        box('stone', '#bcb39f', cx, .8, cz + 12, 24, 1.1, .3);
        box('leaves', '#657c4e', cx, 1.55, cz + 12, 24, 1.2, 1);
      }
    });
    // Alstad church, square and a Gëlle Fra inspired column with a golden figure.
    const churchStart = {parts:partCount,vertices:vertexCount};
    house(-126, -116, 14, 26, 4, '#d2c7af', 0, '', 'old');
    box('brick', '#e2d8c3', -138, 14, -133, 8, 28, 8);
    box('stone', '#f5ebd1', -138, 26, -133, 8.6, .5, 8.6);
    add(new T.ConeGeometry(6, 12, 4), mat.slate, -138, 34, -133, Math.PI / 4);
    for (const zz of [-137.06, -128.94]) {
      add(new T.CircleGeometry(1.3, 24), mat.stone, -138, 24.3, zz, zz < -133 ? Math.PI : 0, true, '#f7edd6');
      box('metal', '#434a43', -138, 24.8, zz + (zz < -133 ? -.02 : .02), .07, 1, .07, 0, true);
      box('metal','#434a43',-137.65,24.3,zz+(zz < -133 ? -.025 : .025),.7,.07,.07,0,true);
    }
    box('metal', '#c8ac69', -138, 41, -133, .18, 3, .18); box('metal', '#c8ac69', -138, 41.4, -133, 1.2, .15, .15);
    landmarks.push({name:'Kierch',kind:'church',features:['clock-tower','nave','spire'],parts:partCount-churchStart.parts,vertices:vertexCount-churchStart.vertices,x:-138,z:-133});
    box('paving', '#e0d7c4', -42, .3, -42, 31, .3, 28);
    cylinder('stone', '#d6ccb7', -42, .75, -42, 3, .7, false, 3, 16);
    cylinder('stone', '#d6ccb7', -42, 5.4, -42, .62, 9, false, .5);
    cylinder('metal', '#d3b559', -42, 11.1, -42, .32, 1.3, false, .19);
    add(new T.SphereGeometry(.27, 12, 8), mat.metal, -42, 12, -42, 0, false, '#d3b559');
    const wing = new T.ConeGeometry(.75, 1.6, 3); wing.rotateZ(-.9); add(wing, mat.metal, -42.5, 11.8, -42, 0, false, '#d3b559');
    obstacles.push({ x: -138, z: -133, hx: 4, hz: 4 }, { x: -42, z: -42, hx: 2.7, hz: 2.7 });
    tree(-55, -42, .85); tree(-28, -42, .85);
    // Gare's broad main hall, clock and canopy; keep delivery address on the avenue.
    const stationStart = {parts:partCount,vertices:vertexCount};
    house(-126, 132, 31, 15, 3, '#dec9a9', 0, 'GARE CENTRALE', 'brick');
    box('brick', '#e1d2b4', -126, 9.5, 120.5, 7, 19, 8); roof(-126, 120.5, 8, 9, 19, 3.7, 0);
    add(new T.CircleGeometry(1.6, 24), mat.stone, -126, 16.8, 116.44, Math.PI, false, '#fff0cc');
    box('metal', '#494743', -126, 17.2, 116.4, .08, .9, .1, 0, true);
    box('metal','#494743',-125.55,16.8,116.38,.9,.08,.1,0,true);
    for(let k=0;k<12;k++){const a=k*Math.PI/6;const tick=P.boxGeometry(.07,.2,.07);tick.rotateZ(-a);add(tick,mat.metal,-126+Math.sin(a)*1.35,16.8+Math.cos(a)*1.35,116.36,0,true,'#494743');}
    box('stone','#ded3b9',-126,1.8,116.35,2.8,3.5,.2);
    box('glass','#ccdad9',-126,1.65,116.2,2.4,3.1,.07);
    sign('GARE CENTRALE',-126,6.5,116.2,6,Math.PI);
    for (const s of [-1, 1]) box('metal', '#506363', -126 + s * 11, 3.6, 120, 1, .2, 7);
    for (const lz of [145,156]) {
      box('paving','#d6d7c7',-126,.55,lz-3,57,1,3);
      for(const side of [-1,1]) box('metal','#655e53',-126,.3,lz+side*.8,67,.15,.12);
      for(let lx=-156;lx<-94;lx+=1.4) box('stone','#9b8b73',lx,.19,lz, .28,.2,2.6);
      box('metal','#708b85',-126,4.6,lz-3,55,.24,5);
      for(const lx of [-149,-126,-102]) box('metal','#8b9384',lx,2.4,lz-3,.16,4.8,.16);
    }
    for(const lx of [-141,-132,-123]) {
      box('metal','#c73e35',lx,1.7,156,8.5,2.9,2.6);box('stone','#e5ddc6',lx,1.4,154.65,8.5,.9,.06);
      for(const side of [-1,1]) {
        box('stone','#e5ddc6',lx,1.4,156+side*1.35,8.5,.9,.06);
        for(let k=-3;k<=3;k+=1.5)box('glass','#a4c4cc',lx+k,2.3,156+side*1.4,1.2,.85,.06);
      }
      box('glass','#acc7cb',lx-4.3,2.2,156,.08,1,2.1);
      for(const side of [-1,1])box('metal','#3e4b45',lx+side*2.4,.65,156,1.5,.75,2.8);
    }
    add(new T.CircleGeometry(1.6,24),mat.stone,-126,16.8,124.56,0,false,'#fff0cc');
    box('metal','#494743',-126,17.2,124.62,.08,.9,.1,0,true);box('metal','#494743',-125.55,16.8,124.63,.9,.08,.1,0,true);
    sign('GARE · CFL',-126,5.5,141,22,0,'#8c4e44');
    sign('KIERCH',-142,5,-137.2,7,Math.PI);
    landmarks.push({name:'Gare Centrale',kind:'station',features:['clock-hall','platforms','tracks','train'],parts:partCount-stationStart.parts,vertices:vertexCount-stationStart.vertices,x:-126,z:132});
    // Workshop yards beyond the valley, with broad loading doors and an industrial chimney.
    for (const x of [-225, -126]) {
      box('plaster', '#9aa7a5', x, 3.6, 274, 24, 7, 17);
      box('metal', '#747e7c', x, 7.3, 274, 25, .35, 18);
      for (const side of [-1, 1]) {
        box('metal', '#4b5956', x + side * 5.4, 2.35, 265.4, 7.7, 4.5, .12);
        for (let k = 0; k < 12; k++) box('metal', '#6e7d76', x + side * 5.4, .4 + k * .35, 265.31, 7.5, .07, .1, 0, true);
      }
      sign(x === -225 ? 'Ateliers Municipaux' : 'Dépôt Express', x, 5.5, 265.3, 14, Math.PI);
      landmarks.push({name:x===-225?'Ateliers Municipaux':'Dépôt Express',kind:x===-225?'workshop':'depot',features:['loading-bays'],parts:33,vertices:792,x,z:274});
      obstacles.push({ x, z: 274, hx: 12, hz: 8.5 });
    }
    cylinder('brick', '#d9c3b0', -244, 11.2, 277, 1.4, 22, false, 1.05, 16);
    cylinder('metal', '#455651', -244, 22.4, 277, 1.12, .5);
    mat.sign.map.needsUpdate = true;
    const frameGeometry = P.tint(new T.BoxGeometry(1,1,1),'#ffffff'), frameTransform = new T.Object3D();
    for (const c of cells.values()) {
      for (const b of c.batches.values()) {
        const mesh = new T.Mesh(P.merge(b.gs), b.material);
        mesh.castShadow = !c.countryside && ![mat.asphalt, mat.grass, mat.paving, mat.water, mat.sign, mat.glow].includes(b.material);
        mesh.receiveShadow = true; mesh.frustumCulled = true;
        (b.detail ? c.detail : c.group).add(mesh);
      }
      for (const batch of c.instances.values()) {
        const mesh = new T.InstancedMesh(frameGeometry,batch.material,batch.boxes.length);
        batch.boxes.forEach((b,i) => {
          frameTransform.position.set(b.x,b.y,b.z); frameTransform.scale.set(b.w,b.h,b.d); frameTransform.rotation.set(0,b.rotation,0); frameTransform.updateMatrix();
          mesh.setMatrixAt(i,frameTransform.matrix); mesh.setColorAt(i,new T.Color(b.color));
        });
        mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); c.detail.add(mesh);
      }
      c.group.add(c.detail); scene.add(c.group); c.batches.clear(); c.instances.clear();
    }
    const lightPool = Array.from({ length: 5 }, () => { const l = new T.PointLight('#ffcc83', 0, 23, 2); l.visible = false; scene.add(l); return l; });
    return {
      cells, signChecks, lamps, mat, landmarks,
      update(player, quality, night, menu = false) {
        const range = { high: 265, medium: 215, low: 165 }[quality], detailRange = quality === 'high' ? 145 : quality === 'medium' ? 105 : 60;
        for (const c of cells.values()) {
          const d = Math.hypot(c.x - player.x, c.z - player.z);
          c.group.visible = c.countryside || d < range || (Math.max(Math.abs(c.x),Math.abs(c.z)) > 300 && d < 850);
          c.detail.visible = c.countryside || d < detailRange;
        }
        mat.glow.emissiveIntensity = .12 + night * 3;
        mat.glass.emissive.set('#f2b95e');mat.glass.emissiveIntensity=night*.45;mat.office.emissive.set('#50728a');mat.office.emissiveIntensity=night*.12;
        const nearest = lamps.slice().sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
        lightPool.forEach((l, i) => { l.position.set(nearest[i].x, 6.8, nearest[i].z); l.intensity = quality === 'low' ? 0 : night * 30; l.visible = quality !== 'low' && night > .02 && i < (quality === 'high' ? 5 : 3); });
      },
    };
  };
})(window.PX);
