import { CELL_M, HOME, plantCells, stateAt, targetTime } from './flight.mjs';

const STEP_MS = 40;
const DRAG_PX = 5;
const CENTER = { x: 35, y: 30 };
const HALF = CELL_M / 2;
const CAMERA = 230;
const DRONE_ARM = 4.5;
const PAD_RADIUS = 8;
const ROUTE_LANDING_MS = 3000;
const PANEL_GAP = 1.6;
const PANEL_LOW_M = 2;
const PANEL_HIGH_M = 6.5;
const PANEL_THICK_M = 0.7;
const SHADOW_SLANT = 0.9;
const COLORS = { ground: '#8aa779', field: '#7e9d6c', panelShadow: 'rgba(23, 36, 59, 0.16)', post: '#6f7d92', panelEdge: '#3b475b', frame: 'rgba(84, 99, 122, 0.55)', line: '#ffffff', active: '#f2b632', label: '#ffffff', activeLabel: '#17243b', pad: '#94a3b8', padMark: '#ffffff', trail: '#2563eb', shadow: '#55657d', tether: '#55657d', drone: '#17243b', rotor: '#2563eb', rotorDisc: 'rgba(37, 99, 235, 0.3)', capture: 'rgba(242, 182, 50, 0.4)' };
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cells = plantCells();
// Fixed world-space blades keep the texture still while the camera or drone moves.
const grass = Array.from({length:1100}, (_,i) => {
  const random = salt => { const n=Math.sin((i+1)*salt)*43758.5453; return n-Math.floor(n); };
  return {x:-47+random(12.9898)*164,y:-17+random(78.233)*94,length:0.35+random(39.425)*0.65,lean:(random(24.617)-0.5)*0.7};
});

