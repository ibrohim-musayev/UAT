import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as T from './textures.js';

// Ангар: центр (60, 0, -160), ворота смотрят в +Z
export const HANGAR = { x: 60, z: -160, w: 130, d: 110, h: 34, doorH: 28 };

export const TAXI_PATH = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(30, 0, -2),
    new THREE.Vector3(52, 0, -20),
    new THREE.Vector3(60, 0, -52),
    new THREE.Vector3(60, 0, -105),
    new THREE.Vector3(60, 0, -160),
  ],
  false,
  'centripetal'
);


const SKY = {
  turbidity: 1.6,
  rayleigh: 1.6,
  mieCoefficient: 0.0007,
  mieDirectionalG: 0.6,
  cloudCoverage: 0.32,
  cloudDensity: 0.35,
  cloudElevation: 0.45,
};

export function buildWorld(scene, renderer, { shadowSize = 4096, lowPower = false } = {}) {
  RectAreaLightUniformsLib.init();

  /* --- Небо и солнце --- */
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 36), THREE.MathUtils.degToRad(-50));
  const applySky = (sky) => {
    const u = sky.material.uniforms;
    for (const [k, v] of Object.entries(SKY)) if (u[k]) u[k].value = v;
    u.sunPosition.value.copy(sunDir);
  };
  const sky = new Sky();
  sky.scale.setScalar(18000);
  applySky(sky);
  if (sky.material.uniforms.showSunDisc) sky.material.uniforms.showSunDisc.value = 0;
  scene.add(sky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(1000);
  applySky(envSky);
  if (envSky.material.uniforms.showSunDisc) envSky.material.uniforms.showSunDisc.value = 0;
  envScene.add(envSky);
  // земля в карте окружения: без неё нижняя полусфера светится как небо и «выбеливает» днища
  const envGround = new THREE.Mesh(new THREE.CircleGeometry(4000, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#3d3f3a' }));
  envGround.position.y = -2;
  envScene.add(envGround);
  const skyEnv = pmrem.fromScene(envScene, 0.02, 0.1, 5000).texture;
  scene.environment = skyEnv;
  scene.environmentIntensity = 0.7;
  scene.fog = new THREE.FogExp2('#b7cbe0', 0.00011);

  /* --- Свет --- */
  const sun = new THREE.DirectionalLight('#fff3e2', 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -115; sc.right = 115; sc.top = 115; sc.bottom = -115; sc.near = 1; sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight('#d6e6ff', '#6b6152', 0.7);
  scene.add(hemi);

  /* --- Земля --- */
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: T.grassTexture([220, 220]), roughness: 1 })
  );
  ground.receiveShadow = true;
  scene.add(ground);

  /* --- ВПП 08/26: от x=-700 до x=900 --- */
  const RWY = { x0: -700, x1: 900, w: 45 };
  const rwLen = RWY.x1 - RWY.x0;
  const rwTex = T.runwayTexture();
  rwTex.wrapS = THREE.RepeatWrapping;
  rwTex.repeat.set(rwLen / 60, 1);
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(rwLen, RWY.w).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: rwTex, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 })
  );
  runway.position.set((RWY.x0 + RWY.x1) / 2, 0.02, 0);
  runway.receiveShadow = true;
  scene.add(runway);

  const decal = (tex, w, h, x, z, rotY = 0) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false })
    );
    m.position.set(x, 0.05, z);
    m.rotation.y = rotY;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  decal(T.thresholdTexture('08'), 40, 40, RWY.x0 + 22, 0, Math.PI / 2);
  decal(T.thresholdTexture('26'), 40, 40, RWY.x1 - 22, 0, -Math.PI / 2);
  // зона приземления
  const tdz = new THREE.MeshStandardMaterial({ color: '#e6e8eb', roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3 });
  for (const x of [-420, -300]) {
    for (const z of [-8, 8]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(45, 6).rotateX(-Math.PI / 2), tdz);
      m.position.set(x, 0.05, z);
      scene.add(m);
    }
  }

  /* --- Рулёжка и перрон --- */
  const taxiMat = new THREE.MeshStandardMaterial({ map: T.asphaltTexture([1, 40]), roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 });
  scene.add(ribbon(TAXI_PATH, 0, 0.8, 24, 0.03, taxiMat));
  const lineMat = new THREE.MeshBasicMaterial({ color: '#f5c518', polygonOffset: true, polygonOffsetFactor: -4 });
  scene.add(ribbon(TAXI_PATH, 0.02, 1, 0.35, 0.06, lineMat));

  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 80).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: T.concreteTexture([28, 11]), roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1 })
  );
  apron.position.set(HANGAR.x, 0.025, HANGAR.z + HANGAR.d / 2 + 40);
  apron.receiveShadow = true;
  scene.add(apron);

  /* --- Огни ВПП и рулёжки --- */
  const glowTex = T.glowTexture();
  const lights = [];
  const edge = [];
  for (let x = RWY.x0; x <= RWY.x1; x += 30) for (const z of [-RWY.w / 2 - 1, RWY.w / 2 + 1]) edge.push([x, z]);
  lights.push(lightField(edge, new THREE.Color(6, 4.8, 3), 0.22, glowTex, 2.6));
  const thr = [];
  for (let z = -22; z <= 22; z += 3) thr.push([RWY.x0 - 2, z]);
  lights.push(lightField(thr, new THREE.Color(0.5, 8, 2), 0.28, glowTex, 3));
  const end = [];
  for (let z = -22; z <= 22; z += 3) end.push([RWY.x1 + 2, z]);
  lights.push(lightField(end, new THREE.Color(8, 0.5, 0.35), 0.28, glowTex, 3));
  const appr = [];
  for (let x = RWY.x0 - 30; x >= RWY.x0 - 420; x -= 30) {
    for (let z = -6; z <= 6; z += 3) appr.push([x, z]);
    if ((RWY.x0 - x) % 150 === 0) for (let z = -18; z <= 18; z += 3) appr.push([x, z]);
  }
  lights.push(lightField(appr, new THREE.Color(8, 7, 5), 0.3, glowTex, 3.6, 0.8));
  const taxi = [];
  const len = TAXI_PATH.getLength();
  for (let d = 30; d < len - 60; d += 14) {
    const u = d / len;
    const p = TAXI_PATH.getPointAt(u);
    const t = TAXI_PATH.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x);
    for (const s of [-13, 13]) taxi.push([p.x + n.x * s, p.z + n.z * s]);
  }
  lights.push(lightField(taxi, new THREE.Color(0.6, 1.6, 8), 0.22, glowTex, 2.4));
  for (const l of lights) scene.add(l);

  /* --- Окружение аэропорта --- */
  const env = new THREE.Group();
  // X — восток, −Z — север. Горы Западного Тянь-Шаня (Чимган) на северо-востоке, город — на севере.
  env.add(buildMountains());
  env.add(buildCity());
  // терминал и КДП
  const glass = new THREE.MeshPhysicalMaterial({ color: '#1c2a3a', metalness: 0.6, roughness: 0.12, emissive: '#ffb86a', emissiveIntensity: 0.12 });
  const concrete = new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.8 });
  const terminal = new THREE.Mesh(new THREE.BoxGeometry(320, 22, 60), glass);
  terminal.position.set(520, 11, -300);
  terminal.castShadow = true;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(330, 3, 70), concrete);
  roof.position.set(520, 23.5, -300);
  const tower = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, 52, 20), concrete);
  shaft.position.y = 26;
  const cab = new THREE.Mesh(new THREE.CylinderGeometry(8.5, 6.5, 7, 12), glass);
  cab.position.y = 55;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 1.5, 12), concrete);
  cap.position.y = 59.2;
  tower.add(shaft, cab, cap);
  tower.position.set(300, 0, -250);
  env.add(terminal, roof, tower);
  // мачты освещения перрона
  const mastMat = new THREE.MeshStandardMaterial({ color: '#8a9098', metalness: 0.1, roughness: 0.7 });
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.2), toneMapped: false });
  // мачты стоят вне траекторий руления и буксировки (размах крыла ±18 м)
  for (const [x, z] of [[-45, -100], [165, -100], [-55, -45], [205, -58], [380, -220], [660, -220]]) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 30, 8), mastMat);
    pole.position.set(x, 15, z);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.6, 1.2), lampMat);
    lamp.position.set(x, 30, z);
    env.add(pole, lamp);
  }
  scene.add(env);

  /* --- Ангар --- */
  const hangar = buildHangar(lowPower);
  hangar.group.position.set(HANGAR.x, 0, HANGAR.z);
  scene.add(hangar.group);

  return {
    sky,
    sun,
    sunDir,
    hemi,
    hangar,
    runway: RWY,
    setSunFocus(focus, intensity) {
      sun.position.copy(focus).addScaledVector(sunDir, 300);
      sun.target.position.copy(focus);
      sun.intensity = 2.6 * intensity;
      hemi.intensity = 0.7 * (0.45 + 0.55 * intensity);
    },
  };
}

