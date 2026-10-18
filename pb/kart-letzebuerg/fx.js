/* Kart Lëtzebuerg — pooled point-sprite particles (sparks, flames, smoke, dust, explosions, confetti, rain splashes). */
(function () {
  'use strict';
  const KL = window.KL, T = window.THREE;
  const VS = `
    attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vColor;
    void main(){ vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=min(aSize*uScale/max(-mv.z,0.5),180.0); gl_Position=projectionMatrix*mv; }`;
  const FS = `
    uniform sampler2D uMap; varying vec4 vColor;
    void main(){ vec4 t=texture2D(uMap,gl_PointCoord); gl_FragColor=vec4(vColor.rgb,vColor.a*t.a); if(gl_FragColor.a<0.01) discard; }`;

  class Particles {
    constructor(max, additive) {
      this.max = max; this.next = 0;
      this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
      this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
      this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.c0 = new Float32Array(max * 4); this.drag = new Float32Array(max); this.grav = new Float32Array(max);
      const g = new T.BufferGeometry();
      this.pa = new T.BufferAttribute(this.pos, 3); this.ca = new T.BufferAttribute(this.col, 4); this.sa = new T.BufferAttribute(this.size, 1);
      this.pa.setUsage(T.DynamicDrawUsage); this.ca.setUsage(T.DynamicDrawUsage); this.sa.setUsage(T.DynamicDrawUsage);
      g.setAttribute('position', this.pa); g.setAttribute('aColor', this.ca); g.setAttribute('aSize', this.sa);
      this.material = new T.ShaderMaterial({
        vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending, uniforms: { uMap: { value: KL.tex.spark() }, uScale: { value: 600 } },
      });
      this.points = new T.Points(g, this.material); this.points.frustumCulled = false; this.points.renderOrder = additive ? 6 : 5;
    }
    spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, a, drag, grav) {
      const i = this.next; this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.life[i] = life; this.maxLife[i] = life; this.s0[i] = s0; this.s1[i] = s1;
      this.c0[i * 4] = r; this.c0[i * 4 + 1] = g; this.c0[i * 4 + 2] = b; this.c0[i * 4 + 3] = a;
      this.drag[i] = drag || 0; this.grav[i] = grav || 0;
    }
    update(dt, scale) {
      this.material.uniforms.uScale.value = scale;
      for (let i = 0; i < this.max; i++) {
        if (this.life[i] <= 0) { this.size[i] = 0; this.col[i * 4 + 3] = 0; continue; }
        this.life[i] -= dt;
        const k = Math.max(0, this.life[i] / this.maxLife[i]), dr = Math.exp(-this.drag[i] * dt);
        this.vel[i * 3] *= dr; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - this.grav[i] * dt; this.vel[i * 3 + 2] *= dr;
        this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
        this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * k;
        this.col[i * 4] = this.c0[i * 4]; this.col[i * 4 + 1] = this.c0[i * 4 + 1]; this.col[i * 4 + 2] = this.c0[i * 4 + 2]; this.col[i * 4 + 3] = this.c0[i * 4 + 3] * Math.min(1, k * 2.2);
      }
      this.pa.needsUpdate = true; this.ca.needsUpdate = true; this.sa.needsUpdate = true;
    }
  }
  KL.Particles = Particles;
})();
