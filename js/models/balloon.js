import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BALLOON } from '../config.js';

// A balloon: a lathed envelope with bold gores, the basket with four people, the burner frame, the ropes and
// the flame. The origin is the basket floor. The envelope can lean over and collapse as the balloon is deflated
// on the ground. Few draw calls: the envelope, the rest of the body merged into one mesh, the ropes, the flame.
const GORES = 16;
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

function envelope(pattern) {
  const pts = PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, GORES).toNonIndexed();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 3) {
    // the triangle's centre decides its colour
    let x = 0, y = 0, z = 0;
    for (let k = 0; k < 3; k++) { x += pos.getX(i + k); y += pos.getY(i + k); z += pos.getZ(i + k); }
    x /= 3; y /= 3; z /= 3;
    const gore = Math.floor(((Math.atan2(z, x) / (Math.PI * 2) + 1) % 1) * GORES);
    if (y < 1.2) c.set(MOUTH);
    else if (y > 9.2 && y < 11.2) c.set(pattern.band);
    else if (y > 17.3) c.set(pattern.crown);
    else c.set(pattern.gores[gore % pattern.gores.length]);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// A primitive with one vertex colour, placed, ready to merge.
function part(geo, color, x, y, z) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.translate(x, y, z);
  const c = new THREE.Color(color), n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.toArray(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
  return g;
}

// The basket with four people, the burner frame and coil: one geometry, shared by every balloon.
function body() {
  const s = BALLOON.basket;
  const parts = [
    part(new THREE.BoxGeometry(s, s * 0.92, s), '#9a7442', 0, s * 0.46, 0),
    part(new THREE.BoxGeometry(s + 0.08, 0.12, s + 0.08), '#5b3a22', 0, s * 0.92, 0),
    part(new THREE.BoxGeometry(0.9, 0.18, 0.9), '#3a3a3c', 0, 2.45, 0),
    part(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 10), '#9a9a9a', 0, 2.7, 0),
  ];
  const skin = ['#e0b48c', '#c98f63', '#f0c7a0', '#8d5a3b'];
  const coats = ['#2f5d8c', '#c8382c', '#3f7a3a', '#e0a020'];
  for (let k = 0; k < 4; k++) {
    const qx = (k % 2 ? 1 : -1) * s * 0.24, qz = (k < 2 ? 1 : -1) * s * 0.24;
    parts.push(part(new THREE.BoxGeometry(0.34, 0.5, 0.26), coats[k], qx, s * 0.92 + 0.12, qz));
    parts.push(part(new THREE.IcosahedronGeometry(0.13, 0), skin[k], qx, s * 0.92 + 0.5, qz));
  }
  const geo = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  geo.computeVertexNormals();
  return geo;
}

function ropes() {
  const s = BALLOON.basket, pts = [];
  // the burner poles
  for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) pts.push(px * s * 0.45, s * 0.92, pz * s * 0.45, px * 0.4, 2.4, pz * 0.4);
  // the ropes from the basket corners to the mouth
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const cx = Math.sign(Math.cos(a)) * s * 0.48, cz = Math.sign(Math.sin(a)) * s * 0.48;
    pts.push(cx, s * 0.92, cz, Math.cos(a) * 1.45, BALLOON.mouth + 0.1, Math.sin(a) * 1.45);
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
    bodyGeo: body(),
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
