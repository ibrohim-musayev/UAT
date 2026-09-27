import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { sysWindow, SYS_W, seg, smooth } from './timeline.js';

/*
 * Техники UAT в ангаре. Модели и клипы — см. ТЗ «UAT Technician Characters».
 * Персонаж смотрит в +Z, начало координат — на полу между стоп. Все клипы «на месте»:
 * путь и тайминг задаются здесь, как функция прогресса скролла p.
 *
 * Самолёт в ангаре: центр (60, −160), нос к −Z, правое крыло к +X; камера почти всегда со стороны +X.
 */

const BASE = '/models/tech/';
const WALK_SPEED = 1.3; // м/с, из README модели
const FADE = 0.3;
const VISIBLE = [0.166, 0.915];

// клип → реквизит (рука берётся из ТЗ)
const CLIP_PROP = {
  Walk_Tablet: 'PROP_Tablet',
  Tablet_Type: 'PROP_Tablet',
  Tablet_Sign: 'PROP_Tablet',
  Idle_Look: 'PROP_Flashlight',
  Squat_Inspect: 'PROP_Flashlight',
  Kneel_Inspect: 'PROP_Borescope',
  Probe_Scan: 'PROP_Probe',
  Torque_Wrench: 'PROP_Wrench',
};
const PROP_HAND = { PROP_Tablet: 'Socket_L' };
// клипы, время которых привязано к скроллу (однократные)
const SCRUBBED = new Set(['Tablet_Sign', 'Thumbs_Up', 'Kneel_Down', 'Kneel_Up', 'Squat_Down', 'Squat_Up']);
// работа внизу: клип → [переход вниз, переход вверх]; цикл начинается с последней позы перехода
const LOW = { Kneel_Inspect: ['Kneel_Down', 'Kneel_Up'], Squat_Inspect: ['Squat_Down', 'Squat_Up'] };

/* ---------- Раскадровка ---------- */
const win = (i, a, b) => {
  const [w0] = sysWindow(i);
  return [w0 + SYS_W * a, w0 + SYS_W * b];
};
// окно работы на системе i: подход до 0.2 окна, уход после 0.9
const job = (i) => win(i, 0.18, 0.9);

const ARRIVE = [0.168, 0.2];
const BACK = [0.215, 0.245];
const LINEUP = [0.8, 0.822];
const LIFT_REST = 0.62; // высота площадки подъёмника в сложенном виде
const REACH = 1.95; // от стоп до кончиков пальцев в верхней точке Reach_Up
const KNEEL_EYE = 1.0; // от опоры до бороскопа в Kneel_Inspect
const LIFT_FADE = [0.012, 0.035]; // после работы подъёмник плавно исчезает (смещение от конца окна)

/**
 * Остановки персонажа: { p: [p0, p1], at: [x, z], look: [x, z], clip, back? }.
 * Между остановками — ходьба по прямой (или назад, если back).
 */
function stops(spawn, ring, safe, jobs, line, idle) {
  const s = [{ p: [0, ARRIVE[0]], at: spawn, look: ring, clip: idle }];
  s.push({ p: [ARRIVE[1], BACK[0]], at: ring, look: [60, -160], clip: idle === 'Idle' ? 'Talk' : idle });
  let from = BACK[1];
  for (const j of jobs) {
    const [a, b] = job(j.sys);
    // между близкими работами — сразу к следующей, без возврата на безопасное место
    if (a - 0.012 - from > 0.008) s.push({ p: [from, a - 0.012], at: safe, look: [60, -160], clip: idle, back: from === BACK[1] });
    const tr = LOW[j.clip];
    if (j.lift) {
      // подъёмник: встал на площадку → подъём → работа над головой → спуск
      const L = Object.assign(j.lift, { a, b, d: SYS_W * 0.15 });
      const at = { at: j.at, look: j.look, lift: L };
      s.push({ p: [a, a + L.d], ...at, clip: 'Idle' });
      if (tr) {
        // на поднятой площадке: опуститься на колени → работа → встать
        const k = SYS_W * 0.08;
        s.push(
          { p: [a + L.d, a + L.d + k], ...at, clip: tr[0] },
          { p: [a + L.d + k, b - L.d - k], ...at, clip: j.clip },
          { p: [b - L.d - k, b - L.d], ...at, clip: tr[1] }
        );
      } else s.push({ p: [a + L.d, b - L.d], ...at, clip: j.clip });
      s.push({ p: [b - L.d, b], ...at, clip: 'Idle' });
    } else if (tr) {
      // опуститься → работа → подняться; переходы привязаны к скроллу
      const d = SYS_W * 0.08;
      s.push(
        { p: [a, a + d], at: j.at, look: j.look, clip: tr[0] },
        { p: [a + d, b - d], at: j.at, look: j.look, clip: j.clip },
        { p: [b - d, b], at: j.at, look: j.look, clip: tr[1] }
      );
    } else s.push({ p: [a, b], at: j.at, look: j.look, clip: j.clip });
    from = b + 0.012;
  }
  s.push({ p: [from, LINEUP[0]], at: safe, look: [60, -160], clip: idle, back: from === BACK[1] });
  s.push({ p: [LINEUP[1], 1], at: line.at, look: line.look, clip: 'Idle' });
  return s;
}

