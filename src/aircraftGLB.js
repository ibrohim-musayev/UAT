import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { inspectable, systemUniforms } from './materials.js';
import { SYSTEM_IDS } from './aircraft.js';
import { optimizeTextures } from './texopt.js';

/*
 * Загрузка A320_UAT.glb (Blender). Соглашения модели (см. ТЗ):
 * нос +X, верх +Y, правое крыло +Z, начало координат — на земле под осью основных стоек.
 * Модуль повторяет API процедурного самолёта из aircraft.js.
 */

const AIRCRAFT_TONE = 0.82; // множитель яркости окраски самолёта
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// подъём всего самолёта при разборе: 0 — части остаются на рабочей высоте, техники достают до них с пола
const BODY_LIFT = 0;

// имя узла → [система, смещение при разборе (x, y, z), задержка]
const PARTS = {
  FUS_Radome: ['cockpit', [11, 0, 0], 0.1],
  FUS_Cockpit: ['cockpit', [7, 0, 0], 0.05],
  FUS_Forward: ['fuselage', [3.5, 0, 0], 0],
  FUS_Center: ['fuselage', [0, 0, 0], 0],
  FUS_Aft: ['fuselage', [-3.5, 0, 0], 0],
  FUS_Tailcone: ['apu', [-8.5, 0.6, 0], 0.1],
  TAIL_Fin: ['empennage', [-6, 6, 0], 0.15],
  TAIL_HStab_R: ['empennage', [-6, 1.5, 6], 0.15],
  TAIL_HStab_L: ['empennage', [-6, 1.5, -6], 0.15],
  WING_R: ['wings', [0, 2.5, 8], 0.05],
  WING_L: ['wings', [0, 2.5, -8], 0.05],
  ENG_R: ['engines', [3, 0, 14], 0.2],
  ENG_L: ['engines', [3, 0, -14], 0.2],
  GEAR_Nose: ['gear', [3, 0, 0], 0.25],
  GEAR_Main_R: ['gear', [0, 0, 3.5], 0.25],
  GEAR_Main_L: ['gear', [0, 0, -3.5], 0.25],
};

// разбор правого двигателя вдоль оси
const ENGINE_SPREAD = { ENG_R_Inlet: 2.6, ENG_R_Fan: 1.4, ENG_R_Cowl: 0, ENG_R_Core: -1.5, ENG_R_Exhaust: -2.8, ENG_R_Pylon: 0 };

// якорь системы: центр габарита этой части
const ANCHOR_PART = {
  engines: 'ENG_R',
  gear: 'GEAR_Main_R',
  wings: 'WING_R',
  fuselage: 'FUS_Center',
  cockpit: 'FUS_Cockpit',
  empennage: 'TAIL_Fin',
  apu: 'FUS_Tailcone',
};

// Силовой набор внутри фюзеляжа виден только в разобранном виде: у собранного самолёта он не рисуется
const INTERIOR = /^FUS_(Radome|Radar|Forward|Center|Aft|Tailcone)/;
// Тень дают только внешние обводы: всё, что внутри обшивки, капота или шины, её не меняет
const NO_SHADOW_MAT = /^(Interior_Structure|Liner_Acoustic|Lamp_Lens|Glass_Cockpit)$/;
const NO_SHADOW_PART = /^(ENG_._(Core|Fan)|FUS_Radar)/;
const partName = (o) => {
  while (o && !o.name) o = o.parent;
  return o?.name ?? '';
};

const LIGHT_COLORS = {
  LIGHT_Nav_R: [0.3, 8, 1.5],
  LIGHT_Nav_L: [8, 0.4, 0.3],
  LIGHT_Tail: [7, 7, 7],
  LIGHT_Landing_R: [9, 8.5, 7],
  LIGHT_Landing_L: [9, 8.5, 7],
  LIGHT_Taxi: [9, 8.5, 7],
};

