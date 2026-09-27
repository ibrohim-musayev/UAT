import './style.css';
import * as THREE from 'three';
import Lenis from 'lenis';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as TX from './textures.js';
import { buildWorld, HANGAR } from './world.js';
import { buildAircraft, SYSTEM_IDS, SYSTEM_VIEW } from './aircraft.js';
import { loadAircraft } from './aircraftGLB.js';
import { createSmoke, createScanner } from './effects.js';
import { globalUniforms } from './materials.js';
import * as TL from './timeline.js';
import { createUI } from './ui.js';
import { loadCrew } from './crew.js';

// стили применены — показываем страницу под заставкой (см. критический CSS в index.html)
document.documentElement.classList.add('css-ready');

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const ui = createUI();
ui.loader(0.08);

// Шрифты нужны до отрисовки canvas-текстур (надписи на фюзеляже, вывеска)
await Promise.race([
  Promise.all([document.fonts.load('700 70px "IBM Plex Sans"'), document.fonts.load('600 120px "IBM Plex Sans Condensed"')]),
  new Promise((r) => setTimeout(r, 2500)),
]).catch(() => {});
ui.loader(0.25);

/* ---------- Рендерер ---------- */
const isMobile = matchMedia('(max-width: 760px)').matches;
// телефоны и планшеты: облегчённые тени и разрешение, дальше — адаптивное качество по FPS
const lowPower = isMobile || matchMedia('(pointer: coarse)').matches;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('webgl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const PR = Math.min(devicePixelRatio, lowPower ? 1.25 : 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.4;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = lowPower ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.3, 30000);

const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: isMobile ? 2 : 4 });
const composer = new EffectComposer(renderer, rt);
composer.setSize(innerWidth, innerHeight); // размер RT = CSS × PR (не вызывать setPixelRatio — удвоит масштаб)
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.12, 3.6);
// в дневной сцене bloom размывает яркое небо в дымку — огни рисуются спрайтами-ореолами
bloom.enabled = false;
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ---------- Сцена ---------- */
const world = buildWorld(scene, renderer, { shadowSize: lowPower ? 2048 : 4096 });
ui.loader(0.5);
let ac;
try {
  ac = await loadAircraft('/models/A320_UAT.glb', renderer, (k) => ui.loader(0.5 + k * 0.2));
} catch (err) {
  // запасной вариант — процедурная модель
  console.error('[aircraft] GLB failed, using procedural model', err);
  ac = buildAircraft({ fuselage: TX.fuselageTexture(), tail: TX.tailTexture(), bulkhead: TX.bulkheadTexture() });
}
scene.add(ac.root);
ui.loader(0.7);
const smoke = createSmoke(scene);
const scanner = createScanner(scene);
const cameraAt = TL.buildShots(ac);
// техники подгружаются в фоне — лоадер их не ждёт
let crew = null;
let crewLayout = false;
const probeCam = new THREE.PerspectiveCamera();
const probeRay = new THREE.Raycaster();
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
// точка пола под экранной точкой (nx, ny) кадра камеры в момент p; взгляд — на систему sys или в камеру.
// Если точку закрывает самолёт (разобранные части висят над полом) — ищем ближайшую видимую.
const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
// окклюдеры — габариты деталей самолёта (луч × бокс дёшев; точный рейкаст по мешам тормозит)
let occluders = [];
function collectOccluders() {
  occluders = [];
  ac.root.traverse((o) => {
    if (o.isMesh && o.visible) occluders.push(new THREE.Box3().setFromObject(o));
  });
}
function visibleFrom(from, pt) {
  for (const h of [0.9, 1.7]) {
    _o.set(pt.x, h, pt.z);
    _d.subVectors(_o, from);
    const far = _d.length();
    probeRay.ray.set(from, _d.normalize());
    for (const b of occluders) {
      if (b.containsPoint(_o)) return false;
      const hit = probeRay.ray.intersectBox(b, _v);
      if (hit && hit.distanceTo(from) < far) return false;
    }
  }
  return true;
}
const _v = new THREE.Vector3();
const _box = new THREE.Box3();
function floorAt(p, sys, spec, avoid = []) {
  const st = TL.planeState(p);
  applyPlane(st);
  if (spec.lift && spec.front) {
    // перед деталью по оси самолёта: зазор gap от её передней кромки, взгляд — в центр детали
    const obj = ac.body.getObjectByName(spec.part);
    if (obj) {
      const c = _box.setFromObject(obj).getCenter(new THREE.Vector3());
      const size = _box.getSize(new THREE.Vector3());
      const fwd = ac.localToWorldDir(new THREE.Vector3(1, 0, 0));
      const half = 0.5 * (Math.abs(fwd.x) * size.x + Math.abs(fwd.y) * size.y + Math.abs(fwd.z) * size.z);
      const at = c.clone().addScaledVector(fwd, half + spec.off[0]);
      return { at: [at.x, at.z], look: [c.x, c.z], center: c.y };
    }
    console.warn('[crew] no front lift spot at', spec.part);
  }
  if (spec.lift) {
    // под задней кромкой детали: идём от центра к хвосту лучами вверх, пока снизу есть обшивка
    const obj = ac.body.getObjectByName(spec.part);
    if (obj) {
      const c = _box.setFromObject(obj).getCenter(new THREE.Vector3());
      const fwd = ac.localToWorldDir(new THREE.Vector3(1, 0, 0));
      const base = c.add(ac.localToWorldDir(new THREE.Vector3(0, 0, spec.off[1])));
      const up = new THREE.Vector3(0, 1, 0);
      const underAt = (pt) => {
        probeRay.far = Infinity;
        probeRay.set(new THREE.Vector3(pt.x, 0.05, pt.z), up);
        return probeRay.intersectObject(obj, true)[0]?.point.y;
      };
      let edge = null;
      for (let s = 2; s > -14; s -= 0.2) {
        const pt = base.clone().addScaledVector(fwd, s);
        if (underAt(pt) !== undefined) edge = pt;
        else if (edge) break;
      }
      if (edge) {
        // стоит чуть позади кромки (виден из кадра сверху-сзади), тянется вверх-вперёд к закрылку
        const under = underAt(edge.clone().addScaledVector(fwd, 0.25)) ?? underAt(edge);
        const at = edge.addScaledVector(fwd, -0.2);
        const look = at.clone().addScaledVector(fwd, 3);
        return { at: [at.x, at.z], look: [look.x, look.z], under };
      }
    }
    console.warn('[crew] no lift spot under', spec.part);
  }
  if (spec.part) {
    // рядом с деталью: смещение в осях самолёта, взгляд — на центр детали
    const obj = ac.body.getObjectByName(spec.part);
    if (obj) {
      const c = _box.setFromObject(obj).getCenter(new THREE.Vector3());
      const o = ac.localToWorldDir(new THREE.Vector3(spec.off[0], 0, spec.off[1]));
      return { at: [c.x + o.x, c.z + o.z], look: [c.x, c.z] };
    }
    console.warn('[crew] missing part', spec.part);
  }
  const [nx, ny] = spec.ndc ?? [0, -0.5];
  collectOccluders();
  const v = cameraAt(p, { plane: st.pos.clone(), p, portrait: false });
  probeCam.position.copy(v.pos);
  probeCam.lookAt(v.tgt);
  probeCam.fov = fitFov(v.fov);
  probeCam.aspect = innerWidth / innerHeight;
  probeCam.updateProjectionMatrix();
  probeCam.updateMatrixWorld(true);
  // кандидаты — сетка в нижней части кадра между карточками, ближайшие к заданной точке первыми
  const cand = [[nx, ny]];
  for (let x = -0.35; x <= 0.5; x += 0.05) for (let y = -0.78; y <= 0.3; y += 0.06) cand.push([x, y]);
  cand.sort((a, b) => Math.hypot(a[0] - nx, a[1] - ny) - Math.hypot(b[0] - nx, b[1] - ny));
  let hit = null;
  for (const [x, y] of cand) {
    probeRay.far = Infinity;
    probeRay.setFromCamera(new THREE.Vector2(x, y), probeCam);
    const h = probeRay.ray.intersectPlane(FLOOR, new THREE.Vector3());
    if (!h || h.distanceTo(v.pos) > 90) continue;
    if (avoid.some(([ax, az]) => Math.hypot(ax - h.x, az - h.z) < 2.2)) continue;
    if (!visibleFrom(v.pos, h)) continue;
    hit = h;
    break;
  }
  probeRay.far = Infinity;
  if (!hit) console.warn('[crew] no visible floor spot', p.toFixed(3), sys);
  hit ??= v.tgt.clone().setY(0);
  const look = sys >= 0 ? ac.anchorWorld(SYSTEM_IDS[sys], new THREE.Vector3()) : v.pos;
  return { at: [hit.x, hit.z], look: [look.x, look.z] };
}
loadCrew(scene, floorAt, { shadows: !lowPower })
  .then((c) => {
    crew = c;
    crewLayout = true;
  })
  .catch((err) => console.error('[crew] failed to load', err));