// Рабочие места задаются точкой на экране (NDC) в кадре камеры этой системы и проецируются на пол
// в layout() — так техник гарантированно в кадре при любом соотношении сторон.
const spot = (sys, ndc, clip) => ({ sys, ndc, clip, at: [0, 0], look: [0, 0] });
// место рядом с деталью: смещение в осях самолёта (x — к носу, z — к правому крылу)
const near = (sys, part, off, clip) => ({ sys, part, off, clip, at: [0, 0], look: [0, 0] });
// работа с ножничного подъёмника под задней кромкой детали; off — смещение по размаху от центра
const onLift = (sys, part, span, clip) => ({ sys, part, off: [0, span], clip, lift: { H: LIFT_REST }, at: [0, 0], look: [0, 0] });
// подъёмник перед деталью (воздухозаборник): работа на коленях, взгляд на уровне центра детали
const onLiftFront = (sys, part, gap, clip) => ({ sys, part, off: [gap, 0], front: true, clip, lift: { H: LIFT_REST }, at: [0, 0], look: [0, 0] });
const LINE_P = 0.84;
const line = (i) => ({ ndc: [-0.2 + i * 0.1, -0.5], at: [0, 0], look: [0, 0] });
const LINE = [0, 1, 2, 3, 4, 5].map(line);

const CREW = [
  {
    file: 'TECH_Anims', // TECH_A — линейный механик (файл анимаций содержит его же)
    idle: 'Idle',
    jobs: [near(1, 'GEAR_Main_R_Wheel_Out', [-1.1, 1.0], 'Squat_Inspect'), onLift(2, 'WING_R', 2.5, 'Reach_Up'), spot(4, [0.3, -0.6], 'Idle_Look')],
    spawn: [104, -190], ring: [75, -174], safe: [93, -180], line: LINE[0],
  },
  {
    file: 'TECH_B', // двигатели
    idle: 'Idle_Look',
    jobs: [onLiftFront(0, 'ENG_R_Inlet', 0.9, 'Kneel_Inspect'), spot(5, [0.25, -0.6], 'Idle_Look')],
    spawn: [104, -150], ring: [80, -164], safe: [95, -166], line: LINE[1],
  },
  {
    file: 'TECH_C', // NDT
    idle: 'Idle',
    jobs: [near(0, 'ENG_R_Cowl', [0.2, 1.9], 'Probe_Scan'), spot(3, [0.1, -0.6], 'Point_Up'), spot(6, [-0.1, -0.6], 'Idle_Look')],
    spawn: [104, -125], ring: [72, -141], safe: [91, -142], line: LINE[3],
  },
  {
    file: 'TECH_D', // конструкции
    idle: 'Talk',
    jobs: [near(1, 'GEAR_Main_R', [0.9, 1.3], 'Torque_Wrench'), onLift(5, 'TAIL_HStab_R', 0.5, 'Reach_Up')],
    spawn: [16, -168], ring: [47, -170], safe: [34, -168], line: LINE[5],
  },
  {
    file: 'ENG_E', // лицензированный инженер: подписывает допуск
    idle: 'Tablet_Type',
    tablet: true,
    jobs: [spot(0, [0.2, -0.6], 'Tablet_Type'), spot(4, [0.1, -0.62], 'Talk')],
    spawn: [104, -176], ring: [79, -178], safe: [96, -172], line: LINE[2],
    finale: true,
  },
  {
    file: 'ENG_F', // контроль качества
    idle: 'Tablet_Type',
    tablet: true,
    jobs: [spot(1, [-0.1, -0.5], 'Tablet_Type'), spot(3, [0.3, -0.6], 'Tablet_Type'), spot(6, [0.2, -0.62], 'Tablet_Type')],
    spawn: [104, -135], ring: [76, -150], safe: [94, -152], line: LINE[4],
  },
];
for (const c of CREW) {
  c.stops = stops(c.spawn, c.ring, c.safe, c.jobs, c.line, c.idle);
  if (c.finale) {
    // инженер подписывает допуск на планшете и показывает «класс»
    const last = c.stops.pop();
    const at = { at: last.at, look: last.look };
    c.stops.push(
      { p: [LINEUP[1], 0.832], ...at, clip: 'Tablet_Type' },
      { p: [0.832, 0.842], ...at, clip: 'Tablet_Sign' },
      { p: [0.842, 0.852], ...at, clip: 'Thumbs_Up' },
      { p: [0.852, 1], ...at, clip: 'Idle' }
    );
  }
}

