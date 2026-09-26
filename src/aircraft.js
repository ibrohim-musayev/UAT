import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { inspectable, systemUniforms } from './materials.js';

// Габариты в метрах (пропорции A320). Нос смотрит в +X, правое крыло в +Z, земля — y = 0.
export const L = 37;
export const R = 2.0;
export const H = 3.9;
const MAIN_X = -1.2; // основные стойки шасси — ось тангажа на земле
const D2R = Math.PI / 180;
const lerp = THREE.MathUtils.lerp;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const SYSTEM_IDS = ['engines', 'gear', 'wings', 'fuselage', 'cockpit', 'empennage', 'apu', 'coating'];

// Камера для каждой системы — смещение от якоря в локальной системе самолёта
export const SYSTEM_VIEW = {
  engines: { offset: [6.8, 2.4, 9.0], axis: [-1, 0, 0], dist: 1.7 }, // скан от воздухозаборника к соплу
  gear: { offset: [-10, 1.4, 4.2], axis: [0, 1, 0], dist: 1.05 },
  wings: { offset: [-11, 6.5, 9], axis: [0, 0, 1], dist: 1.35 },
  fuselage: { offset: [-4, 8, 19], axis: [-1, 0, 0], dist: 1.45 },
  cockpit: { offset: [7.5, 2.6, 7.5], axis: [-1, 0, 0] },
  empennage: { offset: [-12, 3.5, 13], axis: [0, 1, 0], dist: 1.9, tgtY: -3.5 }, // ниже центра киля — в кадре подъёмник у стабилизатора
  apu: { offset: [-7.5, 1.8, 6.5], axis: [1, 0, 0] },
  coating: { offset: [0, 0, 0], axis: [-1, 0, 0] },
};

/* ---------------- Геометрия ---------------- */

function fuseRadius(t) {
  if (t > 0.86) {
    const k = (t - 0.86) / 0.14;
    return R * Math.pow(Math.max(0, 1 - Math.pow(k, 2.3)), 0.5);
  }
  if (t < 0.27) {
    const k = (0.27 - t) / 0.27;
    return R * (1 - 0.74 * Math.pow(k, 1.5));
  }
  return R;
}

function fuseCenterY(t) {
  if (t > 0.86) {
    const k = (t - 0.86) / 0.14;
    return -0.32 * k * k;
  }
  if (t < 0.27) {
    const k = (0.27 - t) / 0.27;
    return 1.05 * Math.pow(k, 1.7);
  }
  return 0;
}

function fuselageSectionGeo(t0, t1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    // сгущаем точки к носу для гладкого обтекателя
    let f = i / n;
    if (t1 === 1) f = 1 - Math.pow(1 - f, 1.8);
    const t = t0 + (t1 - t0) * f;
    pts.push(new THREE.Vector2(Math.max(fuseRadius(t), 0.0005), t * L - L / 2));
  }
  const geo = new THREE.LatheGeometry(pts, 80, Math.PI / 2);
  geo.rotateZ(-Math.PI / 2);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getX(i) + L / 2) / L;
    pos.setY(i, pos.getY(i) + fuseCenterY(t) + H);
    uv.setY(i, t);
  }
  geo.computeVertexNormals();
  return geo;
}

const naca = (xc, tr) =>
  5 * tr * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc * xc + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);

/**
 * Несущая поверхность по профилю NACA.
 * fn(s) → { x (носок), y, z, c (хорда), t (относит. толщина) }, s ∈ [0,1] по размаху.
 */
