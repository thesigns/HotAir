import * as THREE from 'three';

// The building kit shared by every country's view: a builder of merged, vertex-coloured, flat-shaded triangle
// lists (one draw call per chunk), unit shapes, and the trees, houses and cows drawn from terrain data.

export const _c = new THREE.Color();
export const _d = new THREE.Color();

// Unit shapes, as flat triangle lists.
function template(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const a = Float32Array.from(g.attributes.position.array);
  geo.dispose();
  if (g !== geo) g.dispose();
  return a;
}
export const ROUND = template(new THREE.IcosahedronGeometry(1, 0));
// a cheaper crown for the many trees of a wood or a grove
export const ROUND_LOW = template(new THREE.OctahedronGeometry(1, 0));
export const CONE = template(new THREE.ConeGeometry(1, 1, 6, 1, true).translate(0, 0.5, 0));
export const TRUNK = template(new THREE.CylinderGeometry(0.18, 0.26, 1, 5, 1, true).translate(0, 0.5, 0));
export const TOWER = template(new THREE.CylinderGeometry(0.55, 1, 1, 8, 1, true).translate(0, 0.5, 0));
export const BOX = template(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
export const PYRAMID = template(new THREE.ConeGeometry(1, 1, 4, 1, true).rotateY(Math.PI / 4).translate(0, 0.5, 0));

export class Builder {
  constructor() { this.p = []; this.c = []; }

  tri(ax, ay, az, bx, by, bz, cx, cy, cz, col) {
    this.p.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) this.c.push(col.r, col.g, col.b);
  }

  // A horizontal rectangle facing up.
  flat(x0, z0, x1, z1, y, col) {
    if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return;
    this.tri(x0, y, z0, x0, y, z1, x1, y, z1, col);
    this.tri(x0, y, z0, x1, y, z1, x1, y, z0, col);
  }

  // A vertical wall from (x0, z0) to (x1, z1), between y0 and y1.
  wall(x0, z0, x1, z1, y0, y1, col) {
    this.tri(x0, y0, z0, x1, y0, z1, x1, y1, z1, col);
    this.tri(x0, y0, z0, x1, y1, z1, x0, y1, z0, col);
  }

  shape(tpl, x, y, z, sx, sy, sz, col, jitter = 0, rnd = null) {
    for (let i = 0; i < tpl.length; i += 9) {
      if (jitter) _d.copy(col).multiplyScalar(1 - jitter + rnd() * jitter * 2);
      const cc = jitter ? _d : col;
      this.tri(
        x + tpl[i] * sx, y + tpl[i + 1] * sy, z + tpl[i + 2] * sz,
        x + tpl[i + 3] * sx, y + tpl[i + 4] * sy, z + tpl[i + 5] * sz,
        x + tpl[i + 6] * sx, y + tpl[i + 7] * sy, z + tpl[i + 8] * sz, cc,
      );
    }
  }

  get empty() { return this.p.length === 0; }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }
}

export const shadeOf = (list, s) => _c.set(list[Math.floor(s * list.length) % list.length]);

export const TREE_COLORS = {
  trunk: '#5a4632',
  crowns: ['#4d7a34', '#5a8a3a', '#3f6b2e', '#628f3f'],
  pine: ['#33572d', '#3d6334'],
  cypress: ['#2c4a26', '#33532b'],
  olive: ['#8a9a6a', '#97a676', '#7d8e60'],
};

// A tree from terrain data: { x, z, y (ground, default 0), base, top, r, kind: round | poplar | pine | cypress | olive,
// low: one of many in a wood – a cheaper crown and no trunk }.
export function drawTree(bld, t, rnd, colors = TREE_COLORS) {
  const y = t.y ?? 0, crownH = t.top - t.base;
  if (t.low && (t.kind === 'pine' || t.kind === 'cypress')) {
    bld.shape(CONE, t.x, t.y ?? 0, t.z, t.r, t.top - (t.y ?? 0), t.r, shadeOf(colors[t.kind], t.shade), 0.06, rnd);
    return;
  }
  if (t.low) {
    const sy = crownH / 2;
    bld.shape(ROUND_LOW, t.x, t.base + sy, t.z, t.r, sy, t.r, shadeOf(t.kind === 'olive' ? colors.olive : colors.crowns, t.shade), 0.08, rnd);
    return;
  }
  bld.shape(TRUNK, t.x, y, t.z, 1, t.base - y + crownH * 0.3, 1, _c.set(colors.trunk));
  if (t.kind === 'pine' || t.kind === 'cypress') {
    bld.shape(CONE, t.x, t.base, t.z, t.r, crownH, t.r, shadeOf(colors[t.kind], t.shade), 0.06, rnd);
  } else {
    const sy = crownH / 2;
    bld.shape(ROUND, t.x, t.base + sy, t.z, t.r, sy, t.r, shadeOf(t.kind === 'olive' ? colors.olive : colors.crowns, t.shade), 0.08, rnd);
  }
}