/* ---------- Скролл ---------- */
const lenis = new Lenis({ lerp: 0.075, wheelMultiplier: 0.85, touchMultiplier: 1.3, autoRaf: false });
lenis.stop();
const track = document.getElementById('track');
const maxScroll = () => Math.max(1, track.offsetHeight - innerHeight);

/* ---------- Состояние ---------- */
let mode = reducedMotion ? 'scroll' : 'intro';
let introT = 0;
let introSpeed = 1;
let touched = false;
let fanAngle = 0;
let time = 0;
let shake = 0;
const camPos = new THREE.Vector3();
const camTgt = new THREE.Vector3();
let camFov = 30;
let camInit = false;
let snapNext = false;
const tmp = new THREE.Vector3();
const shadowFocus = new THREE.Vector3();
const HANGAR_C = new THREE.Vector3(HANGAR.x, 0, HANGAR.z);
const axisWorld = new THREE.Vector3();
const phases = SYSTEM_IDS.map(() => ({ l: 0, active: 0, scan: 0, checked: 0, flash: 0 }));
const labelScreen = SYSTEM_IDS.slice(0, 7).map(() => ({ x: 0, y: 0, visible: false }));
const allParts = Object.values(ac.parts).map((p) => p.obj);

function applyPlane(st) {
  ac.root.position.copy(st.pos);
  ac.root.rotation.y = st.yaw;
  ac.pivot.rotation.z = st.pitch;
  ac.pivot.rotation.x = st.roll || 0;
  ac.setExplode(st.explode || 0);
  ac.setEngineExplode(st.engineExplode || 0);
  ac.setFlaps(st.flaps);
  ac.setGear(st.gear ?? 1);
  ac.setWheelAngle(st.dist || 0);
  ac.spinFans(fanAngle);
  ac.root.updateMatrixWorld(true);
}

