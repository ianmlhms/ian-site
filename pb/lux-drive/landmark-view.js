/* The landmarks in the scene: one mesh per landmark (so a landmark out of view costs no draw call), all with the shared
 * solid material (vertex colours + the painted light of the game).  The soups come from landmarks.js. */
const THREE = window.THREE;

export function createLandmarkView({ scene, landmarks, material }) {
  const group = new THREE.Group();
  group.name = 'luxdrive-landmarks';
  const meshes = [];
  let triangles = 0;
  for (const lm of landmarks.list) {
    const s = lm.soup;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
    geometry.setIndex(s.idx.length > 65535 ? new THREE.Uint32BufferAttribute(s.idx, 1) : new THREE.Uint16BufferAttribute(s.idx, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `landmark ${lm.id}`;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    meshes.push(mesh);
    triangles += s.triangleCount;
  }
  scene.add(group);
  return { group, meshes, triangles, count: meshes.length };
}
