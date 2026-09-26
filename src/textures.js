import * as THREE from 'three';

const mk = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
};

const toTex = (c, { repeat, srgb = true } = {}) => {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
};

function speckle(g, w, h, count, alpha, size = 2) {
  for (let i = 0; i < count; i++) {
    const v = Math.random() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * alpha})`;
    const s = Math.random() * size + 0.5;
    g.fillRect(Math.random() * w, Math.random() * h, s, s);
  }
}

function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

/* ---------- Ливрея фюзеляжа ----------
   u — по окружности (0 низ, 0.25 левый борт -z, 0.5 верх, 0.75 правый борт +z)
   v — по длине (0 хвост, 1 нос)                                               */
export function fuselageTexture() {
  const W = 1024, H = 3072;
  const [c, g] = mk(W, H);
  const X = (u) => u * W;
  const Y = (v) => (1 - v) * H;

  const base = g.createLinearGradient(0, 0, W, 0);
  base.addColorStop(0, '#b4bcc6');
  base.addColorStop(0.1, '#c9cfd6');
  base.addColorStop(0.17, '#f4f6f8');
  base.addColorStop(0.83, '#f4f6f8');
  base.addColorStop(0.9, '#c9cfd6');
  base.addColorStop(1, '#b4bcc6');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);

  // панельные швы
  g.strokeStyle = 'rgba(70,82,98,0.16)';
  g.lineWidth = 1.5;
  for (let v = 0.04; v < 0.97; v += 0.0325) {
    g.beginPath(); g.moveTo(0, Y(v)); g.lineTo(W, Y(v)); g.stroke();
  }
  for (let u = 0; u < 1; u += 0.0625) {
    g.beginPath(); g.moveTo(X(u), 0); g.lineTo(X(u), H); g.stroke();
  }
  // заклёпочные ряды
  g.fillStyle = 'rgba(70,82,98,0.12)';
  for (let v = 0.04; v < 0.97; v += 0.0325) {
    for (let x = 0; x < W; x += 9) g.fillRect(x, Y(v) + 5, 1.5, 1.5);
  }

  const sides = [
    { uw: 0.715, down: 1, rot: -Math.PI / 2 },
    { uw: 0.285, down: -1, rot: Math.PI / 2 },
  ];

  for (const s of sides) {
    // полосы ливреи: синяя + зелёная
    const band = (u0, width, color) => {
      const a = X(u0), b = X(u0 + s.down * width);
      const grad = g.createLinearGradient(0, Y(0.93), 0, Y(0.06));
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(0.06, color);
      grad.addColorStop(0.94, color);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(Math.min(a, b), Y(0.93), Math.abs(b - a), Y(0.06) - Y(0.93));
    };
    band(s.uw + s.down * 0.03, 0.014, '#0c3f8f');
    band(s.uw + s.down * 0.047, 0.005, '#1faa59');

    // иллюминаторы
    for (let v = 0.2; v < 0.835; v += 0.0141) {
      if (Math.abs(v - 0.505) < 0.004) continue;
      const cx = X(s.uw), cy = Y(v);
      g.fillStyle = '#1a2330';
      rrect(g, cx - 13, cy - 10, 26, 20, 8); g.fill();
      g.fillStyle = 'rgba(160,200,255,0.25)';
      rrect(g, cx - 10, cy - 8, 8, 9, 4); g.fill();
    }

    // двери
    for (const v of [0.875, 0.13]) {
      const cx = X(s.uw + s.down * 0.03), cy = Y(v);
      g.strokeStyle = 'rgba(60,72,88,0.6)';
      g.lineWidth = 3;
      rrect(g, cx - 78, cy - 35, 156, 70, 14); g.stroke();
      g.fillStyle = '#1a2330';
      rrect(g, X(s.uw) - 12, cy - 9, 24, 18, 8); g.fill();
    }
    // аварийные выходы над крылом
    for (const v of [0.49, 0.52]) {
      g.strokeStyle = 'rgba(60,72,88,0.45)';
      g.lineWidth = 2;
      rrect(g, X(s.uw) - 34, Y(v) - 18, 68, 36, 8); g.stroke();
    }

    // надпись
    g.save();
    g.translate(X(s.uw - s.down * 0.058), Y(0.63));
    g.rotate(s.rot);
    g.fillStyle = '#0c3f8f';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '800 70px "IBM Plex Sans", Arial, sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = '10px';
    g.fillText('UZBEKISTAN', 0, 0);
    g.restore();

    g.save();
    g.translate(X(s.uw - s.down * 0.058), Y(0.435));
    g.rotate(s.rot);
    g.fillStyle = '#1faa59';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 46px "IBM Plex Sans", Arial, sans-serif';
    if ('letterSpacing' in g) g.letterSpacing = '8px';
    g.fillText('AIRWAYS', 0, 0);
    g.restore();

    // регистрация
    g.save();
    g.translate(X(s.uw - s.down * 0.02), Y(0.155));
    g.rotate(s.rot);
    g.fillStyle = '#2b3645';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '700 40px "IBM Plex Sans", Arial, sans-serif';
    g.fillText('UK32021', 0, 0);
    g.restore();
  }

  // остекление кабины
  g.fillStyle = '#121a25';
  const cockpit = (u0, u1, vb0, vb1, vt0, vt1) => {
    g.beginPath();
    g.moveTo(X(u0), Y(vb0));
    g.lineTo(X(u1), Y(vb1));
    g.lineTo(X(u1), Y(vt1));
    g.lineTo(X(u0), Y(vt0));
    g.closePath();
    g.fill();
  };
  cockpit(0.335, 0.4, 0.934, 0.938, 0.948, 0.952);
  cockpit(0.405, 0.455, 0.939, 0.944, 0.953, 0.957);
  cockpit(0.46, 0.497, 0.945, 0.946, 0.958, 0.959);
  cockpit(0.503, 0.54, 0.946, 0.945, 0.959, 0.958);
  cockpit(0.545, 0.595, 0.944, 0.939, 0.957, 0.953);
  cockpit(0.6, 0.665, 0.938, 0.934, 0.952, 0.948);

  // обтекатель радара
  g.fillStyle = '#d6dade';
  g.fillRect(0, Y(1), W, Y(0.978) - Y(1));

  speckle(g, W, H, 9000, 0.035);
  return toTex(c);
}

/* ---------- Киль ---------- u — хорда (0 носок → 1 задняя кромка), v — размах */
export function tailTexture() {
  const W = 1024, H = 1024;
  const [c, g] = mk(W, H);
  const grad = g.createLinearGradient(0, H, W * 0.4, 0);
  grad.addColorStop(0, '#0e46a0');
  grad.addColorStop(1, '#082a66');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  // зелёный и белый штрих
  g.lineCap = 'round';
  g.strokeStyle = '#1faa59';
  g.lineWidth = 70;
  g.beginPath();
  g.moveTo(-40, H * 0.98);
  g.bezierCurveTo(W * 0.3, H * 0.8, W * 0.6, H * 0.84, W * 1.1, H * 0.62);
  g.stroke();
  g.strokeStyle = '#ffffff';
  g.lineWidth = 16;
  g.beginPath();
  g.moveTo(-40, H * 0.9);
  g.bezierCurveTo(W * 0.3, H * 0.72, W * 0.6, H * 0.76, W * 1.1, H * 0.54);
  g.stroke();

  // стилизованная птица Хумо
  g.save();
  g.translate(W * 0.56, H * 0.38);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 14;
  g.beginPath();
  g.arc(0, 0, 150, 0, Math.PI * 2);
  g.stroke();
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    const y = -40 + i * 42;
    g.moveTo(-110, y + 30);
    g.quadraticCurveTo(-10, y - 70 + i * 10, 115, y - 10);
    g.quadraticCurveTo(-10, y - 30 + i * 10, -110, y + 30);
    g.fill();
  }
  g.beginPath();
  g.arc(20, 70, 20, 0, Math.PI * 2);
  g.fill();
  g.restore();

  speckle(g, W, H, 4000, 0.04);
  return toTex(c);
}

/* ---------- Переборка (срез секции фюзеляжа) ---------- */
export function bulkheadTexture() {
  const S = 512;
  const [c, g] = mk(S, S);
  g.fillStyle = '#4a5566';
  g.fillRect(0, 0, S, S);
  const cx = S / 2;
  g.strokeStyle = '#8b98ab';
  g.lineWidth = 10;
  for (const r of [248, 225]) { g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke(); }
  g.lineWidth = 5;
  g.strokeStyle = '#6f7c90';
  for (let a = 0; a < 16; a++) {
    const t = (a / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(t) * 60, cx + Math.sin(t) * 60);
    g.lineTo(cx + Math.cos(t) * 225, cx + Math.sin(t) * 225);
    g.stroke();
  }
  // пол салона
  g.fillStyle = '#2c3440';
  g.fillRect(20, cx + 60, S - 40, 18);
  g.fillStyle = '#8b98ab';
  g.beginPath(); g.arc(cx, cx, 60, 0, Math.PI * 2); g.fill();
  speckle(g, S, S, 3000, 0.08);
  return toTex(c);
}

/* ---------- Пол ангара: 130 x 110 м ---------- */
export function hangarFloorTexture() {
  const W = 2048, H = Math.round((2048 * 110) / 130);
  const ppm = W / 130;
  const [c, g] = mk(W, H);
  const X = (x) => (x + 65) * ppm;
  const Z = (z) => (z + 55) * ppm;

  const grad = g.createRadialGradient(W / 2, H / 2, 50, W / 2, H / 2, W * 0.7);
  grad.addColorStop(0, '#d3d7db');
  grad.addColorStop(1, '#bfc4c9');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 60000, 0.06, 2.5);

  // деформационные швы
  g.strokeStyle = 'rgba(40,46,54,0.35)';
  g.lineWidth = 2;
  for (let x = -60; x <= 60; x += 10) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); }
  for (let z = -50; z <= 50; z += 10) { g.beginPath(); g.moveTo(0, Z(z)); g.lineTo(W, Z(z)); g.stroke(); }

  // периметр — жёлто-чёрная штриховка
  const hatch = (x0, z0, x1, z1) => {
    g.save();
    g.beginPath();
    g.rect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    g.clip();
    g.fillStyle = '#e8b30f';
    g.fillRect(X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0));
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 12;
    for (let k = -H; k < W + H; k += 36) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k + H, H); g.stroke();
    }
    g.restore();
  };
  hatch(-64, -54, 64, -52.5);
  hatch(-64, -54, -62.5, 54);
  hatch(62.5, -54, 64, 54);

  // зона ВС
  g.strokeStyle = 'rgba(255,255,255,0.75)';
  g.setLineDash([30, 22]);
  g.lineWidth = 6;
  g.strokeRect(X(-24), Z(-24), X(24) - X(-24), Z(24) - Z(-24));
  g.setLineDash([]);

  // осевая линия заруливания
  g.strokeStyle = '#f5c518';
  g.lineWidth = 0.4 * ppm;
  g.beginPath(); g.moveTo(X(0), H); g.lineTo(X(0), Z(-19)); g.stroke();
  g.fillStyle = '#f5c518';
  g.fillRect(X(-3), Z(-20.5), 6 * ppm, 0.8 * ppm);

  // маркировка
  g.fillStyle = 'rgba(245,197,24,0.95)';
  g.font = `800 ${3.2 * ppm}px "IBM Plex Sans", Arial, sans-serif`;
  g.textAlign = 'center';
  g.fillText('A320 STOP', X(0), Z(-22.5));
  g.fillStyle = 'rgba(255,255,255,0.8)';
  g.font = `800 ${6 * ppm}px "IBM Plex Sans Condensed", Arial, sans-serif`;
  g.fillText('UAT', X(40), Z(40));
  g.fillText('BAY 01', X(-40), Z(40));
  return toTex(c);
}

/* ---------- Гофрированная стена ---------- */
export function corrugatedTexture(color = '#c8d0da', repeat = [20, 4]) {
  const W = 128, H = 64;
  const [c, g] = mk(W, H);
  const grad = g.createLinearGradient(0, 0, W, 0);
  const stops = 4;
  for (let i = 0; i <= stops * 2; i++) {
    grad.addColorStop(i / (stops * 2), i % 2 ? shade(color, -18) : shade(color, 10));
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 200, 0.05);
  return toTex(c, { repeat });
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const gg = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `rgb(${r},${gg},${b})`;
}

/* ---------- ВПП: плитка 60 м (вдоль) × 45 м ---------- */
export function runwayTexture() {
  const W = 1024, H = 256;
  const [c, g] = mk(W, H);
  g.fillStyle = '#2b2d31';
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 14000, 0.12, 2);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, H * 0.3, W, H * 0.4);
  g.fillStyle = '#e9ebee';
  g.fillRect(0, H / 2 - 3, W / 2, 6);
  g.fillRect(0, 4, W, 5);
  g.fillRect(0, H - 9, W, 5);
  return toTex(c, { repeat: [1, 1] });
}

export function asphaltTexture(repeat) {
  const S = 256;
  const [c, g] = mk(S, S);
  g.fillStyle = '#34373c';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 5000, 0.14, 2);
  return toTex(c, { repeat });
}

export function concreteTexture(repeat) {
  const S = 256;
  const [c, g] = mk(S, S);
  g.fillStyle = '#6d7178';
  g.fillRect(0, 0, S, S);
  speckle(g, S, S, 6000, 0.1, 2);
  g.strokeStyle = 'rgba(20,20,24,0.35)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, S, S);
  return toTex(c, { repeat });
}

export function grassTexture(repeat) {
  const S = 512;
  const [c, g] = mk(S, S);
  g.fillStyle = '#3b3f2a';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 30 + Math.random() * 90;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random() < 0.5 ? '70,68,40' : '44,52,32';
    gr.addColorStop(0, `rgba(${tone},0.5)`);
    gr.addColorStop(1, `rgba(${tone},0)`);
    g.fillStyle = gr;
    g.fillRect(0, 0, S, S);
  }
  speckle(g, S, S, 16000, 0.12, 2);
  return toTex(c, { repeat });
}

/* ---------- Порог ВПП ---------- */
export function thresholdTexture(label) {
  const W = 512, H = 512;
  const [c, g] = mk(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#eceef1';
  for (let i = 0; i < 12; i++) {
    const y = 24 + i * 40 + (i >= 6 ? 20 : 0);
    if (y > H - 30) break;
    g.fillRect(8, y, 150, 18);
  }
  g.save();
  g.translate(360, H / 2);
  g.rotate(Math.PI / 2);
  g.font = '800 170px "IBM Plex Sans", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 0, 0);
  g.restore();
  return toTex(c);
}

/* ---------- Вывеска ангара ---------- */
export function signTexture() {
  const W = 2048, H = 256;
  const [c, g] = mk(W, H);
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#002d50';
  g.font = '700 120px "IBM Plex Sans Condensed", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '12px';
  g.fillText('UZBEKISTAN AIRWAYS TECHNICS', W / 2, H / 2 + 6);
  return toTex(c);
}

/* ---------- Голографическая платформа ---------- */
export function holoRingTexture() {
  const S = 1024;
  const [c, g] = mk(S, S);
  const cx = S / 2;
  g.clearRect(0, 0, S, S);
  g.strokeStyle = 'rgba(80,220,255,0.9)';
  g.lineWidth = 3;
  for (const [r, w, dash] of [[500, 4, null], [470, 2, [6, 10]], [420, 1.5, null], [300, 2, [40, 20]], [180, 1.5, null]]) {
    g.lineWidth = w;
    g.setLineDash(dash || []);
    g.beginPath(); g.arc(cx, cx, r, 0, Math.PI * 2); g.stroke();
  }
  g.setLineDash([]);
  for (let a = 0; a < 120; a++) {
    const t = (a / 120) * Math.PI * 2;
    const r0 = a % 10 === 0 ? 440 : 455;
    g.lineWidth = a % 10 === 0 ? 3 : 1.5;
    g.beginPath();
    g.moveTo(cx + Math.cos(t) * r0, cx + Math.sin(t) * r0);
    g.lineTo(cx + Math.cos(t) * 468, cx + Math.sin(t) * 468);
    g.stroke();
  }
  const gr = g.createRadialGradient(cx, cx, 0, cx, cx, 500);
  gr.addColorStop(0, 'rgba(40,160,255,0.12)');
  gr.addColorStop(0.8, 'rgba(40,160,255,0.03)');
  gr.addColorStop(1, 'rgba(40,160,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.arc(cx, cx, 500, 0, Math.PI * 2); g.fill();
  return toTex(c);
}

/* ---------- Сканирующая рамка ---------- */
export function scanGateTexture() {
  const S = 512;
  const [c, g] = mk(S, S);
  g.clearRect(0, 0, S, S);
  const gr = g.createLinearGradient(0, 0, 0, S);
  gr.addColorStop(0, 'rgba(90,220,255,0.0)');
  gr.addColorStop(0.5, 'rgba(90,220,255,0.10)');
  gr.addColorStop(1, 'rgba(90,220,255,0.0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  g.fillStyle = 'rgba(120,230,255,0.08)';
  for (let y = 0; y < S; y += 8) g.fillRect(0, y, S, 2);
  g.strokeStyle = 'rgba(140,235,255,0.95)';
  g.lineWidth = 6;
  const L = 70;
  for (const [x, y, dx, dy] of [[4, 4, 1, 1], [S - 4, 4, -1, 1], [4, S - 4, 1, -1], [S - 4, S - 4, -1, -1]]) {
    g.beginPath(); g.moveTo(x + dx * L, y); g.lineTo(x, y); g.lineTo(x, y + dy * L); g.stroke();
  }
  g.strokeStyle = 'rgba(140,235,255,0.35)';
  g.lineWidth = 2;
  g.strokeRect(4, 4, S - 8, S - 8);
  return toTex(c);
}

export function smokeTexture() {
  const S = 128;
  const [c, g] = mk(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(235,235,235,0.9)');
  gr.addColorStop(0.45, 'rgba(220,220,220,0.4)');
  gr.addColorStop(1, 'rgba(220,220,220,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return toTex(c);
}

export function glowTexture() {
  const S = 128;
  const [c, g] = mk(S, S);
  const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.5)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, S, S);
  return toTex(c);
}