/* ---------- Поза персонажа по скроллу ---------- */
const liftHeight = (L, p) => LIFT_REST + (L.H - LIFT_REST) * smooth(seg(p, L.a, L.a + L.d)) * (1 - smooth(seg(p, L.b - L.d, L.b)));
const yawTo = (dx, dz) => Math.atan2(dx, dz);
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

function crewState(c, p) {
  const s = c.stops;
  let k = 0;
  while (k < s.length - 1 && p >= s[k + 1].p[0]) k++;
  const cur = s[k];
  if (p <= cur.p[1] || k === s.length - 1) {
    return { x: cur.at[0], y: cur.lift ? liftHeight(cur.lift, p) : 0, z: cur.at[1], yaw: yawTo(cur.look[0] - cur.at[0], cur.look[1] - cur.at[1]), clip: cur.clip, local: seg(p, ...cur.p), walked: 0 };
  }
  const next = s[k + 1];
  const t = smooth(seg(p, cur.p[1], next.p[0]));
  const dx = next.at[0] - cur.at[0];
  const dz = next.at[1] - cur.at[1];
  const len = Math.hypot(dx, dz);
  const back = !!next.back;
  let yaw = back ? yawTo(-dx, -dz) : yawTo(dx, dz);
  // разворот в начале и в конце пути, чтобы не было рывка
  const y0 = yawTo(cur.look[0] - cur.at[0], cur.look[1] - cur.at[1]);
  const y1 = yawTo(next.look[0] - next.at[0], next.look[1] - next.at[1]);
  if (!back) yaw = lerpAngle(lerpAngle(y0, yaw, smooth(seg(t, 0, 0.12))), y1, smooth(seg(t, 0.88, 1)));
  if (len < 0.05) return { x: cur.at[0], y: 0, z: cur.at[1], yaw: y1, clip: next.clip, local: 0, walked: 0 };
  // шаг на площадку подъёмника и с неё
  const y = (next.lift ? LIFT_REST * smooth(seg(t, 0.8, 1)) : 0) + (cur.lift ? LIFT_REST * (1 - smooth(seg(t, 0, 0.2))) : 0);
  return {
    x: cur.at[0] + dx * t,
    y,
    z: cur.at[1] + dz * t,
    yaw,
    clip: back ? 'Walk_Back' : c.tablet ? 'Walk_Tablet' : 'Walk',
    walked: len * t,
    local: t,
  };
}

/* ---------- Загрузка ---------- */
/**
 * floorAt(p, sys, spec, avoid) → { at: [x, z], look: [x, z] } — место на полу в момент p:
 * spec.ndc — под точкой экрана в кадре камеры, spec.part/off — рядом с деталью самолёта.
 * Даёт main.js: там камера и самолёт.
 */
