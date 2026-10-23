import { DIMS } from './dims.js';

// Placing a Blender model in the terrain data (pure – no Three.js, the Node tools use it too): what to draw
// (`props`: { m, x, y, z, yaw }) and what to collide with (`houses`: the model's parts, turned by the yaw –
// a multiple of a quarter turn – and standing on the ground at y).

const QUARTER = Math.PI / 2;

// The part's footprint turned by `yaw` about the model's origin, then moved to (x, z).
function turned(p, x, z, yaw) {
  const q = ((Math.round(yaw / QUARTER) % 4) + 4) % 4;
  // rotation.y = yaw maps local (lx, lz) to (lx cos + lz sin, −lx sin + lz cos)
  const c = [1, 0, -1, 0][q], s = [0, 1, 0, -1][q];
  const xs = [], zs = [];
  for (const [lx, lz] of [[p.x0, p.z0], [p.x1, p.z0], [p.x0, p.z1], [p.x1, p.z1]]) {
    xs.push(x + lx * c + lz * s);
    zs.push(z - lx * s + lz * c);
  }
  const axis = q % 2 === 0 ? p.axis : p.axis === 'x' ? 'z' : 'x';
  return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), axis };
}

// The model's footprint at (x, z) turned by yaw: { x0, x1, z0, z1 } over all its parts.
export function footprint(name, x, z, yaw) {
  const r = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const p of DIMS[name].parts) {
    const t = turned(p, x, z, yaw);
    r.x0 = Math.min(r.x0, t.x0); r.x1 = Math.max(r.x1, t.x1);
    r.z0 = Math.min(r.z0, t.z0); r.z1 = Math.max(r.z1, t.z1);
  }
  return r;
}

// Place a building: `into` gets the prop and the collision boxes (`{ houses, props }`, a block); y is the
// ground it stands on; kind marks the boxes (pylon | mill | glass … for the crash messages).
export function place(into, name, x, z, yaw, y = 0, kind = undefined) {
  into.props.push({ m: name, x, y, z, yaw });
  for (const p of DIMS[name].parts) {
    const t = turned(p, x, z, yaw);
    into.houses.push({ x0: t.x0, x1: t.x1, z0: t.z0, z1: t.z1, wall: p.wall, ridge: p.ridge, ridgeAxis: t.axis, y, kind });
  }
}

export const dims = (name) => DIMS[name];
