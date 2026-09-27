import * as THREE from 'three';
import { TAXI_PATH } from './world.js';
import { SYSTEM_VIEW } from './aircraft.js';

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const seg = (p, a, b) => clamp01((p - a) / (b - a));
export const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const smooth = (t) => t * t * (3 - 2 * t);
export const bell = (t, a, b) => {
  const k = seg(t, a, b);
  return Math.sin(k * Math.PI);
};
const lerp = THREE.MathUtils.lerp;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ---------- Раскадровка скролла (p ∈ 0..1) ---------- */
export const P = {
  hero: 0.03,
  taxi: [0.03, 0.165],
  doorsOpen: [0.06, 0.1],
  lights: [0.165, 0.2],
  doorsClose: [0.19, 0.23],
  explode: [0.215, 0.27],
  inspect: [0.27, 0.78],
  assemble: [0.785, 0.82],
  final: [0.82, 0.855],
  doorsOpen2: [0.875, 0.905],
  push: [0.9, 0.955], // буксировка хвостом вперёд по той же линии заруливания обратно на ВПП
  swap: 0.955, // начало разбега
  takeoff: [0.955, 1],
};
export const N_INSPECT = 7;
export const SYS_W = (P.inspect[1] - P.inspect[0]) / N_INSPECT;
export const sysWindow = (i) =>
  i < N_INSPECT ? [P.inspect[0] + i * SYS_W, P.inspect[0] + (i + 1) * SYS_W] : P.final;

export const STAGES = [
  { label: 'Посадка', p: 0 },
  { label: 'Руление', p: 0.06 },
  { label: 'Ангар', p: 0.19 },
  { label: 'Диагностика', p: 0.25 },
  { label: 'Допуск', p: 0.84 },
  { label: 'Взлёт', p: 0.94 },
];

/* ---------- Фаза проверки системы ---------- */
export function systemPhase(p, i) {
  const [a, b] = sysWindow(i);
  const l = seg(p, a, b);
  return {
    l,
    active: smooth(seg(l, 0.14, 0.24)) * (1 - smooth(seg(l, 0.86, 0.97))),
    scan: ease(seg(l, 0.24, 0.72)),
    checked: smooth(seg(l, 0.71, 0.77)),
    flash: bell(l, 0.71, 0.92),
  };
}

/* ---------- Состояние самолёта по скроллу ---------- */
const TAXI_LEN = TAXI_PATH.getLength();
const RUNWAY_X0 = 0; // линия заруливания начинается на оси ВПП в точке x = 0
export function planeState(p) {
  const st = {
    pos: V(0, 0, 0),
    yaw: 0,
    pitch: 0,
    roll: 0,
    dist: 0,
    flaps: 0,
    gear: 1,
    explode: 0,
    engineExplode: 0,
    fanRate: 0,
    landingLight: 0,
  };
  if (p >= P.push[0] && p < P.swap) {
    // тот же путь, что при заруливании, в обратную сторону: нос остаётся направлен по линии,
    // и в конце самолёт стоит на оси ВПП носом на восток — готов к разбегу
    const u = 1 - ease(seg(p, ...P.push));
    TAXI_PATH.getPointAt(u, st.pos);
    const t = TAXI_PATH.getTangentAt(u);
    st.yaw = Math.atan2(-t.z, t.x);
    st.dist = 260 + u * TAXI_LEN;
    st.flaps = 0.45 * seg(p, 0.935, 0.955);
    st.fanRate = 2 + 7 * seg(p, 0.93, 0.955);
    st.landingLight = seg(p, 0.92, 0.94);
  } else if (p < P.swap) {
    const u = ease(seg(p, ...P.taxi));
    TAXI_PATH.getPointAt(u, st.pos);
    const t = TAXI_PATH.getTangentAt(u);
    st.yaw = Math.atan2(-t.z, t.x);
    st.dist = 260 + u * TAXI_LEN;
    st.flaps = 1 - smooth(seg(p, 0.03, 0.09));
    st.explode = seg(p, ...P.explode) * (1 - seg(p, ...P.assemble));
    const [a, b] = sysWindow(0);
    const l = seg(p, a, b);
    st.engineExplode = seg(l, 0.06, 0.2) * (1 - seg(l, 0.86, 0.98));
    st.fanRate = 7 * (1 - seg(p, 0.16, 0.2));
    st.landingLight = 1 - seg(p, 0.14, 0.17);
  } else {
    const s = seg(p, ...P.takeoff);
    const d = 720 * Math.pow(s, 1.9);
    const lift = 0.5;
    st.pos.set(RUNWAY_X0 + d, s > lift ? 95 * Math.pow((s - lift) / (1 - lift), 1.7) : 0, 0);
    st.pitch = 0.17 * smooth(seg(s, 0.45, 0.62));
    st.gear = 1 - smooth(seg(s, 0.68, 0.84));
    st.flaps = 0.45 * (1 - seg(s, 0.82, 1));
    st.dist = 260 + d;
    st.fanRate = 38;
    st.landingLight = 1;
  }
  return st;
}

