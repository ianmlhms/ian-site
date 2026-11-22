/* R8g: the look of a safety net (the challenge course's orange B-nets, the race piste's red A-nets): a see-through mesh texture, not a
 * coloured wall (Ian, iPad: "an opaque red wall"). One tile = one metre along the net; `rows` mesh cells across its height. Close up the
 * diamonds and the snow behind them show; far off the mipmaps average the holes into a light, see-through tint. One material per net
 * kind, transparent without depth writes (one mesh per kind, so nothing to sort but the net itself). */
const THREE = typeof window !== 'undefined' ? window.THREE : null;

/** A canvas of `cells` x `rows` diamonds per tile: thick coloured strands on a transparent ground, an optional top rope (band). */
function netCanvas({ color, cells, rows, band }) {
  const W = 128, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  g.strokeStyle = color; g.lineWidth = 3; g.lineCap = 'square';
  const cw = W / cells, ch = (band ? H - 10 : H) / rows, y0 = band ? 10 : 0;
  g.beginPath();
  // diamonds: two families of diagonals through the cell corners (they meet the tile edges at the same spots: it tiles along u)
  for (let k = -rows; k <= cells + rows; k++) {
    g.moveTo(k * cw, y0); g.lineTo(k * cw + rows * cw, y0 + rows * ch);
    g.moveTo(k * cw, y0); g.lineTo(k * cw - rows * cw, y0 + rows * ch);
  }
  g.stroke();
  if (band) { g.fillStyle = band; g.fillRect(0, 0, W, 10); }                 // the top rope / white edge band (v = 1)
  return c;
}

/** The material of a net kind: { color '#rrggbb', cells (diamonds per tile along), rows (diamonds per tile across), band (css colour or
 *  null) }. With a band the tile spans the net's height once (v 0 .. 1); without one it repeats (v in metres, like u). */
export function createNetMaterial({ color, cells = 4, rows = 4, band = null }) {
  const tex = new THREE.CanvasTexture(netCanvas({ color, cells, rows, band }));
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = band ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;      // no band: v in metres too
  tex.anisotropy = 4;
  const emissive = new THREE.Color(color).multiplyScalar(0.28);      // still reads as a coloured net in the shade, never as a dark wall
  return new THREE.MeshLambertMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, emissive, alphaTest: 0.02 });
}
