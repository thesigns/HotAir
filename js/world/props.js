import * as THREE from 'three';
import { BALLOON, PIBAL } from '../config.js';
import { clamp } from '../core/utils.js';

// Small things in the world: the pibal and its trail (GDD §6.1), the flag at the launch field, the plumb ring
// straight below the basket and the balloon's sun shadow (GDD §10 height cues).

const MAX_TRAIL = Math.ceil(PIBAL.top / PIBAL.climb / PIBAL.sample) + 4;

// A soft round texture: a ring (the plumb ring) or a blob (the shadow).
function radial(kind) {
  const n = 128, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  if (kind === 'ring') {
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.68, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, 'rgba(255,255,255,1)');
    g.addColorStop(0.9, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
  } else {
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
  }
  c.fillStyle = g;
  c.fillRect(0, 0, n, n);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function decal(kind, color, size) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({
      map: radial(kind), color, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, fog: kind !== 'ring',
    }),
  );
  m.renderOrder = 2;
  return m;
}

export class Props {
  constructor(scene, sunDir) {
    this.sunDir = sunDir;
    this.group = new THREE.Group();
    scene.add(this.group);

    // the pibal: a small red balloon (drawn bigger than life, so it can be seen) and its trail
    this.pibal = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 1), new THREE.MeshLambertMaterial({ color: '#e0302a' }));
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 3), 3));
    trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_TRAIL * 4), 4));
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.trail.frustumCulled = false;
    this.group.add(this.pibal, this.trail);

    // the flag at the launch field
    this.flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 7, 6).translate(0, 3.5, 0), new THREE.MeshLambertMaterial({ color: '#e8e4da' }));
    const cloth = new THREE.PlaneGeometry(2.2, 1.3, 4, 1).translate(1.1, 0, 0);
    this.flagCloth = new THREE.Mesh(cloth, new THREE.MeshLambertMaterial({ color: '#d6362c', side: THREE.DoubleSide }));
    this.flagCloth.position.y = 6.3;
    this.flagBase = Float32Array.from(cloth.attributes.position.array);
    this.flag = new THREE.Group();
    this.flag.add(this.flagPole, this.flagCloth);
    this.group.add(this.flag);

    this.ring = decal('ring', '#ffffff', 8);
    this.shadow = decal('blob', '#000000', BALLOON.radius * 2.3);
    this.group.add(this.ring, this.shadow);
  }

  reset(flight) {
    this.flag.position.set(flight.x0 - 9, 0, flight.z0 + 7);
    this.pibal.visible = true;
  }

  // wind: the surface wind ({ dir, speed }) for the flag
  update(flight, balloon, surfaceWind, t) {
    // the pibal and its fading trail
    const p = flight.pibal;
    this.pibal.visible = p.alive;
    this.pibal.position.set(p.x, p.y, p.z);
    const pos = this.trail.geometry.attributes.position, col = this.trail.geometry.attributes.color;
    const pts = p.trail, n = Math.min(pts.length, MAX_TRAIL);
    for (let i = 0; i < n; i++) {
      const q = pts[pts.length - n + i];
      pos.setXYZ(i, q.x, q.y, q.z);
      const a = clamp(1 - (flight.t - q.t) / PIBAL.trailLife, 0, 1);
      col.setXYZW(i, 0.95, 0.35, 0.3, a * 0.9);
    }
    this.trail.geometry.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;

    // the flag streams downwind and flutters
    this.flag.rotation.y = -(surfaceWind.dir + Math.PI) + Math.PI / 2;
    const fp = this.flagCloth.geometry.attributes.position, base = this.flagBase;
    const strength = clamp(surfaceWind.speed / 3, 0.2, 1);
    for (let i = 0; i < fp.count; i++) {
      const x = base[i * 3];
      fp.setZ(i, Math.sin(t * 7 + x * 2.5) * 0.18 * x * strength);
      fp.setY(i, base[i * 3 + 1] - (1 - strength) * x * 0.4);
    }
    fp.needsUpdate = true;
    this.flagCloth.geometry.computeVertexNormals();

    // the plumb ring: sharp and small close to the ground, wide and faint up high
    const agl = flight.agl;
    const g = flight.terrain.height(balloon.x, balloon.z);
    const s = 1 + agl / 35;
    this.ring.position.set(balloon.x, g + 0.08, balloon.z);
    this.ring.scale.set(s, 1, s);
    this.ring.material.opacity = clamp(0.95 - agl / 420, 0.25, 0.95) * (flight.over ? 0 : 1);
    // the sun shadow of the envelope, along the sun's rays
    const cy = balloon.y + BALLOON.mouth + 9 - g;
    const k = cy / this.sunDir.y;
    this.shadow.position.set(balloon.x - this.sunDir.x * k, g + 0.06, balloon.z - this.sunDir.z * k);
    this.shadow.scale.set(1, 1, 1 / Math.max(0.35, this.sunDir.y * 2.2));
    this.shadow.rotation.y = Math.atan2(this.sunDir.x, this.sunDir.z);
    this.shadow.material.opacity = clamp(0.42 - agl / 1400, 0.12, 0.42);
  }
}