const REF_ASPECT = 1.6;
function fitFov(fov) {
  const aspect = innerWidth / innerHeight;
  if (aspect >= REF_ASPECT) return fov;
  const h = 2 * Math.atan((Math.tan(THREE.MathUtils.degToRad(fov) / 2) * REF_ASPECT) / aspect);
  return Math.min(THREE.MathUtils.radToDeg(h), 78);
}

function setCamera(view, dt, damp) {
  if (!camInit || !damp || snapNext || camPos.distanceTo(view.pos) > 90) {
    snapNext = false;
    camPos.copy(view.pos);
    camTgt.copy(view.tgt);
    camFov = view.fov;
    camInit = true;
  } else {
    const k = 1 - Math.exp(-dt * 6.5);
    camPos.lerp(view.pos, k);
    camTgt.lerp(view.tgt, k);
    camFov += (view.fov - camFov) * k;
  }
  camera.position.copy(camPos);
  if (shake > 0) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake = Math.max(0, shake - dt * 0.6);
  }
  camera.lookAt(camTgt);
  if (import.meta.env.DEV && window.__uat?.camOverride) {
    // отладка: window.__uat.camOverride = { pos: [x, y, z], tgt: [x, y, z] }
    camera.position.set(...window.__uat.camOverride.pos);
    camera.lookAt(...window.__uat.camOverride.tgt);
  }
  // на узких экранах сохраняем горизонтальный угол обзора, чтобы самолёт не обрезался
  const fov = fitFov(camFov);
  if (Math.abs(camera.fov - fov) > 0.01) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
}