/* ---------- Интро: заход на посадку и пробег (время, сек) ---------- */
export const INTRO = { TA: 4.6, TR: 4.4 };
INTRO.total = INTRO.TA + INTRO.TR;

export const HERO_VIEW = { pos: V(30, 5, 52), tgt: V(-22, 5, -4), fov: 36 };
// телефон (портретный экран): самолёт ближе и в три четверти с носа — так он крупнее на узком экране
export const HERO_VIEW_PORTRAIT = { pos: V(33, 5.5, 30), tgt: V(0, 3.6, 0), fov: 36 };
// на портретном экране карточки занимают низ — цель камеры опускается, объект поднимается в кадре
export const PORTRAIT_LIFT = 0.14;
export const liftTarget = (view) => {
  view.tgt.y -= view.pos.distanceTo(view.tgt) * PORTRAIT_LIFT;
  return view;
};

export function introState(t, portrait = false) {
  const { TA, TR } = INTRO;
  const s = { pos: V(), pitch: 0, roll: 0, groundDist: 0, speed: 0, alt: 0, phase: 'approach' };
  if (t < TA) {
    const k = t / TA;
    s.pos.set(-760 + 500 * k, 38 * Math.pow(1 - k, 1.3), 0);
    s.pitch = 0.05 + 0.075 * Math.pow(k, 4);
    s.roll = 0.035 * Math.sin(t * 1.4) * (1 - k);
    s.speed = 500 / TA;
    s.phase = k > 0.8 ? 'flare' : 'approach';
  } else {
    const r = Math.min(1, (t - TA) / TR);
    const x = 260 * (1 - (1 - r) * (1 - r));
    s.pos.set(-260 + x, 0, 0);
    s.pitch = 0.125 * (1 - smooth(seg(r, 0, 0.28)));
    s.groundDist = x;
    s.speed = ((2 * 260) / TR) * (1 - r);
    s.phase = r < 0.12 ? 'touchdown' : r < 0.9 ? 'rollout' : 'stop';
  }
  s.alt = s.pos.y;

  // камера: ждёт у зоны приземления, затем «машина сопровождения» до героического ракурса
  const follow = s.pos.clone().add(V(2, 2.2, 0));
  const c0 = V(-205, 3.2, 44);
  const c1 = V(-196, 3.6, 41);
  const tc = 5.2;
  let cam;
  if (t < tc) {
    cam = { pos: c0.clone().lerp(c1, smooth(t / tc)), tgt: follow, fov: 30 };
  } else {
    const k = ease(clamp01((t - tc) / (INTRO.total - tc)));
    // интро заканчивается ровно в первом кадре скролла — без доводки камеры после него
    const H = portrait ? liftTarget({ pos: HERO_VIEW_PORTRAIT.pos.clone(), tgt: HERO_VIEW_PORTRAIT.tgt.clone() }) : HERO_VIEW;
    cam = {
      pos: c1.clone().lerp(H.pos, k),
      tgt: follow.clone().lerp(H.tgt, smooth(k)),
      fov: lerp(30, HERO_VIEW.fov, k),
    };
  }
  s.cam = cam;
  return s;
}