function surfaceGeo(fn, { ns = 24, nc = 40, vertical = false, camber = 0.02, rootCap = false } = {}) {
  const verts = [];
  const uvs = [];
  const idx = [];
  const loop = [];
  for (let j = 0; j <= nc; j++) {
    const a = j / nc;
    if (a <= 0.5) loop.push([(1 + Math.cos(Math.PI * a * 2)) / 2, 1]);
    else loop.push([(1 - Math.cos(Math.PI * (a - 0.5) * 2)) / 2, -1]);
  }
  const point = (st, xc, up) => {
    const th = naca(xc, st.t) * st.c * up;
    const cb = vertical ? 0 : camber * st.c * Math.sin(Math.PI * xc);
    const px = st.x - xc * st.c;
    return vertical ? [px, st.y, st.z + th] : [px, st.y + th + cb, st.z];
  };
  for (let i = 0; i <= ns; i++) {
    const s = i / ns;
    const st = fn(s);
    for (const [xc, up] of loop) {
      verts.push(...point(st, xc, up));
      uvs.push(xc, s);
    }
  }
  const row = nc + 1;
  for (let i = 0; i < ns; i++) {
    for (let j = 0; j < nc; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const cap = (s) => {
    const st = fn(s);
    const base = verts.length / 3;
    for (const [xc, up] of loop) {
      verts.push(...point(st, xc, up));
      uvs.push(xc, s);
    }
    const c = point(st, 0.4, 0);
    verts.push(...c);
    uvs.push(0.4, s);
    const ci = verts.length / 3 - 1;
    for (let j = 0; j < nc; j++) idx.push(ci, base + j, base + j + 1);
  };
  cap(1);
  if (rootCap) cap(0);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function lathe(points, seg = 56) {
  const g = new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), seg);
  g.rotateZ(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

const wingFn = (side) => (s) => {
  const span = 16.4;
  const c = s < 0.33 ? lerp(7.2, 4.0, s / 0.33) : lerp(4.0, 1.6, (s - 0.33) / 0.67);
  return {
    x: 2.6 - span * s * Math.tan(27 * D2R),
    y: H - 1.25 + span * s * Math.tan(5.5 * D2R),
    z: side * (1.6 + span * s),
    c,
    t: lerp(0.15, 0.1, s),
  };
};

/* ---------------- Сборка ---------------- */

export function buildAircraft(tex) {
  const sysU = Object.fromEntries(SYSTEM_IDS.map((id) => [id, systemUniforms()]));
  const matCache = new Map();
  const allMaterials = [];
  const mat = (sys, base) => {
    const key = sys + base.uuid;
    if (!matCache.has(key)) {
      const m = inspectable(base, sysU[sys]);
      matCache.set(key, m);
      allMaterials.push(m);
    }
    return matCache.get(key);
  };

  const M = {
    paint: new THREE.MeshPhysicalMaterial({ map: tex.fuselage, roughness: 0.3, metalness: 0.05, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
    white: new THREE.MeshPhysicalMaterial({ color: '#eef1f4', roughness: 0.33, clearcoat: 0.7, clearcoatRoughness: 0.15, side: THREE.DoubleSide }),
    wing: new THREE.MeshPhysicalMaterial({ color: '#dde2e8', roughness: 0.38, metalness: 0.2, clearcoat: 0.4, clearcoatRoughness: 0.3, side: THREE.DoubleSide }),
    tail: new THREE.MeshPhysicalMaterial({ map: tex.tail, roughness: 0.28, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: '#c3c9d0', metalness: 1, roughness: 0.3 }),
    chrome: new THREE.MeshStandardMaterial({ color: '#d5dbe2', metalness: 1, roughness: 0.22 }),
    dark: new THREE.MeshStandardMaterial({ color: '#22262d', metalness: 0.4, roughness: 0.55, side: THREE.DoubleSide }),
    hot: new THREE.MeshStandardMaterial({ color: '#7d6b5b', metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }),
    titanium: new THREE.MeshStandardMaterial({ color: '#a4adb7', metalness: 1, roughness: 0.2 }),
    tire: new THREE.MeshStandardMaterial({ color: '#141516', roughness: 0.92 }),
    bulk: new THREE.MeshStandardMaterial({ map: tex.bulkhead, metalness: 0.5, roughness: 0.5, side: THREE.DoubleSide }),
    gear: new THREE.MeshStandardMaterial({ color: '#d7dbe0', metalness: 0.3, roughness: 0.45 }),
    lining: new THREE.MeshStandardMaterial({ color: '#5d656f', metalness: 0.5, roughness: 0.55, side: THREE.DoubleSide }),
  };

  const mesh = (geo, base, sys) => {
    const m = new THREE.Mesh(geo, mat(sys, base));
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  const root = new THREE.Group();
  root.rotation.order = 'YZX';
  const pivot = new THREE.Group();
  pivot.position.set(MAIN_X, 0, 0);
  root.add(pivot);
  const body = new THREE.Group();
  body.position.set(-MAIN_X, 0, 0);
  pivot.add(body);

  const parts = {};
  const systemParts = Object.fromEntries(SYSTEM_IDS.map((id) => [id, []]));
  const anchors = {};
  const addPart = (id, sys, obj, explode, delay = 0) => {
    obj.name = id;
    parts[id] = { obj, sys, base: obj.position.clone(), explode: new THREE.Vector3(...explode), delay };
    systemParts[sys].push(obj);
    body.add(obj);
    return obj;
  };
  const anchor = (sys, parent, pos) => {
    const a = new THREE.Object3D();
    a.position.set(...pos);
    parent.add(a);
    anchors[sys] = a;
  };

  /* --- Фюзеляж --- */
  const SECTIONS = [
    ['tailcone', 'apu', 0, 0.09, 18, [-8.5, 0.6, 0], 0.1],
    ['aft', 'fuselage', 0.09, 0.36, 30, [-3.5, 0, 0], 0],
    ['center', 'fuselage', 0.36, 0.6, 26, [0, 0, 0], 0],
    ['forward', 'fuselage', 0.6, 0.86, 26, [3.5, 0, 0], 0],
    ['cockpit', 'cockpit', 0.86, 0.975, 34, [7, 0, 0], 0.05],
    ['radome', 'cockpit', 0.975, 1, 20, [11, 0, 0], 0.1],
  ];
  const capGeo = (t) => {
    const g = new THREE.CircleGeometry(fuseRadius(t) - 0.015, 64);
    g.rotateY(Math.PI / 2);
    g.translate(t * L - L / 2, H + fuseCenterY(t), 0);
    return g;
  };
  for (const [id, sys, t0, t1, n, ex, delay] of SECTIONS) {
    const g = new THREE.Group();
    g.add(mesh(fuselageSectionGeo(t0, t1, n), M.paint, sys));
    if (t0 > 0) g.add(mesh(capGeo(t0), M.bulk, sys));
    if (t1 < 1) g.add(mesh(capGeo(t1), M.bulk, sys));
    addPart(id, sys, g, ex, delay);
  }
  // Сопло ВСУ
  {
    const g = parts.tailcone.obj;
    const nozzle = mesh(lathe([[0.36, -0.1], [0.34, 0.25], [0.3, 0.35]], 32), M.hot, 'apu');
    nozzle.position.set(-L / 2, H + fuseCenterY(0), 0);
    g.add(nozzle);
    const hole = mesh(new THREE.CircleGeometry(0.3, 32).rotateY(Math.PI / 2), M.dark, 'apu');
    hole.position.set(-L / 2 + 0.05, H + fuseCenterY(0), 0);
    g.add(hole);
    // заслонка воздухозаборника ВСУ
    const intake = mesh(new THREE.BoxGeometry(0.9, 0.06, 0.5), M.dark, 'apu');
    intake.position.set(-L / 2 + 3.2, H + fuseCenterY(0.087) + fuseRadius(0.087) - 0.02, 0.45);
    intake.rotation.x = -0.25;
    g.add(intake);
  }
  anchor('apu', parts.tailcone.obj, [-L / 2 + 1.6, H + 1.2, 0]);
  anchor('fuselage', parts.center.obj, [-1, H + 0.3, 0]);
  anchor('cockpit', parts.cockpit.obj, [14.6, H + 0.4, 0]);

  // Ребро жёсткости / обтекатель центроплана
  {
    const fairing = mesh(
      new THREE.SphereGeometry(1, 40, 20).scale(6.2, 0.9, 2.1),
      M.white,
      'fuselage'
    );
    fairing.position.set(-0.6, H - 1.55, 0);
    parts.center.obj.add(fairing);
  }

  /* --- Крылья, закрылки, законцовки --- */
  const flaps = [];
  const navLights = [];
  for (const side of [1, -1]) {
    const id = side > 0 ? 'wingR' : 'wingL';
    const g = new THREE.Group();
    const fn = wingFn(side);
    g.add(mesh(surfaceGeo(fn, { ns: 30, nc: 44 }), M.wing, 'wings'));

    // Закрылки (выдвижение по схеме Фаулера)
    for (const [s0, s1] of [[0.05, 0.32], [0.35, 0.72]]) {
      const ffn = (s) => {
        const st = fn(lerp(s0, s1, s));
        return { x: st.x - st.c * 0.72, y: st.y - 0.04, z: st.z, c: st.c * 0.27, t: 0.07 };
      };
      const a = ffn(0);
      const b = ffn(1);
      const hinge = new THREE.Vector3(a.x, a.y, a.z);
      const axis = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z).normalize();
      const geo = surfaceGeo(ffn, { ns: 10, nc: 20, rootCap: true });
      geo.translate(-hinge.x, -hinge.y, -hinge.z);
      const pivotF = new THREE.Group();
      pivotF.position.copy(hinge);
      pivotF.add(mesh(geo, M.wing, 'wings'));
      g.add(pivotF);
      flaps.push({ pivot: pivotF, hinge, axis, side, travel: fn(s0).c * 0.22 });
    }

    // Законцовка «шарклет»
    const tip = fn(1);
    const wl = surfaceGeo(
      (s) => ({
        x: tip.x - 0.05 - 2.0 * s * Math.tan(42 * D2R) - s * s * 0.3,
        y: tip.y + 0.05 + 2.3 * s,
        z: side * (tip.z / side + 0.55 * s * s),
        c: lerp(1.55, 0.45, s),
        t: 0.09,
      }),
      { ns: 12, nc: 24, vertical: true }
    );
    g.add(mesh(wl, M.tail, 'wings'));

    // Аэронавигационные огни
    const navColor = side > 0 ? new THREE.Color(0.3, 8, 1.5) : new THREE.Color(8, 0.4, 0.3);
    const nav = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: navColor, toneMapped: false }));
    nav.position.set(tip.x - 0.25, tip.y + 0.02, tip.z + side * 0.05);
    g.add(nav);
    const strobe = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false }));
    strobe.position.set(tip.x - 1.3, tip.y + 0.02, tip.z + side * 0.05);
    g.add(strobe);
    navLights.push({ nav, strobe, side });

    addPart(id, 'wings', g, [0, 2.5, side * 8], 0.05);
    if (side > 0) {
      const st = fn(0.55);
      anchor('wings', g, [st.x - st.c * 0.4, st.y + 0.3, st.z]);
    }
  }

  /* --- Горизонтальное оперение --- */
  for (const side of [1, -1]) {
    const geo = surfaceGeo(
      (s) => ({
        x: -14.3 - 6.2 * s * Math.tan(32 * D2R),
        y: H + 0.55 + 6.2 * s * Math.tan(6 * D2R),
        z: side * (0.4 + 6.2 * s),
        c: lerp(3.7, 1.3, s),
        t: 0.1,
      }),
      { ns: 16, nc: 30, camber: 0 }
    );
    const g = new THREE.Group();
    g.add(mesh(geo, M.white, 'empennage'));
    addPart(side > 0 ? 'hstabR' : 'hstabL', 'empennage', g, [-6, 1.5, side * 6], 0.15);
  }

  /* --- Киль --- */
  {
    const geo = surfaceGeo(
      (s) => ({
        x: -11.4 - 6.6 * s * Math.tan(38 * D2R),
        y: H + 1.25 + 6.6 * s,
        z: 0,
        c: lerp(6.2, 1.9, s),
        t: 0.1,
      }),
      { ns: 20, nc: 40, vertical: true }
    );
    const g = new THREE.Group();
    g.add(mesh(geo, M.tail, 'empennage'));
    // форкиль
    const dorsal = surfaceGeo(
      (s) => ({ x: -9.2 - 2.4 * s, y: H + 1.55 + 1.2 * s, z: 0, c: lerp(2.6, 0.4, s), t: 0.12 }),
      { ns: 6, nc: 20, vertical: true }
    );
    g.add(mesh(dorsal, M.white, 'empennage'));
    const tailLight = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 7, 7), toneMapped: false }));
    tailLight.position.set(-L / 2 - 0.1, H + fuseCenterY(0) + 0.2, 0);
    parts.tailcone.obj.add(tailLight);
    addPart('vstab', 'empennage', g, [-6, 6, 0], 0.15);
    anchor('empennage', g, [-15.2, H + 4.6, 0]);
  }

  /* --- Двигатели --- */
  const fans = [];
  let engineSub = null;
  for (const side of [1, -1]) {
    const g = new THREE.Group();
    g.position.set(3.4, H - 2.35, side * 5.9);
    const sub = {};
    const part = (name, obj) => {
      obj.userData.base = obj.position.clone();
      sub[name] = obj;
      g.add(obj);
    };

    // воздухозаборник
    const inlet = new THREE.Group();
    inlet.add(mesh(lathe([[0.9, 0.6], [0.92, 1.8], [0.97, 2.3], [1.0, 2.4]], 64), M.lining, 'engines'));
    inlet.add(mesh(lathe([[1.0, 2.4], [1.04, 2.46], [1.1, 2.48], [1.18, 2.43], [1.23, 2.22], [1.26, 1.6], [1.27, 0.6]], 64), M.white, 'engines'));
    part('inlet', inlet);

    // вентилятор
    const fan = new THREE.Group();
    fan.position.x = 1.45;
    const spin = new THREE.Group();
    spin.add(mesh(lathe([[0.001, 0.62], [0.1, 0.57], [0.2, 0.45], [0.27, 0.27], [0.31, 0.05], [0.31, -0.1]], 40), M.titanium, 'engines'));
    const blades = [];
    const NB = 22;
    for (let i = 0; i < NB; i++) {
      const b = new THREE.BoxGeometry(0.05, 0.62, 0.3);
      b.translate(0, 0.28 + 0.31, 0);
      b.applyMatrix4(new THREE.Matrix4().makeRotationY(0.6));
      b.applyMatrix4(new THREE.Matrix4().makeRotationX((i / NB) * Math.PI * 2));
      blades.push(b);
    }
    spin.add(mesh(mergeGeometries(blades), M.titanium, 'engines'));
    fan.add(spin);
    const face = mesh(new THREE.CircleGeometry(0.9, 48).rotateY(Math.PI / 2), M.dark, 'engines');
    face.position.x = -0.25;
    fan.add(face);
    fans.push(spin);
    part('fan', fan);

    // обечайка + пилон
    const cowl = new THREE.Group();
    cowl.add(mesh(lathe([[1.27, 0.6], [1.27, -0.4], [1.23, -1.2], [1.14, -1.75]], 64), M.white, 'engines'));
    cowl.add(mesh(lathe([[0.9, 0.6], [0.91, -0.6], [0.86, -1.75]], 48), M.dark, 'engines'));
    const pylon = mesh(new THREE.BoxGeometry(4.8, 0.9, 0.34), M.white, 'engines');
    pylon.position.set(-0.4, 1.45, 0);
    pylon.rotation.z = -0.05;
    cowl.add(pylon);
    part('cowl', cowl);

    // газогенератор
    const core = new THREE.Group();
    core.add(mesh(lathe([[0.86, -1.6], [0.84, -2.2], [0.72, -2.8], [0.62, -3.1]], 48), M.metal, 'engines'));
    core.add(mesh(lathe([[0.6, -1.7], [0.58, -3.0]], 32), M.dark, 'engines'));
    part('core', core);

    // сопло и конус
    const plug = new THREE.Group();
    plug.add(mesh(lathe([[0.5, -2.95], [0.46, -3.3], [0.26, -3.8], [0.02, -4.1]], 40), M.hot, 'engines'));
    part('plug', plug);

    addPart(side > 0 ? 'engineR' : 'engineL', 'engines', g, [3, -2, side * 14], 0.2);
    if (side > 0) {
      engineSub = sub;
      anchor('engines', g, [0.3, 0.2, 0]);
    }
  }
  const ENGINE_SPREAD = { inlet: 2.6, fan: 1.4, cowl: 0, core: -1.5, plug: -2.8 };

  /* --- Шасси --- */
  const wheels = [];
  const gears = [];
  const cylBetween = (a, b, r, base, sys) => {
    const dir = new THREE.Vector3().subVectors(b, a);
    const m = mesh(new THREE.CylinderGeometry(r, r, dir.length(), 14), base, sys);
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return m;
  };
  const wheel = (r) => {
    const w = new THREE.Group();
    w.add(mesh(new THREE.TorusGeometry(r * 0.7, r * 0.3, 18, 44).scale(1, 1, 1.3), M.tire, 'gear'));
    w.add(mesh(new THREE.CylinderGeometry(r * 0.5, r * 0.5, r * 0.66, 28).rotateX(Math.PI / 2), M.metal, 'gear'));
    const bolts = [];
    for (let i = 0; i < 8; i++) {
      const b = new THREE.CylinderGeometry(0.03, 0.03, r * 0.7, 6).rotateX(Math.PI / 2);
      const a = (i / 8) * Math.PI * 2;
      b.translate(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 0);
      bolts.push(b);
    }
    w.add(mesh(mergeGeometries(bolts), M.dark, 'gear'));
    wheels.push({ w, r });
    return w;
  };
  const buildGear = (kind, side) => {
    const g = new THREE.Group();
    if (kind === 'nose') {
      g.position.set(13.2, 2.15, 0);
      g.add(cylBetween(new THREE.Vector3(0, 0.1, 0), new THREE.Vector3(0, -0.9, 0), 0.13, M.gear, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0, -0.9, 0), new THREE.Vector3(0, -1.75, 0), 0.085, M.chrome, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0, -1.75, -0.35), new THREE.Vector3(0, -1.75, 0.35), 0.06, M.metal, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0.05, -0.2, 0), new THREE.Vector3(0.9, 0.15, 0), 0.05, M.gear, 'gear'));
      for (const z of [-0.29, 0.29]) {
        const w = wheel(0.4);
        w.position.set(0, -1.75, z);
        g.add(w);
      }
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16).rotateY(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.5, 7), toneMapped: false }));
      lamp.position.set(0.16, -0.6, 0);
      g.add(lamp);
    } else {
      g.position.set(MAIN_X, 2.6, side * 3.8);
      g.add(cylBetween(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, -1.2, 0), 0.17, M.gear, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0, -1.2, 0), new THREE.Vector3(0, -2.0, 0), 0.115, M.chrome, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0, -2.0, -0.62), new THREE.Vector3(0, -2.0, 0.62), 0.08, M.metal, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0, -0.8, 0), new THREE.Vector3(0.1, 0.1, -side * 1.4), 0.07, M.gear, 'gear'));
      g.add(cylBetween(new THREE.Vector3(0.15, -1.3, 0), new THREE.Vector3(0.35, -1.65, 0), 0.04, M.metal, 'gear'));
      for (const z of [-0.5, 0.5]) {
        const w = wheel(0.62);
        w.position.set(0, -2.0, z);
        g.add(w);
      }
    }
    gears.push({ g, kind, side });
    return g;
  };
  addPart('noseGear', 'gear', buildGear('nose', 0), [0, -3, 0], 0.25);
  addPart('mainGearR', 'gear', buildGear('main', 1), [0, -3.8, 3], 0.25);
  addPart('mainGearL', 'gear', buildGear('main', -1), [0, -3.8, -3], 0.25);
  anchor('gear', parts.mainGearR.obj, [0, -1.1, 0.8]);

  /* --- Проблесковые маяки и посадочная фара --- */
  const beacons = [];
  for (const [x, y] of [[0.5, H + R + 0.05], [-2, H - R - 0.05]]) {
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false }));
    b.position.set(x, y, 0);
    parts.center.obj.add(b);
    beacons.push(b);
  }
  const landingLight = new THREE.SpotLight('#fff1d6', 0, 260, 0.32, 0.55, 1.2);
  landingLight.position.set(13.6, 1.6, 0);
  landingLight.target.position.set(60, -2, 0);
  body.add(landingLight, landingLight.target);

  anchors.coating = anchors.fuselage;

  /* ---------------- API ---------------- */
  const tmpV = new THREE.Vector3();
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
      for (const p of Object.values(parts)) {
        const k = easeInOut(clamp01((e - p.delay) / 0.75));
        p.obj.position.copy(p.base).addScaledVector(p.explode, k);
      }
      body.position.y = easeInOut(clamp01(e / 0.6)) * 5;
    },

    setEngineExplode(e) {
      const k = easeInOut(clamp01(e));
      for (const [name, obj] of Object.entries(engineSub)) {
        obj.position.copy(obj.userData.base);
        obj.position.x += ENGINE_SPREAD[name] * k;
      }
    },

    setFlaps(k) {
      for (const f of flaps) {
        f.pivot.position.copy(f.hinge);
        f.pivot.position.x -= f.travel * k;
        f.pivot.position.y -= 0.12 * k;
        f.pivot.quaternion.setFromAxisAngle(f.axis, f.side * 0.5 * k);
      }
    },

    setGear(k) {
      for (const g of gears) {
        const up = 1 - k;
        if (g.kind === 'nose') g.g.rotation.z = up * (Math.PI / 2);
        else g.g.rotation.x = g.side * up * (Math.PI / 2);
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
      const strobe = (time % 1.2) < 0.06 || ((time % 1.2) > 0.14 && (time % 1.2) < 0.18) ? 14 : 0;
      for (const n of navLights) n.strobe.material.color.setScalar(strobe * on);
      const bc = Math.pow(Math.max(0, Math.sin(time * 4.2)), 12) * 10 * on;
      for (const b of beacons) b.material.color.setRGB(bc, bc * 0.08, bc * 0.04);
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

    tmpV,
  };
}