/* ---------- Интро: посадка ---------- */
function runIntro(dt) {
  introT += dt * introSpeed;
  const s = TL.introState(Math.min(introT, TL.INTRO.total));
  fanAngle += dt * (s.phase === 'approach' || s.phase === 'flare' ? 30 : 16);
  applyPlane({ pos: s.pos, yaw: 0, pitch: s.pitch, roll: s.roll, dist: s.groundDist, flaps: 1, gear: 1 });
  ac.landingLight.intensity = 2500;

  if (!touched && introT >= TL.INTRO.TA) {
    touched = true;
    shake = 0.25;
    for (const id of ['mainGearR', 'mainGearL']) {
      ac.parts[id].obj.getWorldPosition(tmp);
      tmp.y = 0.4;
      smoke.burst(tmp, 14, new THREE.Vector3(18, 0, 0));
    }
  }
  if (touched && introT < TL.INTRO.TA + 1.2 && Math.random() < 0.35) {
    ac.parts.mainGearR.obj.getWorldPosition(tmp);
    tmp.y = 0.4;
    smoke.burst(tmp, 1, new THREE.Vector3(10, 0, 0));
  }

  setCamera(s.cam, dt, false);
  world.setSunFocus(s.pos, 1);
  world.hangar.setDoors(0);
  world.hangar.setLights(0, time);

  const ft = Math.round(s.alt * 3.28 + (s.alt > 0 ? 0 : 0));
  ui.telemetry({
    alt: `${ft.toLocaleString('ru-RU')} FT`,
    gs: `${Math.round(s.speed * 1.94 * 0.62)} KT`,
    status: { approach: 'ФИНАЛЬНЫЙ ЗАХОД · RWY 08', flare: 'ВЫРАВНИВАНИЕ', touchdown: 'КАСАНИЕ', rollout: 'ПРОБЕГ · РЕВЕРС', stop: 'ПОСАДКА ВЫПОЛНЕНА' }[s.phase],
  });
  updateSystems(0);
  ui.update(0, phases, labelScreen);

  if (introT >= TL.INTRO.total) endIntro();
}

function endIntro() {
  mode = 'scroll';
  lenis.start();
  document.documentElement.classList.remove('is-locked');
  ui.setReady(true);
}

