import * as THREE from 'three';
import { MODELS } from '../models/library.js';
import { DIMS } from '../models/dims.js';

// The building kit shared by every country's view: a builder of merged, vertex-coloured, flat-shaded triangle
// lists (one draw call per chunk) that places the Blender models, and the trees and cows drawn from terrain data.

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

  // A Blender model (js/models/library.js), turned by yaw about Y, scaled, moved to (x, y, z).
  model(name, x, y, z, yaw = 0, sx = 1, sy = 1, sz = 1) {
    const m = MODELS[name];
    if (!m) return;
    const c = Math.cos(yaw), s = Math.sin(yaw), P = m.pos, C = m.col;
    for (let i = 0; i < P.length; i += 3) {
      const lx = P[i] * sx, ly = P[i + 1] * sy, lz = P[i + 2] * sz;
      this.p.push(x + lx * c + lz * s, y + ly, z - lx * s + lz * c);
      this.c.push(C[i], C[i + 1], C[i + 2]);
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

// A tree from terrain data: { x, z, y (ground, default 0), base, top, r, shade, kind: round | poplar | pine | cypress |
// olive, low: one of many in a wood – the cheaper model }, drawn with its Blender model scaled to its size.
const TREE_MODELS = { round: 'tree_round', poplar: 'tree_poplar', pine: 'tree_pine', cypress: 'tree_cypress', olive: 'tree_olive' };
const LOW_MODELS = { round: 'tree_round_low', pine: 'tree_pine_low', olive: 'tree_olive_low', cypress: 'tree_pine_low', poplar: 'tree_round_low' };

// far: a chunk far away – every tree the cheap model, and only every other tree of a wood (a little bigger).
export function drawTree(bld, t, far = false) {
  if (far && t.low && t.shade < 0.5) return;
  const name = (t.low || far ? LOW_MODELS : TREE_MODELS)[t.kind] ?? 'tree_round';
  const d = DIMS[name], y = t.y ?? 0, s = (t.r / d.r) * (far && t.low ? 1.3 : 1);
  bld.model(name, t.x, y, t.z, t.shade * Math.PI * 2, s, (t.top - y) / d.h, s);
}

const COWS = ['cow_bw', 'cow_black', 'cow_brown'];

// A cow: black-and-white, black or brown, grazing this way or that.
export function drawCow(bld, c) {
  bld.model(COWS[c.coat], c.x, c.y ?? 0, c.z, (c.turn ? Math.PI / 2 : 0) + ((c.x * 7.3 + c.z * 3.1) % 1.2) - 0.6);
}