export async function loadCrew(scene, floorAt, { shadows = true } = {}) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const load = (name) => loader.loadAsync(BASE + name + '.glb');

  const propNames = [...new Set(Object.values(CLIP_PROP))];
  const [variants, props] = await Promise.all([
    Promise.all(CREW.map((c) => load(c.file))),
    Promise.all(propNames.map(load)),
  ]);
  const clips = Object.fromEntries(variants[0].animations.map((a) => [a.name, a]));
  const propSrc = Object.fromEntries(propNames.map((n, i) => [n, props[i].scene]));

  const group = new THREE.Group();
  group.name = 'Crew';
  group.visible = false;
  scene.add(group);

  const people = CREW.map((c, i) => {
    const root = variants[i].scene;
    root.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = shadows; // на слабых устройствах тени персонажей отключены: скиннинг в тень удваивает работу
        o.receiveShadow = true;
        o.frustumCulled = false; // bbox скина считается по позе покоя
      }
    });
    group.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      const a = mixer.clipAction(clip);
      if (SCRUBBED.has(name)) {
        a.setLoop(THREE.LoopOnce);
        a.clampWhenFinished = true;
      }
      actions[name] = a;
    }
    // реквизит в сокетах
    const propObj = {};
    for (const n of propNames) {
      const socket = root.getObjectByName(PROP_HAND[n] || 'Socket_R');
      if (!socket) continue;
      const obj = propSrc[n].clone();
      obj.traverse((o) => o.isMesh && (o.castShadow = shadows));
      obj.visible = false;
      socket.add(obj);
      propObj[n] = obj;
    }
    return { c, root, mixer, actions, propObj, clip: null, phase: i * 0.73 };
  });

  // ножничные подъёмники — по одному на каждую работу «с подъёмника»
  const lifts = CREW.flatMap((c) => c.jobs.filter((j) => j.lift)).map((j) => {
    const lift = createScissorLift();
    group.add(lift.root);
    return { j, lift };
  });

  function setClip(pp, name) {
    if (pp.clip === name) return;
    const next = pp.actions[name];
    if (!next) return;
    const prev = pp.actions[pp.clip];
    next.reset();
    next.time = SCRUBBED.has(name) || LOW[name] ? 0 : pp.phase % next.getClip().duration;
    next.play();
    if (prev) next.crossFadeFrom(prev, FADE, false);
    pp.clip = name;
    const want = CLIP_PROP[name] || (pp.c.tablet ? 'PROP_Tablet' : null);
    for (const [n, o] of Object.entries(pp.propObj)) o.visible = n === want;
  }

  return {
    group,
    layout() {
      const taken = {}; // занятые места в кадре каждой системы
      // сначала подъёмники: их место задано деталью, остальные встают вокруг
      const jobs = CREW.flatMap((c) => c.jobs).sort((a, b) => !!b.lift - !!a.lift);
      for (const j of jobs) {
        const [a, b] = job(j.sys);
        const r = floorAt((a + b) / 2, j.sys, j, (taken[j.sys] ??= []));
        taken[j.sys].push(r.at);
        j.at.splice(0, 2, ...r.at);
        j.look.splice(0, 2, ...r.look);
        if (j.lift) j.lift.H = Math.min(7, Math.max(LIFT_REST, r.center !== undefined ? r.center - KNEEL_EYE : (r.under ?? 0) - REACH));
      }
      for (const { j, lift } of lifts) {
        lift.root.position.set(j.at[0], 0, j.at[1]);
        lift.root.rotation.y = yawTo(j.look[0] - j.at[0], j.look[1] - j.at[1]);
      }
      for (const l of LINE) {
        const r = floorAt(LINE_P, -1, l);
        l.at.splice(0, 2, ...r.at);
        l.look.splice(0, 2, ...r.look);
      }
    },
    update(p, dt) {
      const on = p > VISIBLE[0] && p < VISIBLE[1];
      group.visible = on;
      if (!on) return;
      for (const { j, lift } of lifts) {
        const L = j.lift;
        if (L.a === undefined) continue;
        lift.setHeight(liftHeight(L, p));
        lift.setOpacity(1 - smooth(seg(p, L.b + LIFT_FADE[0], L.b + LIFT_FADE[1])));
      }
      for (const pp of people) {
        const st = crewState(pp.c, p);
        pp.root.position.set(st.x, st.y, st.z);
        pp.root.rotation.y = st.yaw;
        setClip(pp, st.clip);
        const a = pp.actions[st.clip];
        if (/^Walk/.test(st.clip)) {
          // шаг привязан к пройденному пути — ноги не скользят при любом темпе скролла
          a.timeScale = 0;
          a.time = (st.walked / WALK_SPEED + pp.phase) % a.getClip().duration;
        } else if (SCRUBBED.has(st.clip)) {
          a.timeScale = 0;
          a.time = Math.min(st.local, 0.999) * a.getClip().duration;
        } else a.timeScale = 1;
        pp.mixer.update(dt);
      }
    },
  };
}

