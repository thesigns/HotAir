import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// The models made in Blender (tools/blender/models.py → assets/models/models.glb), as flat triangle lists with
// a colour per vertex (from their materials), ready to be merged by the hundred into the terrain chunks.
// MODELS[name] = { pos: Float32Array, col: Float32Array } (three floats per vertex, three vertices per triangle).
export const MODELS = {};

const _v = new THREE.Vector3();

export async function loadModels(url = 'assets/models/models.glb') {
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  for (const root of gltf.scene.children) {
    const pos = [], col = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry;
      const p = g.attributes.position, c = o.material.color;
      // in the root's own frame (the roots sit at the origin)
      const m = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(o.matrixWorld);
      for (let i = 0; i < p.count; i++) {
        _v.fromBufferAttribute(p, i).applyMatrix4(m);
        pos.push(_v.x, _v.y, _v.z);
        col.push(c.r, c.g, c.b);
      }
      if (g !== o.geometry) g.dispose();
    });
    MODELS[root.name] = { pos: Float32Array.from(pos), col: Float32Array.from(col) };
  }
  return MODELS;
}

// A model as its own geometry (for the few that move: the windmills' sails, the balloon's basket).
export function modelGeometry(name) {
  const m = MODELS[name];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.pos.slice(), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(m.col.slice(), 3));
  geo.computeVertexNormals();
  return geo;
}
