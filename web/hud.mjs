import { positionAt } from './flight.mjs';

const G = 9.81;
const DRAG = 0.25;
const MAX_TILT = 30;
const PITCH_SPAN = 90;
const C = { sky: '#2f6fbf', skyHigh: '#1b4682', ground: '#7a5530', groundLow: '#4a331d', white: '#ffffff', panel: 'rgba(10,20,36,.72)', text: '#eef3fb', muted: '#a9b8cd', marker: '#ffd23f', on: '#ff6b6b', off: '#8fa1ba' };

const rad = degrees => degrees * Math.PI / 180;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// Records keep wall seconds, so a span of 1/speedup is one simulated second.
function velocityAt(flight, t, span) {
  const a = positionAt(flight.positions, t - span), b = positionAt(flight.positions, t);
  if (!a || !b) return { x: 0, y: 0, z: 0 };
  const seconds = span * (flight.speedup ?? 1);
  return { x: (b.x_m - a.x_m) / seconds, y: (b.y_m - a.y_m) / seconds, z: (b.rel_alt_m - a.rel_alt_m) / seconds };
}

// Roll and pitch come from the flight controller when the record has them. Older records and calculated routes have none,
// so there they are estimated from how a multicopter tilts to accelerate and hold speed.
export function attitudeAt(flight, t) {
  const position = positionAt(flight.positions, t);
  if (!position) return null;
  const span = 1 / (flight.speedup ?? 1);
  const v = velocityAt(flight, t, span), before = velocityAt(flight, t - span, span);
  const h = rad(position.heading ?? 0);
  const forward = [Math.sin(h), Math.cos(h)], right = [Math.cos(h), -Math.sin(h)];
  const along = (vector, axis) => vector.x * axis[0] + vector.y * axis[1];
  const accel = { x: v.x - before.x, y: v.y - before.y };
  const pitch = -Math.atan((along(accel, forward) + DRAG * along(v, forward)) / G) * 180 / Math.PI;
  const roll = Math.atan((along(accel, right) + DRAG * along(v, right)) / G) * 180 / Math.PI;
  const measured = position.roll != null && position.pitch != null;
  return { measured, pitch: clamp(measured ? position.pitch : pitch, -MAX_TILT, MAX_TILT), roll: clamp(measured ? position.roll : roll, -MAX_TILT, MAX_TILT), heading: ((position.heading ?? 0) + 360) % 360, speed: Math.hypot(v.x, v.y), climb: v.z, alt: position.rel_alt_m };
}

