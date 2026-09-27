import { SYSTEMS } from './data.js';
import { CHECK_SVG } from './staticContent.js';
import { STAGES, seg, ease, smooth, P } from './timeline.js';

const $ = (s, r = document) => r.querySelector(s);
const fmt = (n) => Math.round(n).toLocaleString('ru-RU').replace(/,/g, ' ');

// update() вызывается каждый кадр: в DOM пишем только то, что изменилось
const memo = new WeakMap();
const changed = (el, key, v) => {
  let m = memo.get(el);
  if (!m) memo.set(el, (m = {}));
  if (m[key] === v) return false;
  m[key] = v;
  return true;
};
const setText = (el, v) => changed(el, 'text', v) && (el.textContent = v);
const setClass = (el, name, on) => changed(el, 'c:' + name, !!on) && el.classList.toggle(name, !!on);
const setScaleX = (el, k) => changed(el, 'sx', (k = Math.round(k * 1000) / 1000)) && (el.style.transform = `scaleX(${k})`);

export function createUI() {
  /* Услуги, сертификаты, парк и цифры вставляются в index.html при сборке — см. staticContent.js */

  // этапы
  const rail = $('#rail');
  rail.innerHTML = STAGES.map((s, i) => `<button data-p="${s.p}" data-i="${i}"><i></i><span>${s.label}</span></button>`).join('');

  // чек-лист
  $('#checklist-list').innerHTML = SYSTEMS.map(
    (s, i) => `<li data-i="${i}"><span class="cl__txt"><small>${s.code}</small>${s.title}</span><span class="cl__icon"></span></li>`
  ).join('');
  const clRows = [...document.querySelectorAll('#checklist-list li')];

  // 3D-метки
  const labelsRoot = $('#labels');
  const labels = SYSTEMS.slice(0, 7).map((s) => {
    const el = document.createElement('div');
    el.className = 'plabel';
    el.dataset.state = 'hidden';
    el.innerHTML = `<div class="plabel__dot"><span class="plabel__ring"></span>${CHECK_SVG}</div>
      <div class="plabel__card"><small>${s.code}</small><b>${s.title}</b><em><span class="st-scan">Сканирование</span><span class="st-ok">Проверено</span></em></div>`;
    labelsRoot.appendChild(el);
    return el;
  });

  // оверлеи с диапазонами
  const ranged = [...document.querySelectorAll('[data-range]')].map((el) => {
    const [a, b] = el.dataset.range.split(',').map(Number);
    return { el, a, b, last: -1 };
  });

  const icard = $('#icard');
  const stats = [...document.querySelectorAll('#stats-grid b')];
  const railBtns = [...rail.querySelectorAll('button')];
  const veil = $('#veil');
  const hud = {
    alt: $('#h-alt'),
    gs: $('#h-gs'),
    st: $('#h-st'),
    chk: $('#h-chk'),
    root: $('#hud'),
  };
  const pct = $('#cl-pct');
  const pctBar = $('#cl-bar');

  const card = {
    checks: $('.icard__checks', icard),
    progress: $('.icard__progress i', icard),
    status: $('.icard__status', icard),
    items: [],
  };
  const root = document.documentElement;

  let current = -1;
  let ready = false;

  function renderCard(i) {
    const s = SYSTEMS[i];
    icard.classList.remove('is-in');
    void icard.offsetWidth;
    $('.icard__idx', icard).textContent = `${String(i + 1).padStart(2, '0')} / 08`;
    $('.icard__code', icard).textContent = s.code;
    $('.icard__title', icard).textContent = s.title;
    $('.icard__svc', icard).textContent = s.service;
    $('.icard__desc', icard).textContent = s.desc;
    card.checks.innerHTML = s.checks.map((c) => `<li><span>${CHECK_SVG}</span>${c}</li>`).join('');
    card.items = [...card.checks.children];
    icard.classList.add('is-in');
  }

  return {
    rail,
    setReady(v) {
      ready = v;
      document.documentElement.classList.toggle('is-ready', v);
    },

    loader(k) {
      $('#loader .loader__bar i').style.transform = `scaleX(${k})`;
      $('#loader .loader__pct').textContent = `${Math.round(k * 100)}%`;
    },
    hideLoader() {
      $('#loader').classList.add('is-done');
    },

    telemetry({ alt, gs, status }) {
      setText(hud.alt, alt);
      setText(hud.gs, gs);
      setText(hud.st, status);
    },

    update(p, phases, screen) {
      // диапазонные оверлеи
      for (const r of ranged) {
        const f = 0.012;
        let o = (r.a < 0 ? 1 : seg(p, r.a, r.a + f)) * (1 - seg(p, r.b - f, r.b));
        if (!ready) o = 0;
        o = Math.round(o * 1000) / 1000;
        if (o !== r.last) {
          r.el.style.setProperty('--o', o);
          r.el.classList.toggle('is-on', o > 0.01);
          r.last = o;
        }
      }

      // текущая система
      let idx = -1;
      if (p >= P.inspect[0] && p < P.inspect[1]) idx = Math.min(6, Math.floor((p - P.inspect[0]) / ((P.inspect[1] - P.inspect[0]) / 7)));
      else if (p >= P.inspect[1]) idx = 7;
      if (idx !== current && idx >= 0) {
        current = idx;
        renderCard(idx);
      }
      if (idx >= 0) {
        const ph = phases[idx];
        const items = card.items;
        items.forEach((li, k) => setClass(li, 'is-ok', ph.scan > (k + 1) / (items.length + 0.6) || ph.checked > 0.5));
        setClass(icard, 'is-checked', ph.checked > 0.5);
        setClass(icard, 'is-scanning', ph.active > 0.3 && ph.checked < 0.5);
        setScaleX(card.progress, ph.scan);
        setText(card.status, ph.checked > 0.5 ? 'Проверено · замечаний нет' : ph.active > 0.3 ? `Сканирование · ${Math.round(ph.scan * 100)}%` : 'Подготовка');
      }

      // чек-лист
      let total = 0;
      phases.forEach((ph, i) => {
        const row = clRows[i];
        const state = ph.checked > 0.5 ? 'ok' : ph.active > 0.2 ? 'scan' : 'wait';
        if (row.dataset.state !== state) row.dataset.state = state;
        total += ph.scan * 0.85 + ph.checked * 0.15;
      });
      const pc = Math.round((total / phases.length) * 100);
      setText(pct, pc);
      setScaleX(pctBar, pc / 100);
      setText(hud.chk, `${phases.filter((x) => x.checked > 0.5).length} / 8`);

      // 3D-метки
      const inInspect = p > P.explode[1] - 0.01 && p < P.assemble[0] + 0.005;
      labels.forEach((el, i) => {
        const s = screen[i];
        const ph = phases[i];
        let state = 'hidden';
        if (inInspect && s.visible) {
          if (i === idx && ph.active > 0.1) state = ph.checked > 0.5 ? 'ok' : 'scan';
          else if (ph.checked > 0.5) state = 'mini';
        }
        if (el.dataset.state !== state) el.dataset.state = state;
        if (state !== 'hidden') {
          const t = `translate3d(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px, 0)`;
          if (changed(el, 'tr', t)) el.style.transform = t;
        }
      });

      // счётчики
      const sk = ease(seg(p, 0.892, 0.915));
      if (changed(icard, 'stats', sk)) stats.forEach((b) => setText(b, fmt(Number(b.dataset.to) * sk) + b.dataset.suffix));

      // вуаль перехода
      if (changed(veil, 'o', 0)) veil.style.opacity = 0;

      // этапы
      let active = 0;
      STAGES.forEach((s, i) => {
        if (p >= s.p - 0.001) active = i;
      });
      railBtns.forEach((b, i) => {
        setClass(b, 'is-active', i === active);
        setClass(b, 'is-past', i < active);
      });

      // статус HUD после интро
      if (ready) {
        let status = 'НА ВПП 08 · ОЖИДАНИЕ';
        if (p > 0.03) status = 'РУЛЕНИЕ К АНГАРУ';
        if (p > 0.165) status = 'АНГАР · BAY 01';
        if (p > 0.215) status = 'ДЕКОМПОЗИЦИЯ СИСТЕМ';
        if (idx >= 0 && idx < 7) status = `ИНСПЕКЦИЯ · ${SYSTEMS[idx].code}`;
        if (p > P.assemble[0]) status = 'СБОРКА';
        if (p > P.final[0]) status = 'ФИНАЛЬНАЯ ИНСПЕКЦИЯ';
        if (p > P.final[1]) status = 'CRS ВЫДАН · ГОТОВ К ВЫЛЕТУ';
        if (p > P.push[0]) status = 'БУКСИРОВКА ИЗ АНГАРА';
        if (p > P.swap) status = 'ВЗЛЁТ · RWY 08';
        setText(hud.st, status);
        setText(hud.alt, p > P.swap ? '—' : '0 FT');
        setText(hud.gs, p > P.swap ? 'TAKEOFF' : p > 0.03 && p < 0.165 ? '12 KT' : '0 KT');
      }
      setClass(root, 'is-hero', p < 0.028);
      setClass(root, 'is-content', p > 0.995);
      setClass(hud.root, 'is-dim', p > 0.99 || (p > 0.214 && p < 0.872));
    },
  };
}
