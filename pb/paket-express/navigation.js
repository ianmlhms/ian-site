/* A* uses the same junction graph for the GPS ribbon and both map views. */
(function (P) {
  'use strict';
  const T = THREE, roads = P.roads, nodes = [], edges = new Map();
  roads.forEach((z, iz) => roads.forEach((x, ix) => { const id = iz * roads.length + ix; nodes.push({ x, z, id }); edges.set(id, []); }));
  for (const n of nodes) for (const m of nodes) if ((n.x === m.x || n.z === m.z) && Math.abs(n.x - m.x) + Math.abs(n.z - m.z) === 84) edges.get(n.id).push(m.id);
  const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
  P.roadAt = function (p) {
    const near = k => roads.reduce((a, b) => Math.abs(p[k] - a) < Math.abs(p[k] - b) ? a : b);
    const nx = near('x'), nz = near('z'), vertical = Math.abs(p.x - nx) < Math.abs(p.z - nz);
    return { x: vertical ? nx : p.x, z: vertical ? p.z : nz, vertical, road: vertical ? nx : nz, name: P.streetNames[roads.indexOf(vertical ? nx : nz)] };
  };
  P.route = function (start, goal) {
    if(P.allowedPoint&&(!P.allowedPoint(start)||!P.allowedPoint(goal)))return [];
    const s = P.roadAt(start), g = P.roadAt(goal), ns = [...nodes, { ...s, id: 49 }, { ...g, id: 50 }];
    const es = new Map([...edges].map(([id, list]) => [id, [...list]])); es.set(49, []); es.set(50, []);
    for (const [point, id] of [[s, 49], [g, 50]]) {
      const along = point.vertical ? 'z' : 'x';
      const candidates = nodes.filter(n => point.vertical ? n.x === point.x : n.z === point.z).sort((a, b) => a[along] - b[along]);
      const before = candidates.filter(n => n[along] <= point[along]).pop(), after = candidates.find(n => n[along] >= point[along]);
      for (const n of new Set([before, after].filter(Boolean))) { es.get(id).push(n.id); es.get(n.id).push(id); }
    }
    if (s.vertical === g.vertical && s.road === g.road) { es.get(49).push(50); es.get(50).push(49); }
    const open = new Set([49]), cost = new Map([[49, 0]]), previous = new Map();
    while (open.size) {
      const current = [...open].reduce((a, b) => (cost.get(a) + manhattan(ns[a], g)) < (cost.get(b) + manhattan(ns[b], g)) ? a : b);
      if (current === 50) {
        const ids = [50]; while (previous.has(ids[0])) ids.unshift(previous.get(ids[0]));
        const points = [start, ...ids.map(id => ({ x: ns[id].x, z: ns[id].z })), goal];
        return points.filter((p, i) => !i || Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z) > .05);
      }
      open.delete(current);
      for (const id of es.get(current)) {
        if(P.allowedPoint&&(!P.allowedPoint(ns[id])||!P.allowedPoint({x:(ns[current].x+ns[id].x)/2,z:(ns[current].z+ns[id].z)/2})))continue;
        const c = cost.get(current) + manhattan(ns[current], ns[id]);
        if (c < (cost.get(id) ?? Infinity)) { previous.set(id, current); cost.set(id, c); open.add(id); }
      }
    }
    return [];
  };
  P.navigation = function (scene) {
    const material = P.material('gps-ribbon', { color: '#69cfb9', emissive: '#32b49a', emissiveIntensity: .8, transparent: true, opacity: .7, roughness: 1, depthWrite: false, side: T.DoubleSide });
    const mesh = new T.Mesh(new T.BufferGeometry(), material); mesh.renderOrder = 2; mesh.frustumCulled = false; scene.add(mesh);
    let route = [], previous = null, lastTarget = null;
    function update(player, goal, force = false) {
      if (!goal) { mesh.visible = false; return; }
      if (!force && previous && Math.hypot(player.x - previous.x, player.z - previous.z) < 9 && goal === lastTarget) return;
      route = P.route({ x: player.x, z: player.z }, goal); previous = { ...player }; lastTarget = goal;
      const pos = [];
      for (let i = 1; i < route.length; i++) {
        const a = route[i - 1], b = route[i], d = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / d * .22, nz = (b.x - a.x) / d * .22;
        pos.push(a.x + nx,.235,a.z + nz, a.x - nx,.235,a.z - nz, b.x + nx,.235,b.z + nz, a.x - nx,.235,a.z - nz, b.x - nx,.235,b.z - nz, b.x + nx,.235,b.z + nz);
      }
      mesh.geometry.dispose(); mesh.geometry = new T.BufferGeometry(); mesh.geometry.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); mesh.geometry.computeVertexNormals(); mesh.geometry.computeBoundingSphere(); mesh.visible = true;
    }
    function draw(canvas, player, goal, obstacles, traffic, large = false) {
      const ctx = canvas.getContext('2d'), size = canvas.width, center = size / 2, scale = large ? (size - 90) / 600 : size / 175, yaw = large ? 0 : player.yaw;
      const point = p => { const x = p.x - (large ? 0 : player.x), z = p.z - (large ? 0 : player.z); return [center + (x * Math.cos(yaw) - z * Math.sin(yaw)) * scale, center + (x * Math.sin(yaw) + z * Math.cos(yaw)) * scale]; };
      ctx.clearRect(0, 0, size, size); ctx.save();
      if (!large) { ctx.beginPath(); ctx.arc(center, center, center - 1, 0, Math.PI * 2); ctx.clip(); }
      ctx.fillStyle = '#a7b798'; ctx.fillRect(0, 0, size, size);
      const corners = [point({x:-320,z:204}),point({x:320,z:204}),point({x:320,z:217}),point({x:-320,z:217})];
      ctx.fillStyle = '#77a1a8'; ctx.beginPath(); corners.forEach((p, i) => i ? ctx.lineTo(...p) : ctx.moveTo(...p)); ctx.closePath(); ctx.fill();
      obstacles.forEach(o => {
        if (Math.hypot(o.x - (large ? 0 : player.x), o.z - (large ? 0 : player.z)) > (large ? 500 : 150)) return;
        ctx.fillStyle = '#d9ceba'; ctx.beginPath();
        [[o.x-o.hx,o.z-o.hz],[o.x+o.hx,o.z-o.hz],[o.x+o.hx,o.z+o.hz],[o.x-o.hx,o.z+o.hz]].forEach(([x,z],i) => i ? ctx.lineTo(...point({x,z})) : ctx.moveTo(...point({x,z}))); ctx.closePath(); ctx.fill();
      });
      for (const r of roads) for (const axis of ['x','z']) {
        ctx.strokeStyle = '#e3e3d5'; ctx.lineWidth = scale * 18; ctx.beginPath();
        ctx.moveTo(...point(axis === 'x' ? {x:-294,z:r} : {x:r,z:-294})); ctx.lineTo(...point(axis === 'x' ? {x:294,z:r} : {x:r,z:294})); ctx.stroke();
        ctx.strokeStyle = '#7a827d'; ctx.lineWidth = scale * 12; ctx.stroke();
      }
      if (route.length) {
        ctx.strokeStyle = '#143f37'; ctx.lineWidth = large ? 7 : 9; ctx.lineJoin = ctx.lineCap = 'round'; ctx.beginPath(); route.forEach((p,i) => i ? ctx.lineTo(...point(p)) : ctx.moveTo(...point(p))); ctx.stroke();
        ctx.strokeStyle = '#72e8c5'; ctx.lineWidth = large ? 4 : 5; ctx.stroke();
      }
      ctx.fillStyle = '#f6f1df'; traffic.filter(car => car.active).forEach(car => { ctx.beginPath(); ctx.arc(...point(car), 2.5, 0, Math.PI * 2); ctx.fill(); });
      if (large) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '700 28px system-ui';
        P.districts.forEach(d => { const p = point(d); ctx.fillStyle = '#fff9e8'; ctx.fillRect(p[0] - ctx.measureText(d.name).width / 2 - 12, p[1] - 16, ctx.measureText(d.name).width + 24, 32); ctx.fillStyle = '#29433b'; ctx.fillText(d.name, ...p); });
      }
      if(large&&P.mapTargets){for(const p of P.mapTargets()){const [x,y]=point(p);ctx.fillStyle='#ffbc42';ctx.beginPath();ctx.arc(x,y,9,0,Math.PI*2);ctx.fill();ctx.fillStyle='#21352e';ctx.font='bold 17px system-ui';ctx.textAlign='center';ctx.fillText(String(p.order),x,y-14);}}
      if (goal) {
        let [x,y] = point(goal), dx = x - center, dy = y - center, len = Math.hypot(dx,dy), edge = !large && len > center - 20;
        if (edge) { x = center + dx / len * (center - 18); y = center + dy / len * (center - 18); }
        ctx.save(); ctx.translate(x,y); ctx.fillStyle = '#f8c05c'; ctx.strokeStyle = '#4e4936'; ctx.lineWidth = 3; ctx.beginPath();
        if (edge) { ctx.rotate(Math.atan2(dy,dx) + Math.PI / 2); ctx.moveTo(0,-10); ctx.lineTo(8,8); ctx.lineTo(-8,8); ctx.closePath(); }
        else ctx.arc(0,0,large ? 9 : 8,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.restore();
      }
      ctx.save(); ctx.translate(...point(player)); ctx.rotate(large ? -player.yaw : 0); ctx.fillStyle = '#fff9e8'; ctx.strokeStyle = '#204e42'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0,-11); ctx.lineTo(7,8); ctx.lineTo(0,4); ctx.lineTo(-7,8); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); ctx.restore();
    }
    return { update, draw, mesh, get route() { return route; } };
  };
})(window.PX);