export async function loadAircraft(url, renderer, onProgress) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total));
  const src = gltf.scene.getObjectByName('A320');
  if (!src) throw new Error('A320 root node not found in ' + url);
  src.updateMatrixWorld(true);
  optimizeTextures(src);

  const sysU = Object.fromEntries(SYSTEM_IDS.map((id) => [id, systemUniforms()]));
  const matCache = new Map();
  const allMaterials = [];
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const mat = (sys, base) => {
    const key = sys + base.uuid;
    if (!matCache.has(key)) {
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (base[k]) base[k].anisotropy = Math.min(8, maxAniso);
      const m = inspectable(base, sysU[sys]);
      // ливрея в сцене выглядела выбеленной: чуть темнее базовый цвет и слабее отражение неба
      m.color.multiplyScalar(AIRCRAFT_TONE);
      m.envMapIntensity = 0.55;
      // окраска: чуть матовее, чтобы блики неба не «выбеливали» зелёный и голубой
      if (/^Paint_/.test(base.name)) m.roughness = Math.max(m.roughness, 1.6);
      matCache.set(key, m);
      allMaterials.push(m);
    }
    return matCache.get(key);
  };

  const root = new THREE.Group();
  root.rotation.order = 'YZX';
  const pivot = new THREE.Group(); // ось тангажа = ось основных стоек = начало координат модели
  root.add(pivot);
  const body = new THREE.Group();
  pivot.add(body);

  const parts = {};
  const interior = [];
  const systemParts = Object.fromEntries(SYSTEM_IDS.map((id) => [id, []]));
  for (const [name, [sys, ex, delay]] of Object.entries(PARTS)) {
    const obj = src.getObjectByName(name);
    if (!obj) {
      console.warn('[aircraft] missing part', name);
      continue;
    }
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const base = o.material.name;
      const part = partName(o);
      const wheelHub = /_Wheel_/.test(part) && base !== 'Rubber_Tyre';
      if (base === 'Interior_Structure' && INTERIOR.test(part)) interior.push(o);
      o.material = mat(sys, o.material);
      o.castShadow = !(NO_SHADOW_MAT.test(base) || NO_SHADOW_PART.test(part) || wheelHub);
      o.receiveShadow = true;
    });
    parts[name] = { obj, sys, base: obj.position.clone(), explode: new THREE.Vector3(...ex), delay };
    systemParts[sys].push(obj);
  }
  // всё, что есть в модели, но не в списке, — тоже переносим (без инспекции)
  for (const child of [...src.children]) body.add(child);

  // якоря систем в центре габарита
  const anchors = {};
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  for (const [sys, name] of Object.entries(ANCHOR_PART)) {
    const part = parts[name]?.obj;
    if (!part) continue;
    part.updateMatrixWorld(true);
    box.setFromObject(part).getCenter(c);
    const a = new THREE.Object3D();
    a.position.copy(part.worldToLocal(c.clone()));
    part.add(a);
    anchors[sys] = a;
  }
  anchors.coating = anchors.fuselage;

  // вращающиеся элементы
  const fans = ['ENG_R_Fan', 'ENG_L_Fan'].map((n) => src.getObjectByName(n) || body.getObjectByName(n)).filter(Boolean);
  const wheels = [];
  body.updateMatrixWorld(true);
  body.traverse((o) => {
    if (!/_Wheel_/.test(o.name)) return;
    const w = new THREE.Vector3();
    o.getWorldPosition(w);
    wheels.push({ w: o, r: Math.max(0.2, w.y) }); // ось колеса над землёй = радиус
  });
  const engineSub = Object.keys(ENGINE_SPREAD)
    .map((n) => body.getObjectByName(n))
    .filter(Boolean)
    .map((o) => ({ o, base: o.position.clone(), d: ENGINE_SPREAD[o.name] }));
  const flaps = [];
  const slats = [];
  body.traverse((o) => {
    if (/_Flap_/.test(o.name)) flaps.push({ o, base: o.position.clone(), rot: o.rotation.z });
    if (/_Slats$/.test(o.name)) slats.push({ o, base: o.position.clone() });
  });
  const gears = ['GEAR_Nose', 'GEAR_Main_R', 'GEAR_Main_L']
    .map((n) => body.getObjectByName(n))
    .filter(Boolean)
    .map((g) => ({ g, kind: g.name === 'GEAR_Nose' ? 'nose' : 'main', side: g.name.endsWith('_R') ? 1 : -1, rx: g.rotation.x, rz: g.rotation.z }));

  // огни по маркерам LIGHT_*
  const flashing = [];
  const lampGeo = new THREE.SphereGeometry(0.12, 12, 8);
  body.traverse((o) => {
    if (!o.name.startsWith('LIGHT_')) return;
    const m = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false }));
    o.add(m);
    if (LIGHT_COLORS[o.name]) m.material.color.setRGB(...LIGHT_COLORS[o.name]);
    else flashing.push({ m, kind: o.name.includes('Strobe') ? 'strobe' : 'beacon' });
  });

  const landingLight = new THREE.SpotLight('#fff1d6', 0, 260, 0.32, 0.55, 1.2);
  const taxi = body.getObjectByName('LIGHT_Taxi');
  if (taxi) taxi.getWorldPosition(landingLight.position);
  else landingLight.position.set(13, 1.6, 0);
  landingLight.target.position.set(landingLight.position.x + 50, -2, 0);
  body.add(landingLight, landingLight.target);

  let explodeState = 0;
  return {
    root,
    pivot,
    body,
    parts,
    anchors,
    systemParts,
    sysU,
    allMaterials,
    landingLight,

    setExplode(e) {
      explodeState = e;
      const open = e > 0;
      if (interior.length && interior[0].visible !== open) for (const o of interior) o.visible = open;
      for (const p of Object.values(parts)) {
        const k = easeInOut(clamp01((e - p.delay) / 0.75));
        p.obj.position.copy(p.base).addScaledVector(p.explode, k);
      }
      body.position.y = easeInOut(clamp01(e / 0.6)) * BODY_LIFT;
    },
    setEngineExplode(e) {
      const k = easeInOut(clamp01(e));
      for (const s of engineSub) {
        s.o.position.copy(s.base);
        s.o.position.x += s.d * k;
      }
    },
    setFlaps(k) {
      for (const f of flaps) {
        f.o.position.copy(f.base);
        f.o.position.x -= 0.7 * k;
        f.o.position.y -= 0.12 * k;
        f.o.rotation.z = f.rot + 0.45 * k;
      }
      for (const s of slats) {
        s.o.position.copy(s.base);
        s.o.position.x += 0.25 * k;
        s.o.position.y -= 0.12 * k;
      }
    },
    setGear(k) {
      const up = 1 - k;
      for (const g of gears) {
        if (g.kind === 'nose') g.g.rotation.z = g.rz + up * (Math.PI / 2);
        else g.g.rotation.x = g.rx + g.side * up * (Math.PI / 2);
        g.g.visible = k > 0.03;
      }
    },
    setWheelAngle(a) {
      for (const { w, r } of wheels) w.rotation.z = -a / r;
    },
    spinFans(angle) {
      for (const f of fans) f.rotation.x = angle;
    },
    updateLights(time, on = 1) {
      const t = time % 1.2;
      const strobe = t < 0.06 || (t > 0.14 && t < 0.18) ? 14 : 0;
      const bc = Math.pow(Math.max(0, Math.sin(time * 4.2)), 12) * 10 * on;
      for (const f of flashing) {
        if (f.kind === 'strobe') f.m.material.color.setScalar(strobe * on);
        else f.m.material.color.setRGB(bc, bc * 0.08, bc * 0.04);
      }
    },
    anchorWorld(sys, target = new THREE.Vector3()) {
      return anchors[sys].getWorldPosition(target);
    },
    get explode() {
      return explodeState;
    },
    localToWorldDir(v, target = new THREE.Vector3()) {
      return target.copy(v).applyQuaternion(root.quaternion);
    },
  };
}