/* ---------- Кадры камеры ---------- */
export function buildShots(ac) {
  const tmp = V();
  // на портретных экранах самолёт по центру (текст внизу), на широких — справа от текста
  const hero = (c) => {
    const H = c.portrait ? HERO_VIEW_PORTRAIT : HERO_VIEW;
    return { pos: H.pos.clone(), tgt: H.tgt.clone(), fov: H.fov };
  };
  // портретный экран узкий: общие планы снимаются ближе, иначе самолёт мелкий
  const portrait = (wideFn, narrowFn) => (c) => (c.portrait ? narrowFn(c) : wideFn(c));
  // та же линия взгляда, камера на долю k расстояния от цели
  const closer = (fn, k) => (c) => {
    const v = fn(c);
    if (c.portrait) v.pos.lerpVectors(v.tgt, v.pos, k);
    return v;
  };
  // общий план руления: камера отъезжает, в кадре весь путь до ангара; цель слегка ведёт самолёт
  const wide = (pos, fix, follow, fov) => (c) => ({
    pos: pos.clone(),
    tgt: fix.clone().lerp(c.plane.clone().add(V(0, 4, 0)), follow),
    fov,
  });
  // в портрете камера едет рядом с самолётом: общий план всего пути на узком экране делает его точкой
  const chase = (off, fov) => (c) => ({ pos: c.plane.clone().add(off), tgt: c.plane.clone().add(V(0, 4, 0)), fov });
  const taxiWide = portrait(wide(V(118, 34, 70), V(38, 6, -52), 0.35, 42), chase(V(34, 13, 36), 42));
  const taxiDoor = portrait(wide(V(104, 24, 8), V(58, 8, -100), 0.25, 42), chase(V(30, 11, 40), 42));
  const door = closer(() => ({ pos: V(84, 13, -94), tgt: V(58, 5, -165), fov: 44 }), 0.75);
  const interior = closer(() => ({ pos: V(112, 22, -112), tgt: V(58, 5, -166), fov: 44 }), 0.72);
  const overview = closer(() => ({ pos: V(117, 21, -109), tgt: V(58, 8, -163), fov: 54 }), 0.86); // ниже ферм покрытия (y≈29.8)
  const sys = (id) => () => {
    const a = ac.anchorWorld(id, V());
    const o = ac.localToWorldDir(tmp.set(...SYSTEM_VIEW[id].offset), V()).multiplyScalar(SYSTEM_VIEW[id].dist ?? 1.5);
    const tgt = a.clone();
    tgt.y += SYSTEM_VIEW[id].tgtY ?? 0;
    return { pos: a.clone().add(o), tgt, fov: 42 };
  };
  // в портрете вместо вида сбоку (самолёт во всю длину) — три четверти с носа
  const side = portrait(() => ({ pos: V(110, 17, -170), tgt: V(60, 5, -162), fov: 44 }), () => ({ pos: V(90, 10.5, -186), tgt: V(60, 5, -164), fov: 44 }));
  const side2 = portrait(() => ({ pos: V(106, 12, -148), tgt: V(60, 5, -163), fov: 42 }), () => ({ pos: V(84, 7.5, -190), tgt: V(60, 5, -164), fov: 42 }));
  const front1 = closer(() => ({ pos: V(76, 4.6, -198), tgt: V(56, 6.5, -160), fov: 44 }), 0.88);
  const front2 = closer(() => ({ pos: V(47, 3.4, -200), tgt: V(64, 7, -150), fov: 42 }), 0.88);
  // камера у носа при буксировке: выезжает из ангара вместе с самолётом
  const pushCam = (c) => ({
    pos: c.plane.clone().add(ac.localToWorldDir(tmp.set(30, 6, -11), V())),
    tgt: c.plane.clone().add(V(0, 4, 0)),
    fov: 42,
  });
  const takeoff = (c) => ({
    pos: V(60, 3.4, 40),
    tgt: c.plane.clone().add(V(0, 4, 0)),
    // fitFov на узком экране расширяет угол — в портрете исходный угол меньше, чтобы самолёт не терялся
    fov: c.portrait ? lerp(18, 7, smooth(seg(c.p, 0.972, 1))) : lerp(40, 17, smooth(seg(c.p, 0.972, 1))),
  });

  const keys = [
    [0, hero],
    [P.hero, hero],
    [0.075, taxiWide],
    [0.12, taxiWide],
    [0.145, taxiDoor],
    [0.165, door],
    [0.2, interior],
    [0.215, interior],
    [0.265, overview],
  ];
  const ids = ['engines', 'gear', 'wings', 'fuselage', 'cockpit', 'empennage', 'apu'];
  ids.forEach((id, i) => {
    const [a, b] = sysWindow(i);
    keys.push([a + SYS_W * 0.2, sys(id)], [b - SYS_W * 0.04, sys(id)]);
  });
  keys.push(
    [0.8, overview],
    [0.825, side],
    [0.855, side2],
    [0.875, front1],
    [0.895, front2],
    [0.912, pushCam],
    [0.94, pushCam],
    [0.958, takeoff],
    [1, takeoff]
  );

  return function cameraAt(p, ctx) {
    let k = 0;
    while (k < keys.length - 2 && p > keys[k + 1][0]) k++;
    const [p0, f0] = keys[k];
    const [p1, f1] = keys[k + 1];
    const t = ease(seg(p, p0, p1));
    const A = f0(ctx);
    if (t <= 0) return A;
    const B = f1(ctx);
    return { pos: A.pos.lerp(B.pos, t), tgt: A.tgt.lerp(B.tgt, t), fov: lerp(A.fov, B.fov, t) };
  };
}