export function createHud(canvas) {
  const ctx = canvas.getContext('2d');
  let last = null, w = 0, h = 0;

  function resize() {
    const box = canvas.getBoundingClientRect();
    if (!box.width) return false;
    w = box.width; h = box.height;
    canvas.width = Math.round(w * devicePixelRatio);
    canvas.height = Math.round(h * devicePixelRatio);
    return true;
  }

  function text(value, x, y, { size = 11, color = C.text, align = 'center', weight = 600 } = {}) {
    ctx.font = `${weight} ${size}px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;
    ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.fillText(value, x, y);
  }

  function horizon(a, cx, cy) {
    const ppd = h / PITCH_SPAN;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rad(-a.roll));
    const y = a.pitch * ppd, big = w * 2;
    const sky = ctx.createLinearGradient(0, y - h, 0, y);
    sky.addColorStop(0, C.skyHigh); sky.addColorStop(1, C.sky);
    ctx.fillStyle = sky; ctx.fillRect(-big, y - big, big * 2, big);
    const ground = ctx.createLinearGradient(0, y, 0, y + h);
    ground.addColorStop(0, C.ground); ground.addColorStop(1, C.groundLow);
    ctx.fillStyle = ground; ctx.fillRect(-big, y, big * 2, big);
    ctx.strokeStyle = C.white; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-big, y); ctx.lineTo(big, y); ctx.stroke();
    ctx.lineWidth = 1;
    for (let p = -30; p <= 30; p += 5) {
      if (!p) continue;
      const py = y - p * ppd, half = p % 10 ? 12 : 26;
      if (Math.abs(py) > h * 0.36) continue;
      ctx.beginPath(); ctx.moveTo(-half, py); ctx.lineTo(half, py); ctx.stroke();
      if (!(p % 10)) { text(String(Math.abs(p)), -half - 11, py, { size: 9 }); text(String(Math.abs(p)), half + 11, py, { size: 9 }); }
    }
    ctx.restore();
  }

  function rollScale(a, cx, cy) {
    const r = Math.min(w, h) * 0.36;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = C.white; ctx.fillStyle = C.white; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(0, 0, r, rad(-150), rad(-30)); ctx.stroke();
    for (const tick of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
      const angle = rad(tick - 90), len = Math.abs(tick) % 30 ? 5 : 9;
      ctx.beginPath(); ctx.moveTo(Math.cos(angle) * r, Math.sin(angle) * r); ctx.lineTo(Math.cos(angle) * (r + len), Math.sin(angle) * (r + len)); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -r - 1); ctx.lineTo(-5, -r - 9); ctx.lineTo(5, -r - 9); ctx.closePath(); ctx.fill();
    ctx.rotate(rad(-a.roll));
    ctx.fillStyle = C.marker;
    ctx.beginPath(); ctx.moveTo(0, -r + 1); ctx.lineTo(-6, -r + 10); ctx.lineTo(6, -r + 10); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function aircraft(cx, cy) {
    ctx.save();
    ctx.strokeStyle = C.marker; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(cx - 46, cy); ctx.lineTo(cx - 18, cy); ctx.lineTo(cx - 10, cy + 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx + 46, cy); ctx.lineTo(cx + 18, cy); ctx.lineTo(cx + 10, cy + 8); ctx.stroke();
    ctx.fillStyle = C.marker; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function headingTape(a) {
    const top = 0, height = 26, cx = w / 2, ppd = 3;
    ctx.fillStyle = C.panel; ctx.fillRect(0, top, w, height);
    ctx.strokeStyle = C.white; ctx.lineWidth = 1;
    const names = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = Math.floor((a.heading - 60) / 5) * 5; d <= a.heading + 60; d += 5) {
      const x = cx + (d - a.heading) * ppd, value = ((d % 360) + 360) % 360;
      if (x < 4 || x > w - 4) continue;
      const major = !(value % 15);
      ctx.beginPath(); ctx.moveTo(x, height); ctx.lineTo(x, height - (major ? 7 : 4)); ctx.stroke();
      if (!(value % 30)) text(names[value] ?? String(value), x, 9, { size: 10, color: names[value] ? C.marker : C.text });
    }
    ctx.fillStyle = '#0a1424'; ctx.fillRect(cx - 22, top, 44, height - 2);
    ctx.strokeStyle = C.marker; ctx.strokeRect(cx - 22, top + 0.5, 44, height - 3);
    text(`${String(Math.round(a.heading) % 360).padStart(3, '0')}°`, cx, top + height / 2 - 1, { size: 12 });
  }

  function tape(value, { x, side, step, label, unit, ppu, digits }) {
    const width = 50, top = 44, bottom = h - 42, cy = (top + bottom) / 2;
    ctx.fillStyle = C.panel; ctx.fillRect(x, top, width, bottom - top);
    ctx.save();
    ctx.beginPath(); ctx.rect(x, top, width, bottom - top); ctx.clip();
    ctx.strokeStyle = C.white; ctx.lineWidth = 1;
    const edge = side === 'left' ? x + width : x, dir = side === 'left' ? -1 : 1;
    for (let v = Math.floor((value - 60 / ppu) / step) * step; v <= value + 60 / ppu; v += step) {
      const y = cy - (v - value) * ppu;
      const major = Math.abs(v / (step * 2) - Math.round(v / (step * 2))) < 1e-6;
      ctx.beginPath(); ctx.moveTo(edge, y); ctx.lineTo(edge + dir * (major ? 8 : 4), y); ctx.stroke();
      if (major && v >= 0) text(v.toFixed(digits), edge + dir * 26, y, { size: 9, color: C.muted });
    }
    ctx.restore();
    ctx.fillStyle = '#0a1424'; ctx.fillRect(x - 2, cy - 11, width + 4, 22);
    ctx.strokeStyle = C.marker; ctx.strokeRect(x - 1.5, cy - 10.5, width + 3, 21);
    text(value.toFixed(1), x + width / 2, cy, { size: 13 });
    text(label, x + width / 2, top - 8, { size: 9, color: C.text, weight: 500 });
    text(unit, x + width / 2, bottom + 9, { size: 9, color: C.muted, weight: 500 });
    return cy;
  }

  function statusBar({ phase, armed, time }) {
    const height = 22, y = h - height;
    ctx.fillStyle = C.panel; ctx.fillRect(0, y, w, height);
    text(armed ? '● 시동 ON' : '○ 시동 OFF', 10, y + height / 2, { size: 10, align: 'left', color: armed ? C.on : C.off });
    text(phase, w / 2, y + height / 2, { size: 11 });
    text(time, w - 10, y + height / 2, { size: 10, align: 'right', color: C.muted });
  }

  function draw(data = last) {
    last = data;
    if (!resize()) return;
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const a = data?.attitude ?? { pitch: 0, roll: 0, heading: 0, speed: 0, climb: 0, alt: 0 };
    const cx = w / 2, cy = 26 + (h - 48) / 2;
    horizon(a, cx, cy);
    rollScale(a, cx, cy);
    aircraft(cx, cy);
    headingTape(a);
    tape(a.speed, { x: 8, side: 'left', step: 1, label: '대지속도', unit: 'm/s', ppu: 12, digits: 0 });
    const altY = tape(a.alt, { x: w - 58, side: 'right', step: 5, label: '고도', unit: 'm', ppu: 3, digits: 0 });
    ctx.fillStyle = '#0a1424'; ctx.fillRect(w - 60, altY + 13, 54, 16);
    text(`${a.climb >= 0 ? '▲' : '▼'}${Math.abs(a.climb).toFixed(1)}`, w - 33, altY + 21, { size: 10, color: Math.abs(a.climb) < 0.2 ? C.muted : C.text });
    statusBar({ phase: data?.phase ?? '데이터 없음', armed: data?.armed ?? false, time: data?.time ?? '—' });
  }

  new ResizeObserver(() => draw()).observe(canvas);
  return { draw };
}