/* ---------------- Ангар ---------------- */
function buildHangar(lowPower) {
  const { w, d, h, doorH } = HANGAR;
  const g = new THREE.Group();
  const hw = w / 2;
  const hd = d / 2;

  const wallTex = T.corrugatedTexture('#c7cfd9', [26, 5]);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.55, metalness: 0.35 });
  const innerMat = new THREE.MeshStandardMaterial({ map: T.corrugatedTexture('#dde1e6', [26, 5]), roughness: 0.75, metalness: 0.05 });
  const roofMat = new THREE.MeshStandardMaterial({ color: '#59626e', roughness: 0.7, metalness: 0.3 });
  const steel = new THREE.MeshStandardMaterial({ color: '#d3d8de', roughness: 0.55, metalness: 0.2 });
  const trim = new THREE.MeshStandardMaterial({ color: '#002d50', roughness: 0.4, metalness: 0.3 });

  const box = (sx, sy, sz, x, y, z, m, shadow = true) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m);
    b.position.set(x, y, z);
    b.castShadow = shadow;
    b.receiveShadow = true;
    g.add(b);
    return b;
  };

  // пол
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    new THREE.MeshPhysicalMaterial({ map: T.hangarFloorTexture(), roughness: 0.28, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.25 })
  );
  floor.position.y = 0.04;
  floor.receiveShadow = true;
  g.add(floor);

  // стены: снаружи — светлые, внутри — тёмные (двойная обшивка)
  box(w + 2, h, 1, 0, h / 2, -hd - 0.5, wallMat);
  box(w, h - 0.5, 0.2, 0, h / 2, -hd + 0.15, innerMat, false);
  for (const s of [-1, 1]) {
    box(1, h, d + 2, s * (hw + 0.5), h / 2, 0, wallMat);
    box(0.2, h - 0.5, d, s * (hw - 0.15), h / 2, 0, innerMat, false);
  }
  // фасад: пилоны и ригель над воротами
  const opening = 120;
  const pier = (w - opening) / 2;
  for (const s of [-1, 1]) box(pier, h, 2, s * (opening / 2 + pier / 2), h / 2, hd + 0.5, wallMat);
  box(w + 2, h - doorH, 2.4, 0, doorH + (h - doorH) / 2, hd + 0.5, wallMat);
  box(w + 2.4, 1.2, 2.8, 0, doorH + 0.2, hd + 0.6, trim);
  // крыша
  box(w + 4, 1.2, d + 4, 0, h + 0.6, 0, roofMat);
  box(w + 4.4, 0.8, d + 4.4, 0, h + 1.4, 0, trim);

  // вывеска
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(92, 11.5),
    new THREE.MeshStandardMaterial({ map: T.signTexture(), transparent: true, roughness: 0.6 })
  );
  sign.position.set(8, doorH + (h - doorH) / 2 + 0.6, hd + 1.75);
  g.add(sign);
  // логотип UAT на фасаде
  const logoTex = new THREE.TextureLoader().load('/logo-uat.png');
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.anisotropy = 8;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(14.8, 5), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.6 }));
  logo.position.set(-50, doorH + (h - doorH) / 2 + 0.6, hd + 1.76);
  g.add(logo);

  // карманы ворот
  for (const s of [-1, 1]) box(34, doorH + 3, 4, s * (hw + 17), (doorH + 3) / 2, hd + 1.5, wallMat);

  // фермы покрытия
  const trussParts = [];
  const beam = (x0, y0, x1, y1, t = 0.35) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const b = new THREE.BoxGeometry(len, t, t);
    b.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    b.translate((x0 + x1) / 2, (y0 + y1) / 2, 0);
    trussParts.push(b);
  };
  const yb = h - 4.2;
  const yt = h - 0.6;
  beam(-hw, yt, hw, yt, 0.5);
  beam(-hw, yb, hw, yb, 0.5);
  for (let x = -hw; x < hw; x += 5) {
    beam(x, yb, x, yt, 0.25);
    beam(x, yb, x + 5, yt, 0.22);
  }
  const trussGeo = mergeGeometries(trussParts);
  const nTruss = 12;
  const truss = new THREE.InstancedMesh(trussGeo, steel, nTruss);
  const m4 = new THREE.Matrix4();
  for (let i = 0; i < nTruss; i++) {
    m4.makeTranslation(0, 0, -hd + 5 + (i * (d - 10)) / (nTruss - 1));
    truss.setMatrixAt(i, m4);
  }
  truss.castShadow = true;
  g.add(truss);

  // световые панели на фермах
  const panelMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
  const panelPos = [];
  for (let i = 0; i < nTruss; i++) {
    const z = -hd + 5 + (i * (d - 10)) / (nTruss - 1);
    for (const x of [-48, -24, 0, 24, 48]) panelPos.push([x, z, i]);
  }
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(9, 0.25, 1.1), panelMat, panelPos.length);
  const colors = [];
  panelPos.forEach(([x, z], i) => {
    m4.makeTranslation(x, yb - 0.4, z);
    panels.setMatrixAt(i, m4);
    panels.setColorAt(i, new THREE.Color(0, 0, 0));
    colors.push(0);
  });
  g.add(panels);

  // прямоугольные источники — мягкий «студийный» свет
  // на телефонах ряд из трёх панелей — один источник той же общей площади: каждый RectAreaLight считается в каждом пикселе
  const areas = [];
  for (const x of lowPower ? [0] : [-34, 0, 34]) {
    for (const z of [-24, 24]) {
      const a = new THREE.RectAreaLight('#f2f6ff', 0, lowPower ? 84 : 28, 24);
      a.position.set(x, yb - 1, z);
      a.rotation.x = -Math.PI / 2;
      g.add(a);
      areas.push(a);
    }
  }
  const fill = new THREE.PointLight('#bcd6ff', 0, 140, 1.4);
  fill.position.set(0, 20, 20);
  g.add(fill);

  // акцентные LED-линии на стенах
  const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0, 0, 0), toneMapped: false });
  for (const s of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.25, d - 4), stripMat);
    strip.position.set(s * (hw - 0.4), 7, 0);
    g.add(strip);
  }
  const backStrip = new THREE.Mesh(new THREE.BoxGeometry(w - 4, 0.25, 0.15), stripMat);
  backStrip.position.set(0, 7, -hd + 0.4);
  g.add(backStrip);

  // оборудование вдоль стен
  const cabMats = ['#b8222c', '#1d4f9c', '#3a424d'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.4 }));
  const rnd = mulberry32(3);
  for (let i = 0; i < 18; i++) {
    const x = -hw + 6 + i * 6.8;
    const m = cabMats[i % 3];
    box(3.8, 1.9 + rnd() * 0.6, 1.4, x, 1.05, -hd + 2.2, m);
  }
  const yellow = new THREE.MeshStandardMaterial({ color: '#f0b400', roughness: 0.5, metalness: 0.3 });
  for (const [x, z] of [[-50, -30], [-50, 5], [50, -30], [50, 5]]) {
    // рабочие платформы-стремянки
    const plat = new THREE.Group();
    const legs = [];
    for (const [lx, lz] of [[-2, -1.4], [2, -1.4], [-2, 1.4], [2, 1.4]]) {
      const l = new THREE.BoxGeometry(0.2, 7, 0.2);
      l.translate(lx, 3.5, lz);
      legs.push(l);
    }
    const deck = new THREE.BoxGeometry(4.6, 0.25, 3.2);
    deck.translate(0, 7, 0);
    legs.push(deck);
    const rail = new THREE.BoxGeometry(4.6, 0.12, 0.12);
    rail.translate(0, 8.1, 1.5);
    legs.push(rail, rail.clone().translate(0, 0, -3));
    for (let k = 1; k < 7; k++) {
      const st = new THREE.BoxGeometry(1.2, 0.12, 0.35);
      st.translate(2.8, k, -1.4 + k * 0.4);
      legs.push(st);
    }
    const pm = new THREE.Mesh(mergeGeometries(legs), yellow);
    pm.castShadow = true;
    plat.add(pm);
    plat.position.set(x, 0, z);
    g.add(plat);
  }

  // ворота: 4 створки
  const doorTex = T.corrugatedTexture('#aeb8c4', [8, 6]);
  const doorMat = new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.6, metalness: 0.2 });
  const doorWinMat = new THREE.MeshStandardMaterial({ color: '#1b2533', roughness: 0.15, metalness: 0.8, emissive: '#6fa8ff', emissiveIntensity: 0 });
  const doors = [];
  const dw = opening / 4 + 0.6;
  [
    { closed: -45, open: -hw - 17, z: hd + 2.4 },
    { closed: -15, open: -hw - 16, z: hd + 1.4 },
    { closed: 15, open: hw + 16, z: hd + 1.4 },
    { closed: 45, open: hw + 17, z: hd + 2.4 },
  ].forEach((cfg) => {
    const dg = new THREE.Group();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(dw, doorH, 0.7), doorMat);
    panel.position.y = doorH / 2;
    panel.castShadow = true;
    panel.receiveShadow = true;
    dg.add(panel);
    const win = new THREE.Mesh(new THREE.BoxGeometry(dw - 3, 1.6, 0.8), doorWinMat);
    win.position.y = doorH - 5;
    dg.add(win);
    const band = new THREE.Mesh(new THREE.BoxGeometry(dw, 0.8, 0.8), trim);
    band.position.y = 3;
    dg.add(band);
    dg.position.set(cfg.closed, 0, cfg.z);
    g.add(dg);
    doors.push({ g: dg, ...cfg });
  });

  // голографическая платформа
  const holo = new THREE.Mesh(
    new THREE.PlaneGeometry(72, 72).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: T.holoRingTexture(), color: '#0b3d91', transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 })
  );
  holo.position.y = 0.1;
  g.add(holo);

  return {
    group: g,
    holo,
    setDoors(k) {
      for (const d of doors) d.g.position.x = THREE.MathUtils.lerp(d.closed, d.open, k);
    },
    // k: 0..1 — поочерёдное включение рядов светильников
    setLights(k, time) {
      const n = panelPos.length;
      panelPos.forEach(([, , row], i) => {
        const on = THREE.MathUtils.clamp(k * (nTruss + 3) - (nTruss - 1 - row), 0, 1);
        const flicker = on > 0 && on < 1 ? (Math.sin(time * 90 + i) > 0.2 ? 1 : 0.15) : 1;
        const v = on * flicker * 4.2;
        panels.setColorAt(i, new THREE.Color(v, v * 1.02, v * 1.08));
      });
      panels.instanceColor.needsUpdate = true;
      panelMat.color.setRGB(1, 1, 1);
      const smooth = k * k * (3 - 2 * k);
      for (const a of areas) a.intensity = 2.2 * smooth;
      fill.intensity = 120 * smooth;
      stripMat.color.setRGB(3.2 * smooth, 3.3 * smooth, 3.4 * smooth);
      doorWinMat.emissiveIntensity = 0.8 * smooth;
      void n;
    },
  };
}

