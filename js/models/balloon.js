import * as THREE from 'three';
import { BALLOON } from '../config.js';
import { modelGeometry } from './library.js';

// A balloon: the envelope (built here: its gores take the pattern's colours), the basket with its crew and the
// burner (a Blender model), the flying wires and the flame. The origin is the basket floor. The envelope can
// lean over and collapse as the balloon is deflated on the ground. Few draw calls: the envelope, the basket,
// the wires, the flame.
const GORES = 24;
const PROFILE = BALLOON.profile;
// Envelope patterns: alternating gores, a band round the equator, the crown. The first one is the player's.
export const PATTERNS = [
  { gores: ['#d6362c', '#f2c230'], band: '#f6f1e4', crown: '#d6362c' },
  { gores: ['#2f6fb5', '#f6f1e4'], band: '#2f6fb5', crown: '#2f6fb5' },
  { gores: ['#3f9a4a', '#f2c230', '#3f9a4a', '#f6f1e4'], band: '#24313d', crown: '#3f9a4a' },
  { gores: ['#7d3fa0', '#ef8a2f'], band: '#f6f1e4', crown: '#7d3fa0' },
  { gores: ['#1c8f8f', '#f6f1e4', '#1c8f8f', '#e77fb0'], band: '#1c8f8f', crown: '#f6f1e4' },
  { gores: ['#f08a24'], band: '#24313d', crown: '#24313d' },
  { gores: ['#24313d', '#f2c230'], band: '#f2c230', crown: '#24313d' },
  { gores: ['#e77fb0', '#ffffff'], band: '#d6362c', crown: '#e77fb0' },
  { gores: ['#c8382c', '#2f6fb5', '#f6f1e4'], band: '#f6f1e4', crown: '#2f6fb5' },
  { gores: ['#8fbf3a', '#2f6fb5'], band: '#f6f1e4', crown: '#8fbf3a' },
  { gores: ['#ffffff', '#d6362c'], band: '#2f6fb5', crown: '#d6362c' },
  { gores: ['#5a3a8a', '#5a3a8a', '#f2c230'], band: '#f2c230', crown: '#5a3a8a' },
];
const MOUTH = '#2b2b2b';
const TAPE = 0.955;      // the load tapes between the gores pull the fabric in: each gore bulges between them

// The envelope from its profile: rings of 2 × GORES vertices (a seam, a gore's middle, …), each gore a bulging
// panel in the pattern's colour, a band round the equator, the crown, the dark mouth and a skirt below it.
function envelope(pattern) {
  // the profile, refined: a ring every metre or so
  const prof = [];
  for (let k = 0; k < PROFILE.length - 1; k++) {
    const [r0, y0] = PROFILE[k], [r1, y1] = PROFILE[k + 1];
    const n = Math.max(1, Math.round((y1 - y0) / 1.3));
    for (let i = 0; i < n; i++) prof.push([r0 + (r1 - r0) * i / n, y0 + (y1 - y0) * i / n]);
  }
  prof.unshift([1.62, -1.1], [1.55, -0.2]);       // the skirt
  prof.push(PROFILE[PROFILE.length - 1]);
  const N = GORES * 2, pos = [], col = [], c = new THREE.Color();
  const ring = (r, y) => Array.from({ length: N }, (_, i) => {
    const a = (i / N) * Math.PI * 2, f = i % 2 === 0 ? TAPE : 1;
    return [Math.cos(a) * r * f, y, Math.sin(a) * r * f];
  });
  const rings = prof.map(([r, y]) => ring(r, y));
  const colour = (gore, y) => {
    if (y < 0) return pattern.band;
    if (y < 1.2) return MOUTH;
    if (y > 9.0 && y < 11.0) return pattern.band;
    if (y > 17.2) return pattern.crown;
    return pattern.gores[gore % pattern.gores.length];
  };
  const tri = (p, q, r, hex) => {
    pos.push(...p, ...q, ...r);
    c.set(hex);
    for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b);
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const A = rings[k], B = rings[k + 1], y = (prof[k][1] + prof[k + 1][1]) / 2;
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N, hex = colour(Math.floor(i / 2), y);
      tri(A[i], B[j], A[j], hex);
      tri(A[i], B[i], B[j], hex);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function ropes() {
  const pts = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const cx = Math.sign(Math.round(Math.cos(a) * 10)) * 0.45, cz = Math.sign(Math.round(Math.sin(a) * 10)) * 0.45;
    pts.push(cx, 2.42, cz, Math.cos(a) * 1.5, BALLOON.mouth + 0.05, Math.sin(a) * 1.5);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return geo;
}

// shared by every balloon
let shared = null;
function sharedParts() {
  if (shared) return shared;
  const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  shared = {
    envMat: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    bodyGeo: modelGeometry('basket'),
    bodyMat: new THREE.MeshLambertMaterial({ vertexColors: true }),
    ropeGeo: ropes(),
    ropeMat: new THREE.LineBasicMaterial({ color: '#2a2622' }),
    outerGeo: new THREE.ConeGeometry(0.42, 3.2, 10, 1, true).translate(0, 1.6, 0),
    outerMat: additive('#ffa53a', 0.85),
    coreGeo: new THREE.ConeGeometry(0.2, 1.6, 8, 1, true).translate(0, 0.8, 0),
    coreMat: additive('#7fb4ff', 0.9),
    envelopes: PATTERNS.map(envelope),
  };
  return shared;
}

// pattern: an index into PATTERNS; glow: a light inside the envelope while burning (only the player's).
export function createBalloon(pattern = 0, glow = true) {
  const S = sharedParts();
  const group = new THREE.Group();

  // the envelope leans and collapses around its mouth
  const env = new THREE.Group();
  env.position.y = BALLOON.mouth;
  const envMesh = new THREE.Mesh(S.envelopes[pattern % PATTERNS.length], S.envMat);
  env.add(envMesh);
  const lines = new THREE.LineSegments(S.ropeGeo, S.ropeMat);
  group.add(env, new THREE.Mesh(S.bodyGeo, S.bodyMat), lines);

  // the flame: an orange outer cone and a blue core, additive
  const flame = new THREE.Group();
  flame.position.y = 2.85;
  flame.add(new THREE.Mesh(S.outerGeo, S.outerMat), new THREE.Mesh(S.coreGeo, S.coreMat));
  flame.visible = false;
  group.add(flame);
  let light = null;
  if (glow) {
    light = new THREE.PointLight('#ffb050', 0, 30, 1.5);
    light.position.y = 6;
    group.add(light);
  }
  group.userData = { env, envMesh, flame, light, lines, flicker: 0 };
  return group;
}

// Per frame: the flame (burn, vapour: the weak last burn), the deflation (0–1) leaning downwind (heading).
export function updateBalloon(model, { burn, vapour, deflate, heading, t }) {
  const u = model.userData;
  const power = burn ? 1 : vapour ? 0.3 : 0;
  u.flicker += (power - u.flicker) * 0.35;
  u.flame.visible = u.flicker > 0.03;
  if (u.flame.visible) {
    const f = u.flicker * (0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31));
    u.flame.scale.set(0.8 + 0.2 * f, f, 0.8 + 0.2 * f);
  }
  if (u.light) u.light.intensity = u.flicker * 6;
  // lean over downwind and collapse
  const d = deflate;
  u.env.rotation.set(0, 0, 0);
  u.env.rotateY(-heading);
  u.env.rotateX(-d * 1.38);
  u.envMesh.scale.set(1 + d * 0.15, 1 - d * 0.82, 1 + d * 0.15);
  u.lines.visible = d < 0.3;
}