// Draws the plant, launch pad and drone on a canvas. Screens supply the flight and the cell colours.
export function createScene(canvas, { fillOf, isActive, onCellClick, onRender }) {
  const ctx = canvas.getContext('2d');
  const view = { az: -0.45, el: 0.72, w: 0, h: 0 };
  let flight = null, t = 0, target = 0, rate = 0, stepId = 0, drag = null;

  // The grid is drawn with row A at the back so it reads the same way as the 2D site map.
  function project(x, y, z = 0) {
    const X = x - CENTER.x, Y = CENTER.y - y;
    const rx = Math.cos(view.az) * X - Math.sin(view.az) * Y;
    const ry = Math.sin(view.az) * X + Math.cos(view.az) * Y;
    const depth = ry * Math.cos(view.el) - z * Math.sin(view.el);
    const up = ry * Math.sin(view.el) + z * Math.cos(view.el);
    const k = CAMERA / (CAMERA + depth);
    const scale = Math.min(view.w / 205, view.h / 135);
    return [view.w / 2 + rx * k * scale, view.h * 0.44 - up * k * scale, k * scale];
  }
  function tracePolygon(points) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
  }
  function polygon(points, fill, stroke, width = 1) {
    tracePolygon(points);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke(); }
  }
  function circle(cx, cy, cz, radius, fill) {
    polygon(Array.from({ length: 24 }, (_, i) => project(cx + Math.cos(i / 24 * Math.PI * 2) * radius, cy + Math.sin(i / 24 * Math.PI * 2) * radius, cz)), fill);
  }
  // Each cell is one panel table: raised on posts and tilted so its low edge faces the camera side (larger y).
  function panelPoint(cell, u, v) {
    const x = cell.x_m - HALF + PANEL_GAP + u * (CELL_M - PANEL_GAP * 2);
    const y = cell.y_m - HALF + PANEL_GAP + v * (CELL_M - PANEL_GAP * 2);
    return [x, y, PANEL_HIGH_M + (PANEL_LOW_M - PANEL_HIGH_M) * v];
  }
  function cellCorners(cell) {
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => project(...panelPoint(cell, u, v)));
  }
  // Far cells first, so nearer panels cover the posts and shadows behind them however the view is turned.
  function byDepth() {
    return [...cells].sort((a, b) => project(a.x_m, a.y_m)[2] - project(b.x_m, b.y_m)[2]);
  }
  function line(a, b, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  function drawCell(cell, state) {
    const { x_m: x, y_m: y, cell_id: id } = cell;
    const active = isActive(id, state);
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => panelPoint(cell, u, v));
    polygon(corners.map(([px, py, pz]) => project(px + pz * SHADOW_SLANT, py, 0)), COLORS.panelShadow);
    for (const [px, py, pz] of corners) {
      const inset = [px + (px < x ? 1 : -1), py + (py < y ? 1 : -1)];
      line(project(inset[0], inset[1], 0), project(inset[0], inset[1], pz - 0.1), COLORS.post, 1.4);
    }
    // Side frames from the ground up to the panel edge make the table read as a standing structure.
    for (const u of [0, 1]) {
      const [bx, by, bz] = panelPoint(cell, u, 0), [fx, fy, fz] = panelPoint(cell, u, 1);
      polygon([project(bx, by, 0), project(fx, fy, 0), project(fx, fy, fz - PANEL_THICK_M), project(bx, by, bz - PANEL_THICK_M)], COLORS.frame);
    }
    const frontTop = [panelPoint(cell, 0, 1), panelPoint(cell, 1, 1)];
    polygon([...frontTop.map(p => project(...p)), ...frontTop.reverse().map(([px, py, pz]) => project(px, py, pz - PANEL_THICK_M))], COLORS.panelEdge);
    polygon(cellCorners(cell), active ? COLORS.active : fillOf(id, state), COLORS.line, 1);
    for (let i = 1; i < 4; i += 1) line(project(...panelPoint(cell, 0, i / 4)), project(...panelPoint(cell, 1, i / 4)), 'rgba(255, 255, 255, 0.28)', 0.6);
    for (let i = 1; i < 6; i += 1) line(project(...panelPoint(cell, i / 6, 0)), project(...panelPoint(cell, i / 6, 1)), 'rgba(255, 255, 255, 0.16)', 0.5);
    const [lx, ly, scale] = project(...panelPoint(cell, 0.5, 0.5));
    ctx.fillStyle = active ? COLORS.activeLabel : COLORS.label;
    ctx.font = `600 ${Math.max(8, scale * 3.4)}px "Pretendard", "Malgun Gothic", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(id, lx, ly);
  }
  function drawGrass() {
    ctx.save();
    tracePolygon([[-48,-18],[118,-18],[118,78],[-48,78]].map(([x,y])=>project(x,y)));
    ctx.clip();
    for(let tone=0;tone<2;tone++) {
      ctx.beginPath();
      for(let i=tone;i<grass.length;i+=2) {
        const blade=grass[i],a=project(blade.x,blade.y),b=project(blade.x+blade.lean,blade.y-blade.length);
        ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);
      }
      ctx.strokeStyle=tone?'rgba(229,239,192,0.23)':'rgba(43,77,41,0.18)';
      ctx.lineWidth=0.7;ctx.stroke();
    }
    ctx.restore();
  }
  function drawPad() {
    const { x_m: x, y_m: y } = flight?.positions[0] ?? HOME;
    circle(x, y, 0, PAD_RADIUS, COLORS.pad);
    const [lx, ly, scale] = project(x, y);
    ctx.fillStyle = COLORS.padMark;
    ctx.font = `700 ${Math.max(9, scale * 5)}px "Pretendard", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('H', lx, ly);
  }
  // The trail is cleared once the drone has landed, so a finished flight leaves only the cell results.
  function drawTrail(phase) {
    if (!flight || phase === 'done') return;
    const points = flight.positions.filter(p => p.t <= t);
    for (const [z, color, alpha] of [[0, COLORS.shadow, 0.45], [null, COLORS.trail, 0.85]]) {
      ctx.beginPath();
      points.forEach((p, i) => {
        const [x, y] = project(p.x_m, p.y_m, z ?? p.rel_alt_m);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }
  function drawDrone(position, phase) {
    if (!position) return;
    const { x_m: x, y_m: y, rel_alt_m: z, heading = 0 } = position;
    ctx.globalAlpha = 0.45; circle(x, y, 0, DRONE_ARM * 0.9, COLORS.shadow); ctx.globalAlpha = 1;
    const top = project(x, y, z), bottom = project(x, y, 0);
    ctx.setLineDash([3, 4]); ctx.strokeStyle = COLORS.tether; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(bottom[0], bottom[1]); ctx.stroke();
    ctx.setLineDash([]);
    if (phase === 'capture') circle(x, y, 0.2, HALF * 0.8, COLORS.capture);
    const angle = heading * Math.PI / 180 + Math.PI / 4;
    const spin = reduceMotion || !stepId ? 0 : performance.now() / 40;
    const tips = [0, 1, 2, 3].map(i => [x + Math.cos(angle + i * Math.PI / 2) * DRONE_ARM, y + Math.sin(angle + i * Math.PI / 2) * DRONE_ARM]);
    for (const [tx, ty] of tips) {
      const a = project(x, y, z), b = project(tx, ty, z);
      ctx.strokeStyle = COLORS.drone; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (const [tx, ty] of tips) {
      circle(tx, ty, z + 0.3, 2.2, COLORS.rotorDisc);
      const a = project(tx + Math.cos(spin) * 2.2, ty + Math.sin(spin) * 2.2, z + 0.3), b = project(tx - Math.cos(spin) * 2.2, ty - Math.sin(spin) * 2.2, z + 0.3);
      ctx.strokeStyle = COLORS.rotor; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    circle(x, y, z + 0.5, 1.6, COLORS.drone);
  }
  function render() {
    const state = flight ? stateAt(flight, t) : null;
    if (view.w) {
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, view.w, view.h);
      polygon([[-48, -18], [118, -18], [118, 78], [-48, 78]].map(([x, y]) => project(x, y)), COLORS.ground);
      polygon([[-1, -1], [CELL_M * 6 + 1, -1], [CELL_M * 6 + 1, CELL_M * 4 + 1], [-1, CELL_M * 4 + 1]].map(([x, y]) => project(x - HALF, y - HALF)), COLORS.field);
      drawGrass();
      drawPad();
      byDepth().forEach(cell => drawCell(cell, state));
      drawTrail(state?.phase);
      drawDrone(state?.position, state?.phase);
    }
    if (state) onRender?.(state, t);
  }
  function stop() {
    clearInterval(stepId); stepId = 0;
  }
  function flyTo(next, ms) {
    stop();
    if (next <= t) { t = next; render(); return; }
    target = next;
    rate = (next - t) / Math.max(ms, 1);
    let last = performance.now();
    stepId = setInterval(() => {
      const now = performance.now();
      t = Math.min(target, t + (now - last) * rate);
      last = now;
      if (t >= target) stop();
      render();
    }, STEP_MS);
  }
  function resize() {
    const box = canvas.getBoundingClientRect();
    view.w = box.width; view.h = box.height;
    canvas.width = Math.round(box.width * devicePixelRatio);
    canvas.height = Math.round(box.height * devicePixelRatio);
    render();
  }
  function cellAt(clientX, clientY) {
    const box = canvas.getBoundingClientRect();
    const x = clientX - box.left, y = clientY - box.top;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const hit = byDepth().reverse().find(cell => { tracePolygon(cellCorners(cell)); return ctx.isPointInPath(x, y); });
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    return hit;
  }

  canvas.addEventListener('pointerdown', event => { drag = { x: event.clientX, y: event.clientY, moved: 0 }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    view.az += dx * 0.008;
    view.el = Math.min(1.4, Math.max(0.25, view.el + dy * 0.006));
    drag.x = event.clientX; drag.y = event.clientY;
    render();
  });
  canvas.addEventListener('pointerup', event => {
    const moved = drag?.moved ?? 0;
    drag = null;
    if (moved > DRAG_PX || !onCellClick) return;
    const cell = cellAt(event.clientX, event.clientY);
    if (cell) onCellClick(cell.cell_id);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  new ResizeObserver(resize).observe(canvas);

  return {
    render, stop, flyTo,
    setFlight(next) { flight = next; },
    setTime(next) { stop(); t = next; render(); },
    time: () => t
  };
}

// Moves a scene along a calculated reflight route. Both maps use this so their drones stay on the same cell.
export function followRoute(scene, plan, reflight, speed) {
  if (reflight.phase === 'idle') { scene.setTime(0); return; }
  if (reflight.phase === 'paused') { scene.stop(); scene.render(); return; }
  if (reflight.index === 0 && !reflight.activeId && scene.time() > 0) scene.setTime(0);
  const ms = reflight.phase === 'complete' ? ROUTE_LANDING_MS / speed : 1000 / speed;
  scene.flyTo(targetTime(plan, reflight), ms);
}

// A 3D/2D switch shared by the overview map and the reinspection map.
export function createViewToggle(onChange) {
  const toggle = document.createElement('div');
  toggle.className = 'map-view-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', '지도 보기 방식');
  toggle.innerHTML = '<button type="button" data-view="3d">3D 비행</button><button type="button" data-view="2d">2D 지도</button>';
  const set = next => {
    for (const button of toggle.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === next));
    onChange(next);
  };
  toggle.addEventListener('click', event => { if (event.target.dataset.view) set(event.target.dataset.view); });
  return { element: toggle, set };
}