/* ---------------- Горы: кольцо рельефа с шумом ---------------- */
function buildMountains() {
  const inner = 2600;
  const outer = 11000;
  const geo = new THREE.RingGeometry(inner, outer, 320, 48);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const foot = new THREE.Color('#7c8468');
  const rock = new THREE.Color('#7f8796');
  const snow = new THREE.Color('#f3f5f8');
  const NE = Math.atan2(-1, 1.3); // направление на Чимган
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const r = Math.hypot(x, z);
    const t = (r - inner) / (outer - inner);
    const ang = Math.atan2(z, x);
    const toNE = Math.max(0, Math.cos(ang - NE));
    const mask = 0.12 + 0.88 * Math.pow(toNE, 1.6);
    const n = ridged(x * 0.00042, z * 0.00042);
    const rise = THREE.MathUtils.smoothstep(t, 0.04, 0.45);
    const h = rise * mask * (90 + 1150 * n * n) + rise * 40 * fbm(x * 0.002, z * 0.002);
    pos.setY(i, h - 6);
    const snowK = THREE.MathUtils.smoothstep(h, 620, 900);
    c.copy(foot).lerp(rock, THREE.MathUtils.smoothstep(h, 120, 450)).lerp(snow, snowK);
    col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
}

/* ---------------- Ташкент на горизонте: кварталы и телебашня ---------------- */
function buildCity() {
  const g = new THREE.Group();
  const rnd = mulberry32(21);
  const N = 900;
  const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
  const mesh = new THREE.InstancedMesh(box, mat, N);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const palette = ['#d9d4c7', '#cfd3d6', '#e3ddd0', '#bfc6cc', '#d4cbbb'].map((h) => new THREE.Color(h));
  for (let i = 0; i < N; i++) {
    // сектор на севере: ±45° от −Z, 2.2–5.5 км
    const a = -Math.PI / 2 + (rnd() - 0.5) * 1.6;
    const r = 2200 + Math.pow(rnd(), 0.8) * 3300;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const tall = rnd() < 0.06;
    const h = tall ? 60 + rnd() * 70 : 12 + rnd() * 26; // 4–9 этажей, редкие высотки
    const w = 18 + rnd() * 50;
    const d = 14 + rnd() * 30;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(rnd() * 3) * (Math.PI / 2) + 0.35);
    m4.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(w, h, d));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, palette[Math.floor(rnd() * palette.length)]);
  }
  g.add(mesh);

  // Ташкентская телебашня (~375 м): три опоры, ствол, две смотровые капсулы
  const tv = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: '#dfe3e8', roughness: 0.5, metalness: 0.4 });
  tv.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 9, 250, 12).translate(0, 125, 0), steel));
  tv.add(new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 120, 8).translate(0, 310, 0), steel));
  for (let k = 0; k < 3; k++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(2, 3.5, 110, 8), steel);
    const a = (k / 3) * Math.PI * 2;
    leg.position.set(Math.cos(a) * 24, 50, Math.sin(a) * 24);
    leg.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
    tv.add(leg);
  }
  const pod = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12).scale(22, 9, 22), steel);
  pod.position.y = 100;
  const pod2 = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12).scale(15, 11, 15), steel);
  pod2.position.y = 225;
  tv.add(pod, pod2);
  tv.position.set(-1400, 0, -4600);
  g.add(tv);
  return g;
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) {
  let s = 0;
  let a = 0.5;
  for (let o = 0; o < 5; o++) {
    s += a * vnoise(x, y);
    x *= 2.03;
    y *= 2.03;
    a *= 0.5;
  }
  return s;
}
function ridged(x, y) {
  let s = 0;
  let a = 0.5;
  let w = 1;
  for (let o = 0; o < 5; o++) {
    let n = 1 - Math.abs(vnoise(x, y) * 2 - 1);
    n *= n * w;
    w = Math.min(1, n * 2);
    s += a * n;
    x *= 2.1;
    y *= 2.1;
    a *= 0.5;
  }
  return s;
}

