import * as THREE from 'three';
import { BALLOON } from '../config.js';

// The player's balloon: a lathed envelope with bold gores, the basket with four people, the burner frame,
// the ropes and the flame. The origin is the basket floor. The envelope can lean over and collapse as the
// balloon is deflated on the ground.
const GORES = 16;
// the envelope's profile from the mouth to the crown: [radius, height above the basket floor]
const PROFILE = [
  [1.5, 0], [3.0, 1.5], [5.4, 4.0], [7.1, 7.0], [7.8, 10.0], [7.6, 12.6], [6.6, 15.1], [4.6, 17.0], [2.2, 18.0], [0.01, 18.3],
];
const PATTERN = {
  gores: ['#d6362c', '#f2c230'],   // alternating gores
  band: '#f6f1e4',                 // a band round the equator
  crown: '#d6362c',
  mouth: '#2b2b2b',                // the scoop at the bottom
};

function envelope() {
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
    if (y < 1.2) c.set(PATTERN.mouth);
    else if (y > 9.2 && y < 11.2) c.set(PATTERN.band);
    else if (y > 17.3) c.set(PATTERN.crown);
    else c.set(PATTERN.gores[gore % PATTERN.gores.length]);
    for (let k = 0; k < 3; k++) c.toArray(colors, (i + k) * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createBalloon() {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const plain = (color) => new THREE.MeshLambertMaterial({ color });

  // the envelope leans and collapses around its mouth
  const env = new THREE.Group();
  env.position.y = BALLOON.mouth;
  const envMesh = new THREE.Mesh(envelope(), mat);
  env.add(envMesh);
  group.add(env);

  // the basket: wicker with a leather rim, four people
  const s = BALLOON.basket;
  const basket = new THREE.Group();
  const wicker = new THREE.Mesh(new THREE.BoxGeometry(s, s * 0.92, s), plain('#9a7442'));
  wicker.position.y = s * 0.46;
  const rim = new THREE.Mesh(new THREE.BoxGeometry(s + 0.08, 0.12, s + 0.08), plain('#5b3a22'));
  rim.position.y = s * 0.92;
  basket.add(wicker, rim);
  const skin = ['#e0b48c', '#c98f63', '#f0c7a0', '#8d5a3b'];
  const coats = ['#2f5d8c', '#c8382c', '#3f7a3a', '#e0a020'];
  for (let k = 0; k < 4; k++) {
    const qx = (k % 2 ? 1 : -1) * s * 0.24, qz = (k < 2 ? 1 : -1) * s * 0.24;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.5, 0.26), plain(coats[k]));
    body.position.set(qx, s * 0.92 + 0.12, qz);
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), plain(skin[k]));
    head.position.set(qx, s * 0.92 + 0.5, qz);
    basket.add(body, head);
  }
  group.add(basket);

  // the burner frame on its poles, the cylinders' hoses abstracted away
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 0.9), plain('#3a3a3c'));
  frame.position.y = 2.45;
  const coil = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.32, 10), plain('#9a9a9a'));
  coil.position.y = 2.7;
  group.add(frame, coil);
  const poles = [];
  for (const [px, pz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    poles.push(px * s * 0.45, s * 0.92, pz * s * 0.45, px * 0.4, 2.4, pz * 0.4);
  }
  // the ropes from the basket corners to the mouth
  const rope = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const cx = Math.sign(Math.cos(a)) * s * 0.48, cz = Math.sign(Math.sin(a)) * s * 0.48;
    rope.push(cx, s * 0.92, cz, Math.cos(a) * 1.45, BALLOON.mouth + 0.1, Math.sin(a) * 1.45);
  }
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([...poles, ...rope], 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: '#2a2622' }));
  group.add(lines);

  // the flame: an orange outer cone and a blue core, additive; a tiny pilot light
  const flame = new THREE.Group();
  flame.position.y = 2.85;
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 3.2, 10, 1, true).translate(0, 1.6, 0),
    new THREE.MeshBasicMaterial({ color: '#ffa53a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  const core = new THREE.Mesh(
    new THREE.ConeGeometry(0.2, 1.6, 8, 1, true).translate(0, 0.8, 0),
    new THREE.MeshBasicMaterial({ color: '#7fb4ff', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  flame.add(outer, core);
  flame.visible = false;
  const pilot = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.09, 0),
    new THREE.MeshBasicMaterial({ color: '#8fc0ff', fog: false }),
  );
  pilot.position.y = 2.9;
  // the envelope glows from the inside while burning
  const glow = new THREE.PointLight('#ffb050', 0, 30, 1.5);
  glow.position.y = 6;
  group.add(flame, pilot, glow);

  group.userData = { env, envMesh, flame, outer, core, pilot, glow, lines, flicker: 0 };
  return group;
}

// Per frame: the flame (burn 0–1, vapour: the weak last burn), the deflation (0–1) leaning downwind (heading).
export function updateBalloon(model, { burn, vapour, deflate, heading, t }) {
  const u = model.userData;
  const power = burn ? 1 : vapour ? 0.3 : 0;
  u.flicker += (power - u.flicker) * 0.35;
  u.flame.visible = u.flicker > 0.03;
  if (u.flame.visible) {
    const f = u.flicker * (0.85 + 0.15 * Math.sin(t * 47) * Math.sin(t * 31));
    u.flame.scale.set(0.8 + 0.2 * f, f, 0.8 + 0.2 * f);
  }
  u.glow.intensity = u.flicker * 6;
  // lean over downwind and collapse
  const d = deflate;
  u.env.rotation.set(0, 0, 0);
  u.env.rotateY(-heading);
  u.env.rotateX(-d * 1.38);
  u.envMesh.scale.set(1 + d * 0.15, 1 - d * 0.82, 1 + d * 0.15);
  u.lines.visible = d < 0.3;
}