/* ---------- Системы: скан и отметки ---------- */
function updateSystems(p) {
  for (let i = 0; i < SYSTEM_IDS.length; i++) Object.assign(phases[i], TL.systemPhase(p, i));
  const coat = phases[7];
  const fadeTint = 1 - TL.seg(p, 0.875, 0.905);
  let gateSys = -1;
  let gateOpacity = 0;

  // финальная инспекция всего самолёта
  let coatRange = null;
  if (coat.active > 0.001) {
    ac.localToWorldDir(tmp.set(...SYSTEM_VIEW.coating.axis), axisWorld).round();
    coatRange = scanner.range(allParts, axisWorld);
  }

  for (let i = 0; i < 7; i++) {
    const id = SYSTEM_IDS[i];
    const ph = phases[i];
    const U = ac.sysU[id];
    U.uChecked.value = ph.checked * fadeTint;
    U.uFlash.value = Math.max(ph.flash, coat.flash) * 0.9;
    if (ph.active > 0.001) {
      ac.localToWorldDir(tmp.set(...SYSTEM_VIEW[id].axis), axisWorld).round();
      const r = scanner.range(ac.systemParts[id], axisWorld);
      U.uScanAxis.value.copy(axisWorld);
      U.uScan.value = THREE.MathUtils.lerp(r.lo, r.hi, ph.scan);
      U.uActive.value = ph.active;
      if (ph.active > gateOpacity) {
        gateOpacity = ph.active;
        gateSys = i;
        scanner.place(r, axisWorld, ph.scan, ph.active * 0.85);
      }
    } else if (coatRange) {
      U.uScanAxis.value.copy(axisWorld);
      U.uScan.value = THREE.MathUtils.lerp(coatRange.lo, coatRange.hi, coat.scan);
      U.uActive.value = coat.active;
    } else {
      U.uActive.value = 0;
      U.uScan.value = -1e4;
    }
  }
  if (coatRange && coat.active > gateOpacity) {
    scanner.place(coatRange, axisWorld, coat.scan, coat.active * 0.85);
    gateSys = 7;
  }
  if (gateSys < 0) scanner.hide();
}

/* ---------- Основной режим: скролл ---------- */
function runScroll(p, dt) {
  if (crew && crewLayout) {
    crewLayout = false;
    crew.layout(); // двигает самолёт по кадрам — ниже состояние задаётся заново
  }
  const st = TL.planeState(p);
  fanAngle += dt * st.fanRate;
  applyPlane(st);
  ac.landingLight.intensity = 2500 * st.landingLight;

  updateSystems(p);
  crew?.update(p, dt);

  // ангар
  const doors = Math.max(TL.smooth(TL.seg(p, ...TL.P.doorsOpen)) * (1 - TL.smooth(TL.seg(p, ...TL.P.doorsClose))), TL.smooth(TL.seg(p, ...TL.P.doorsOpen2)));
  world.hangar.setDoors(doors);
  const inside = TL.seg(p, 0.15, 0.2) * (1 - TL.seg(p, 0.905, 0.94));
  world.hangar.setLights(TL.seg(p, ...TL.P.lights), time);
  const holo = TL.seg(p, 0.215, 0.25) * (1 - TL.seg(p, 0.8, 0.835));
  world.hangar.holo.material.opacity = holo * 0.9;
  world.hangar.holo.rotation.y = time * 0.05;
  const hangarK = TL.smooth(TL.seg(p, 0.03, 0.12)) * (1 - TL.smooth(TL.seg(p, 0.91, 0.945)));
  shadowFocus.copy(st.pos).lerp(HANGAR_C, hangarK);
  world.setSunFocus(shadowFocus, 1 - 0.92 * inside);
  renderer.toneMappingExposure = THREE.MathUtils.lerp(0.4, 0.62, inside);
  scene.environmentIntensity = THREE.MathUtils.lerp(0.6, 0.28, inside);

  // камера
  const portrait = innerWidth / innerHeight < 1;
  const view = cameraAt(p, { plane: st.pos.clone(), p, portrait });
  // на телефоне карточки занимают низ экрана — поднимаем объект в кадре
  if (portrait) view.tgt.y -= view.pos.distanceTo(view.tgt) * 0.14;
  setCamera(view, dt, true);

  // экранные координаты меток
  for (let i = 0; i < 7; i++) {
    ac.anchorWorld(SYSTEM_IDS[i], tmp);
    tmp.y += 1.0;
    tmp.project(camera);
    const L = labelScreen[i];
    L.visible = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    L.x = (tmp.x * 0.5 + 0.5) * innerWidth;
    L.y = (-tmp.y * 0.5 + 0.5) * innerHeight;
  }
  ui.update(p, phases, labelScreen);
}