/* ---------------- Помощники ---------------- */

// Лента вдоль кривой (рулёжка, осевая линия)
function ribbon(curve, u0, u1, width, y, material, steps = 220) {
  const pos = [];
  const uv = [];
  const idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= steps; i++) {
    const u = u0 + ((u1 - u0) * i) / steps;
    const p = curve.getPointAt(u);
    const t = curve.getTangentAt(u);
    const n = new THREE.Vector3(-t.z, 0, t.x).normalize();
    pos.push(p.x + n.x * width / 2, y, p.z + n.z * width / 2, p.x - n.x * width / 2, y, p.z - n.z * width / 2);
    uv.push(0, u * len / 24, 1, u * len / 24);
    if (i < steps) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  return m;
}

// Поле огней: ядро + ореол (спрайты)
function lightField(points, color, size, glowTex, glowSize, y = 0.35) {
  const grp = new THREE.Group();
  const core = new THREE.InstancedMesh(
    new THREE.SphereGeometry(size, 8, 6),
    new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    points.length
  );
  const m4 = new THREE.Matrix4();
  points.forEach(([x, z], i) => {
    m4.makeTranslation(x, y, z);
    core.setMatrixAt(i, m4);
  });
  grp.add(core);
  const gpos = new Float32Array(points.length * 3);
  points.forEach(([x, z], i) => gpos.set([x, y, z], i * 3));
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.BufferAttribute(gpos, 3));
  const glow = new THREE.Points(
    gg,
    new THREE.PointsMaterial({
      map: glowTex,
      color: color.clone().multiplyScalar(0.16),
      size: glowSize,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
  );
  grp.add(glow);
  return grp;
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
