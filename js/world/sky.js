import * as THREE from 'three';
import { WORLD } from '../config.js';

const R = 3000;

// Gradient sky dome that follows the camera (from Jasta, via Tram).
export function createSky() {
  const geo = new THREE.SphereGeometry(R, 24, 12);
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 3), 3));
  const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
  }));
  dome.renderOrder = -10;
  paintSky(dome, WORLD.skyTop, WORLD.fogColor);
  return dome;
}

// Sky colours: from the horizon (the fog colour) up to the top.
export function paintSky(dome, top, horizon) {
  const pos = dome.geometry.attributes.position, col = dome.geometry.attributes.color;
  const a = new THREE.Color(horizon), b = new THREE.Color(top), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, Math.pow(Math.max(0, pos.getY(i) / R), 0.55));
    col.setXYZ(i, c.r, c.g, c.b);
  }
  col.needsUpdate = true;
}