/* ---------- Цикл ---------- */
const clock = new THREE.Clock();
function frame(now) {
  const dt = Math.min(clock.getDelta(), 1 / 20);
  time += dt;
  globalUniforms.uTime.value = time;
  lenis.raf(now);

  const scrollY = lenis.scroll;
  const p = TL.clamp01(scrollY / maxScroll());

  if (mode === 'intro') runIntro(dt);
  else runScroll(p, dt);

  smoke.update(dt);
  ac.updateLights(time);

  // когда контент полностью перекрывает экран — не рендерим 3D
  if (scrollY < track.offsetHeight + 40) {
    composer.render();
    adaptQuality(clock.elapsedTime);
  }
}

/* ---------- Адаптивное качество ---------- */
// Если кадры медленные (слабый телефон), понижаем разрешение рендера шагами; когда запас есть — возвращаем.
const MIN_PR = Math.min(PR, 0.75);
let curPR = PR;
let qFrames = 0;
let qStart = 0;
function adaptQuality(t) {
  if (qFrames === 0) qStart = t;
  if (++qFrames < 60) return;
  const avg = (t - qStart) / (qFrames - 1);
  qFrames = 0;
  if (avg > 1 / 45 && curPR > MIN_PR) setQuality(Math.max(MIN_PR, curPR - 0.15));
  else if (avg < 1 / 58 && curPR < PR) setQuality(Math.min(PR, curPR + 0.1));
}
function setQuality(pr) {
  curPR = pr;
  renderer.setPixelRatio(pr);
  composer.setPixelRatio(pr);
}

/* ---------- Навигация ---------- */
function skipIntro() {
  if (mode === 'intro') introSpeed = 7;
}
document.getElementById('skip').addEventListener('click', skipIntro);
document.getElementById('nav-menu').addEventListener('click', (e) => {
  const open = document.documentElement.classList.toggle('menu-open');
  e.currentTarget.setAttribute('aria-expanded', String(open));
});
addEventListener('wheel', () => mode === 'intro' && introT > 0.5 && (introSpeed = Math.max(introSpeed, 3)), { passive: true });

document.querySelectorAll('[data-goto]').forEach((a) =>
  a.addEventListener('click', (e) => {
    e.preventDefault();
    document.documentElement.classList.remove('menu-open');
    const target = document.querySelector(a.getAttribute('href'));
    if (mode === 'intro') endIntro();
    lenis.scrollTo(target, { duration: 1.6, offset: -40 });
  })
);
document.querySelector('[data-top]').addEventListener('click', (e) => {
  e.preventDefault();
  lenis.scrollTo(0, { duration: 2.5 });
});
ui.rail.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (mode === 'intro') endIntro();
  lenis.scrollTo(Number(b.dataset.p) * maxScroll() + 2, { duration: 2.4 });
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.resolution.set(innerWidth, innerHeight);
  crewLayout = true;
});

/* ---------- Старт ---------- */
// начальный кадр интро для прогрева шейдеров
applyPlane({ pos: TL.introState(0).pos, yaw: 0, pitch: 0.05, flaps: 1, gear: 1 });
setCamera(TL.introState(0).cam, 0, false);
ui.loader(0.85);
try {
  await renderer.compileAsync(scene, camera);
} catch (e) {
  /* no-op */
}
ui.loader(1);
setTimeout(() => ui.hideLoader(), 350);
if (mode === 'scroll') endIntro();
renderer.setAnimationLoop(frame);

// для отладки (только dev): window.__uat.go(0.5)
if (import.meta.env.DEV) window.__uat = { THREE, get crew() { return crew; }, phases, TL, lenis, bloom, scene, renderer, ac, world, composer, camera, go: (p) => { if (mode === 'intro') endIntro(); lenis.scrollTo(p * maxScroll(), { immediate: true }); snapNext = true; } };