// A house from terrain data: an axis-aligned box from y (the ground, default 0) with a gable roof whose ridge
// runs along ridgeAxis; or a tower with a spire (kind 'tower').
export function drawHouse(bld, h) {
  const { x0, x1, z0, z1 } = h;
  const y0 = h.y ?? 0, wall = y0 + h.wall, ridge = y0 + h.ridge;
  // walls reach a little below the ground on a slope
  const yb = y0 - (h.sink ?? 0);
  if (h.kind === 'tower') {
    bld.shape(BOX, (x0 + x1) / 2, yb, (z0 + z1) / 2, x1 - x0, wall - yb, z1 - z0, _c.set(h.wallColor));
    bld.shape(PYRAMID, (x0 + x1) / 2, wall, (z0 + z1) / 2, (x1 - x0) * 0.72, h.spire - h.wall, (z1 - z0) * 0.72, _c.set(h.spireColor ?? '#2f4f4a'));
    return;
  }
  const col = _c.set(h.wallColor);
  bld.wall(x0, z1, x0, z0, yb, wall, col);
  bld.wall(x1, z0, x1, z1, yb, wall, col);
  bld.wall(x0, z0, x1, z0, yb, wall, col);
  bld.wall(x1, z1, x0, z1, yb, wall, col);
  const roof = _d.set(h.roof);
  const o = 0.5;   // eaves
  if (h.ridgeAxis === 'z') {
    const xm = (x0 + x1) / 2;
    // gable ends
    bld.tri(x0, wall, z0, x1, wall, z0, xm, ridge, z0, col);
    bld.tri(x1, wall, z1, x0, wall, z1, xm, ridge, z1, col);
    // roof planes
    bld.tri(x0 - o, wall - 0.3, z0 - o, xm, ridge, z0 - o, xm, ridge, z1 + o, roof);
    bld.tri(x0 - o, wall - 0.3, z0 - o, xm, ridge, z1 + o, x0 - o, wall - 0.3, z1 + o, roof);
    bld.tri(x1 + o, wall - 0.3, z1 + o, xm, ridge, z1 + o, xm, ridge, z0 - o, roof);
    bld.tri(x1 + o, wall - 0.3, z1 + o, xm, ridge, z0 - o, x1 + o, wall - 0.3, z0 - o, roof);
  } else {
    const zm = (z0 + z1) / 2;
    bld.tri(x0, wall, z1, x0, wall, z0, x0, ridge, zm, col);
    bld.tri(x1, wall, z0, x1, wall, z1, x1, ridge, zm, col);
    bld.tri(x1 + o, wall - 0.3, z0 - o, x0 - o, wall - 0.3, z0 - o, x0 - o, ridge, zm, roof);
    bld.tri(x1 + o, wall - 0.3, z0 - o, x0 - o, ridge, zm, x1 + o, ridge, zm, roof);
    bld.tri(x0 - o, wall - 0.3, z1 + o, x1 + o, wall - 0.3, z1 + o, x1 + o, ridge, zm, roof);
    bld.tri(x0 - o, wall - 0.3, z1 + o, x1 + o, ridge, zm, x0 - o, ridge, zm, roof);
  }
}

const COWS = [['#1d1d1d', '#f4f2ec'], ['#f4f2ec', '#1d1d1d'], ['#7a4a2a', '#f4f2ec']];

// A cow: a body, a patch and a head – black-and-white or brown.
export function drawCow(bld, c) {
  const [coat, patch] = COWS[c.coat];
  const y = c.y ?? 0;
  const sx = c.turn ? 2.2 : 0.8, sz = c.turn ? 0.8 : 2.2;
  bld.shape(BOX, c.x, y + 0.55, c.z, sx, 0.75, sz, _c.set(coat));
  bld.shape(BOX, c.x + (c.turn ? 0.3 : 0), y + 1.05, c.z + (c.turn ? 0 : 0.3), c.turn ? 0.8 : 0.7, 0.3, c.turn ? 0.7 : 0.8, _c.set(patch));
  const hx = c.turn ? c.x + 1.25 : c.x, hz = c.turn ? c.z : c.z + 1.25;
  bld.shape(BOX, hx, y + 0.85, hz, 0.45, 0.45, 0.45, _c.set(coat));
}
