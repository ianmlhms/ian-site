import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#bcd6ea');
    this.scene.fog = new THREE.Fog('#bcd6ea', 60, 220);

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
    this.camera.position.set(18, 14, 22);

    this.hemi = new THREE.HemisphereLight('#e8f0ff', '#6b7a5a', 0.65);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff4e0', 1.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -40;
    this.sun.shadow.camera.right = 40;
    this.sun.shadow.camera.top = 40;
    this.sun.shadow.camera.bottom = -40;
    this.sun.shadow.camera.far = 150;
    this.sun.shadow.bias = -0.0015;
    this.setSunDirection({ x: -0.5, y: 1, z: -0.3 });
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.content = new THREE.Group();
    this.scene.add(this.content);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.49;
    this.orbit.minDistance = 3;
    this.orbit.maxDistance = 150;

    this.walkState = null; // { keys:Set, yaw, pitch, height }
    this._bindWalkEvents();

    this._raf = null;
    this._loop();

    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this.resize();
  }

  setSunDirection(dir) {
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    this.sun.position.set((dir.x / len) * 40, Math.max(5, (dir.y / len) * 40), (dir.z / len) * 40);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();
  }

  setContent(object3d) {
    this.content.clear();
    this.content.add(object3d);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = parent ? parent.clientWidth : this.canvas.clientWidth;
    const h = parent ? parent.clientHeight : this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMode(mode, focusPoint) {
    this.mode = mode;
    this.orbit.enabled = mode !== 'walk';
    if (mode === 'walk') {
      this.walkState = { keys: new Set(), yaw: 0, pitch: 0, height: 1.65 };
      if (focusPoint) this.camera.position.set(focusPoint.x, this.walkState.height, focusPoint.z);
      this.canvas.requestPointerLock?.();
    } else {
      document.exitPointerLock?.();
      this.walkState = null;
    }
  }

  _bindWalkEvents() {
    this._keydown = (e) => { if (this.walkState) this.walkState.keys.add(e.code); };
    this._keyup = (e) => { if (this.walkState) this.walkState.keys.delete(e.code); };
    this._mousemove = (e) => {
      if (!this.walkState) return;
      if (document.pointerLockElement !== this.canvas) return;
      this.walkState.yaw -= e.movementX * 0.0025;
      this.walkState.pitch = Math.max(-1.3, Math.min(1.3, this.walkState.pitch - e.movementY * 0.0025));
    };
    document.addEventListener('keydown', this._keydown);
    document.addEventListener('keyup', this._keyup);
    document.addEventListener('mousemove', this._mousemove);
    this.canvas.addEventListener('click', () => { if (this.walkState) this.canvas.requestPointerLock?.(); });
  }

  _updateWalk() {
    const ws = this.walkState;
    if (!ws) return;
    const speed = (ws.keys.has('ShiftLeft') ? 4.5 : 2.2) / 60;
    const forward = new THREE.Vector3(Math.sin(ws.yaw), 0, Math.cos(ws.yaw));
    const right = new THREE.Vector3(Math.cos(ws.yaw), 0, -Math.sin(ws.yaw));
    const move = new THREE.Vector3();
    if (ws.keys.has('KeyW') || ws.keys.has('ArrowUp')) move.sub(forward);
    if (ws.keys.has('KeyS') || ws.keys.has('ArrowDown')) move.add(forward);
    if (ws.keys.has('KeyA') || ws.keys.has('ArrowLeft')) move.sub(right);
    if (ws.keys.has('KeyD') || ws.keys.has('ArrowRight')) move.add(right);
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed);
    this.camera.position.add(move);
    this.camera.position.y = ws.height;

    const lookDir = new THREE.Vector3(-Math.sin(ws.yaw) * Math.cos(ws.pitch), Math.sin(ws.pitch), -Math.cos(ws.yaw) * Math.cos(ws.pitch));
    this.camera.lookAt(this.camera.position.clone().add(lookDir));
  }

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    if (this.mode === 'walk') this._updateWalk();
    else this.orbit.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    document.removeEventListener('keydown', this._keydown);
    document.removeEventListener('keyup', this._keyup);
    document.removeEventListener('mousemove', this._mousemove);
    document.exitPointerLock?.();
    this.orbit.dispose();
    this.renderer.dispose();
  }
}