/* ---------- Ножничный подъёмник ---------- */
// локально: вперёд +Z (к детали), площадка вдоль X; setHeight(h) — высота верха площадки над полом
function createScissorLift() {
  const yellow = new THREE.MeshStandardMaterial({ color: '#f0b400', roughness: 0.5, metalness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2f36', roughness: 0.6, metalness: 0.4 });
  const W = 2.4; // длина площадки
  const D = 1.3; // ширина
  const BASE = 0.42;
  const root = new THREE.Group();
  const mesh = (geo, mat, x, y, z) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };
  root.add(mesh(new THREE.BoxGeometry(W, BASE - 0.12, D), dark, 0, 0.06 + (BASE - 0.12) / 2, 0));
  for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) for (const z of [-D / 2 + 0.05, D / 2 - 0.05]) {
    const wheel = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16), dark, x, 0.12, z);
    wheel.rotation.x = Math.PI / 2;
    root.add(wheel);
  }
  // площадка с ограждением
  const deck = new THREE.Group();
  deck.add(mesh(new THREE.BoxGeometry(W, 0.1, D), yellow, 0, -0.05, 0));
  const post = new THREE.BoxGeometry(0.05, 1.1, 0.05);
  for (const x of [-W / 2 + 0.03, 0, W / 2 - 0.03]) for (const z of [-D / 2 + 0.03, D / 2 - 0.03]) deck.add(mesh(post, yellow, x, 0.55, z));
  for (const h of [0.55, 1.1]) {
    for (const z of [-D / 2 + 0.03, D / 2 - 0.03]) deck.add(mesh(new THREE.BoxGeometry(W, 0.05, 0.05), yellow, 0, h, z));
    for (const x of [-W / 2 + 0.03, W / 2 - 0.03]) deck.add(mesh(new THREE.BoxGeometry(0.05, 0.05, D), yellow, x, h, 0));
  }
  root.add(deck);
  // ножницы: 3 яруса по две пары перекрещенных рычагов
  const L = W - 0.3;
  const armGeo = new THREE.BoxGeometry(L, 0.08, 0.06);
  const arms = [];
  for (let i = 0; i < 3; i++) for (const side of [-1, 1]) for (const dir of [-1, 1]) {
    const a = mesh(armGeo, yellow, 0, 0, side * (D / 2 - 0.15));
    arms.push({ a, i, dir });
    root.add(a);
  }
  return {
    root,
    setOpacity(o) {
      root.visible = o > 0.01;
      for (const m of [yellow, dark]) {
        m.transparent = o < 1;
        m.opacity = o;
        m.depthWrite = o >= 1;
      }
      root.traverse((c) => c.isMesh && (c.castShadow = o > 0.5));
    },
    setHeight(h) {
      deck.position.y = h;
      const hs = Math.max(0.02, (h - 0.1 - BASE) / 3);
      const ang = Math.asin(Math.min(0.99, hs / L));
      for (const { a, i, dir } of arms) {
        a.position.y = BASE + hs * (i + 0.5);
        a.rotation.z = dir * ang;
      }
    },
  };
}
