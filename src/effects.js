import * as THREE from 'three';
import { smokeTexture, scanGateTexture } from './textures.js';

/* Дым из-под колёс в момент касания */
export function createSmoke(scene) {
  const tex = smokeTexture();
  const pool = [];
  for (let i = 0; i < 60; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: '#e9e4df' }));
    s.visible = false;
    scene.add(s);
    pool.push({ s, life: 0, max: 1, v: new THREE.Vector3(), grow: 1 });
  }
  let cursor = 0;
  return {
    burst(pos, count = 10, drift = new THREE.Vector3()) {
      for (let i = 0; i < count; i++) {
        const p = pool[cursor++ % pool.length];
        p.s.position.copy(pos).add(new THREE.Vector3((Math.random() - 0.5) * 1.2, Math.random() * 0.4, (Math.random() - 0.5) * 1.2));
        p.v.set(drift.x + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.2, drift.z + (Math.random() - 0.5) * 3);
        p.life = 0;
        p.max = 1.6 + Math.random() * 1.4;
        p.grow = 3 + Math.random() * 4;
        p.s.visible = true;
        p.s.scale.setScalar(1);
      }
    },
    update(dt) {
      for (const p of pool) {
        if (!p.s.visible) continue;
        p.life += dt;
        const k = p.life / p.max;
        if (k >= 1) {
          p.s.visible = false;
          continue;
        }
        p.v.multiplyScalar(Math.exp(-dt * 1.2));
        p.s.position.addScaledVector(p.v, dt);
        p.s.scale.setScalar(1 + p.grow * Math.sqrt(k) * 2);
        p.s.material.opacity = 0.55 * (1 - k) * Math.min(1, k * 8);
      }
    },
  };
}

/* Сканирующая рамка — плоскость, движущаяся вдоль оси проверяемой системы */
export function createScanner(scene) {
  const mat = new THREE.MeshBasicMaterial({
    map: scanGateTexture(),
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
    color: new THREE.Color(1.3, 1.6, 1.8),
  });
  const gate = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  gate.renderOrder = 10;
  scene.add(gate);
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();

  return {
    gate,
    // objects: список Object3D; axis: единичный мировой вектор, выровненный по осям
    measure(objects) {
      box.makeEmpty();
      for (const o of objects) {
        tmp.setFromObject(o);
        box.union(tmp);
      }
      return box;
    },
    range(objects, axis) {
      const b = this.measure(objects);
      const a = axis.x !== 0 ? 'x' : axis.y !== 0 ? 'y' : 'z';
      const sign = axis[a];
      const lo = sign > 0 ? b.min[a] : -b.max[a];
      const hi = sign > 0 ? b.max[a] : -b.min[a];
      return { lo: lo - 0.6, hi: hi + 0.6, box: b, a };
    },
    place(r, axis, t, opacity) {
      const b = r.box;
      b.getSize(size);
      b.getCenter(center);
      const along = THREE.MathUtils.lerp(r.lo, r.hi, t) * axis[r.a];
      gate.position.copy(center);
      gate.position[r.a] = along;
      gate.rotation.set(0, 0, 0);
      const pad = 1.6;
      if (r.a === 'x') {
        gate.rotation.y = Math.PI / 2;
        gate.scale.set(size.z + pad, size.y + pad, 1);
      } else if (r.a === 'y') {
        gate.rotation.x = -Math.PI / 2;
        gate.scale.set(size.x + pad, size.z + pad, 1);
      } else {
        gate.scale.set(size.x + pad, size.y + pad, 1);
      }
      mat.opacity = opacity;
      gate.visible = opacity > 0.001;
    },
    hide() {
      mat.opacity = 0;
      gate.visible = false;
    },
  };
}
