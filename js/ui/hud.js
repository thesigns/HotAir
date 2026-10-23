import { LADDER, PROPANE, VIEW } from '../config.js';
import { clamp, formatMeters, wrapAngle } from '../core/utils.js';
import { rate } from '../core/flight.js';

const FONT = 'ui-rounded, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const TITLE = '"Grandstander", ui-rounded, system-ui, sans-serif';
const INK = 'rgba(255,252,244,0.97)';
const DIM = 'rgba(255,252,244,0.72)';
const AMBER = '#ffc53d';
const RED = '#ff6a50';
const GREEN = '#8fe06a';
// green: takes you further from the launch … red: brings you back
const awayColor = (away) => (away > 0.7 ? GREEN : away > 0.2 ? '#e8f0a0' : away > -0.2 ? AMBER : RED);
export const RATING_COLORS = { EXCEPTIONAL: '#ffd84a', GOOD: GREEN, ROUGH: '#ffa64d', CRASH: RED };

// 2D overlay (GDD §9): the distance from the launch, the propane, the wind ladder with the variometer,
// prompts, the crew's radio lines and the rating popups. Laid out for a 390 px phone, scaled up on a computer.
export class Hud {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.popup = null;      // { title, sub, color, time, duration }
    this.notice = null;     // { text, color, time }
    this.left = 60;         // room for the pause button
    this.bottom = 186;      // room for the buttons
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    this.scale = clamp(Math.min(W / VIEW.hudWidth, H / VIEW.hudHeight), 1, VIEW.hudMaxScale);
    this.w = W / this.scale;
    this.h = H / this.scale;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
  }

  showRating(title, sub, color, time = 3) { this.popup = { title, sub, color, time, duration: time }; }
  showNotice(text, color = INK, time = 3.5) { this.notice = { text, color, time }; }

  text(str, x, y, size, color = INK, align = 'left', weight = 700, font = FONT, maxWidth = 0) {
    const c = this.ctx;
    c.font = `${weight} ${size}px ${font}`;
    c.textAlign = align;
    c.fillStyle = color;
    if (maxWidth > 0) c.fillText(str, x, y, maxWidth);
    else c.fillText(str, x, y);
  }

  // Digits in fixed cells, so a growing number doesn't jitter (canvas has no tabular-nums).
  digits(str, x, y, size, color = INK) {
    const c = this.ctx;
    c.font = `800 ${size}px ${FONT}`;
    c.textAlign = 'center';
    c.fillStyle = color;
    const cell = c.measureText('0').width;
    for (const ch of str) {
      const w = /\d/.test(ch) ? cell : c.measureText(ch).width;
      c.fillText(ch, x + w / 2, y);
      x += w;
    }
    return x;
  }

  draw(dt, st) {
    const c = this.ctx;
    const { w, h } = this;
    c.clearRect(0, 0, w, h);
    if (!st.playing) { this.drawPopup(c, dt); return; }
    const { flight } = st;
    const b = flight.balloon;
    const blink = Math.floor(performance.now() / 400) % 2 === 0;
    c.shadowColor = 'rgba(0,0,0,0.5)';
    c.shadowBlur = 5;
    c.textBaseline = 'alphabetic';

    // the distance from the launch field
    const left = this.left;
    this.text('FROM LAUNCH', left, 20, 11, DIM, 'left', 700);
    const x = this.digits(formatMeters(flight.distance), left, 50, 30);
    this.text('m', x + 4, 50, 17, DIM, 'left', 700);
    // how fast and which way the balloon goes over the ground: up = away from the launch
    if (flight.phase !== 'launch') {
      const v = Math.hypot(b.vx, b.vz);
      const rel = wrapAngle(Math.atan2(b.vx, -b.vz) - (flight.ref ?? 0));
      if (v > 0.3) this.arrow(c, left + 8, 67, rel, 14, awayColor(Math.cos(rel)), 1);
      this.text(`${Math.round(v * 3.6)} km/h`, left + 22, 72, 15, INK, 'left', 800);
    }

    // the propane: one segment per cylinder, the reserve marked
    this.propane(c, w - 16 - 124, 14, 124, b, blink);

    // the wind ladder and the variometer
    this.ladder(c, st, w - 26, 92, h - this.bottom - 24);

    // prompts, most urgent first
    let prompt = null, color = INK;
    if (flight.phase === 'launch') prompt = 'Hold BURN to take off';
    else if (flight.phase === 'ground' && b.deflate < 1) { prompt = blink ? 'Hold VENT to deflate' : ''; color = AMBER; }
    else if (flight.inTrees) { prompt = blink ? 'IN THE TREES – BURN' : ''; color = RED; }
    else if (b.propane <= 0 && flight.phase === 'air') { prompt = 'Propane gone – hold BURN for the last vapour'; color = AMBER; }
    if (prompt) this.text(prompt, w / 2 - 10, 108, 18, color, 'center', 800, FONT, w - 110);
    // close to the ground: the sink rate and the landing it would be now
    if (flight.phase === 'air' && flight.agl < 40) {
      const sink = Math.max(0, -b.vy), r = rate(sink);
      this.text(`${sink.toFixed(1)} m/s · ${r}`, w / 2 - 20, h - this.bottom - 6, 20, RATING_COLORS[r], 'center', 900, TITLE, w - 120);
    }
    if (this.notice) {
      this.text(this.notice.text, w / 2 - 10, 134, 15, this.notice.color, 'center', 700, FONT, w - 110);
      this.notice.time -= dt;
      if (this.notice.time <= 0) this.notice = null;
    }

    this.drawPopup(c, dt);
    if (st.debug) this.drawDebug(c, st);
    c.shadowBlur = 0;
  }

  propane(c, x, y, width, b, blink) {
    const cyl = Math.max(1, Math.round(b.full / PROPANE.cylinder));
    const frac = b.full > 0 ? b.propane / b.full : 0;
    const reserve = PROPANE.reserve;
    const low = frac < reserve;
    this.text(b.propane <= 0 ? 'NO PROPANE' : low ? 'RESERVE' : 'PROPANE', x + width, y + 6, 11, low ? AMBER : DIM, 'right', 800);
    const by = y + 12, bh = 14, gap = 4;
    const seg = (width - gap * (cyl - 1)) / cyl;
    c.save();
    c.shadowBlur = 3;
    for (let i = 0; i < cyl; i++) {
      const sx = x + i * (seg + gap);
      c.fillStyle = 'rgba(20,22,26,0.55)';
      c.fillRect(sx, by, seg, bh);
      const fill = clamp(frac * cyl - i, 0, 1);
      c.fillStyle = b.propane <= 0 ? RED : low ? (blink ? AMBER : '#c98f20') : '#ffe2a8';
      c.fillRect(sx, by, seg * fill, bh);
    }
    // where the reserve starts
    c.shadowBlur = 0;
    c.fillStyle = AMBER;
    const r = reserve * cyl, rx = x + Math.floor(r) * (seg + gap) + (r % 1) * seg;
    c.fillRect(rx - 1, by - 3, 2, bh + 6);
    c.strokeStyle = b.propane <= 0 ? RED : 'rgba(255,252,244,0.5)';
    c.lineWidth = 1.5;
    for (let i = 0; i < cyl; i++) c.strokeRect(x + i * (seg + gap), by, seg, bh);
    c.restore();
  }

  // The wind ladder (GDD §9): a scale from the ground up; arrows at the heights the pilot knows, drawn relative
  // to "away from the launch" (up = this layer takes you further), fading with age; the balloon's height and
  // its climb or sink.
  ladder(c, st, x, top, bottom) {
    const { flight } = st;
    const yOf = (agl) => bottom - clamp(agl / LADDER.top, 0, 1) * (bottom - top);
    c.save();
    c.shadowBlur = 3;
    c.strokeStyle = 'rgba(255,252,244,0.55)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(x, top);
    c.lineTo(x, bottom);
    c.stroke();
    for (let m = 0; m <= LADDER.top; m += 100) {
      const y = yOf(m);
      c.beginPath();
      c.moveTo(x - 5, y);
      c.lineTo(x + 5, y);
      c.stroke();
      if (m > 0) this.text(String(m), x + 8, y + 4, 10, DIM, 'left', 700);
    }
    // the arrows
    const ref = flight.ref ?? 0;
    for (let i = 0; i < flight.ladder.length; i++) {
      const e = flight.ladder[i];
      if (!e) continue;
      const age = flight.t - e.t;
      const alpha = clamp(1 - (age - LADDER.fresh) / (LADDER.stale - LADDER.fresh), 0.3, 1);
      const rel = wrapAngle(e.dir + Math.PI - ref);
      const len = 6 + 16 * clamp(e.speed * 3.6 / LADDER.maxKmh, 0, 1);
      const ay = yOf(i * LADDER.bin);
      this.arrow(c, x - 18, ay, rel, len, awayColor(Math.cos(rel)), alpha);
      if ((i * LADDER.bin) % 50 === 0) {
        c.globalAlpha = alpha;
        this.text(String(Math.round(e.speed * 3.6)), x - 32, ay + 4, 11, DIM, 'right', 800);
        c.globalAlpha = 1;
      }
    }
    // the balloon: its height and the variometer
    const agl = Math.max(0, flight.agl);
    const y = yOf(agl), vy = flight.balloon.vy;
    c.globalAlpha = 1;
    c.fillStyle = INK;
    c.beginPath();
    c.moveTo(x - 3, y);
    c.lineTo(x - 12, y - 6);
    c.lineTo(x - 12, y + 6);
    c.closePath();
    c.fill();
    this.text(`${Math.round(agl)} m`, x - 52, y - 9, 13, INK, 'right', 800);
    const vcol = vy > 0.25 ? GREEN : vy < -2 ? RED : vy < -0.25 ? AMBER : DIM;
    const sign = vy > 0.05 ? '▲' : vy < -0.05 ? '▼' : '•';
    this.text(`${sign} ${Math.abs(vy).toFixed(1)}`, x - 52, y + 9, 13, vcol, 'right', 800);
    c.restore();
  }

  arrow(c, cx, cy, ang, len, color, alpha) {
    const dx = Math.sin(ang), dy = -Math.cos(ang);
    const x0 = cx - dx * len / 2, y0 = cy - dy * len / 2, x1 = cx + dx * len / 2, y1 = cy + dy * len / 2;
    c.globalAlpha = alpha;
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 2.5;
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(x1 - dx * 4, y1 - dy * 4);
    c.stroke();
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x1 - dx * 7 - dy * 4.5, y1 - dy * 7 + dx * 4.5);
    c.lineTo(x1 - dx * 7 + dy * 4.5, y1 - dy * 7 - dx * 4.5);
    c.closePath();
    c.fill();
    c.globalAlpha = 1;
  }

  drawPopup(c, dt) {
    const p = this.popup;
    if (!p) return;
    p.time -= dt;
    if (p.time <= 0) { this.popup = null; return; }
    const age = p.duration - p.time;
    const pop = age < 0.18 ? 0.7 + age / 0.18 * 0.3 : 1;
    const alpha = clamp(p.time / 0.4, 0, 1);
    const { w, h } = this;
    c.save();
    c.globalAlpha = alpha;
    c.shadowColor = 'rgba(0,0,0,0.55)';
    c.shadowBlur = 8;
    c.translate(w / 2, h * 0.3);
    c.scale(pop, pop);
    this.text(p.title, 0, 0, 46, p.color, 'center', 900, TITLE, w - 30);
    if (p.sub) this.text(p.sub, 0, 30, 17, INK, 'center', 700, FONT, w - 40);
    c.restore();
  }

  drawDebug(c, st) {
    const { flight, fps } = st;
    const b = flight.balloon;
    const lines = [
      `${fps.toFixed(0)} fps · seed ${st.seed}`,
      `phase ${flight.phase} · t ${flight.t.toFixed(1)}`,
      `agl ${flight.agl.toFixed(1)} vy ${b.vy.toFixed(2)}`,
      `T ${(b.T - 273.15).toFixed(1)}°C eq ${(b.equilibrium(b.y) - 273.15).toFixed(1)}`,
      `net ${(b.net / 9.81).toFixed(0)} kg · m ${b.mass.toFixed(0)}`,
      `propane ${b.propane.toFixed(1)} s · v ${(Math.hypot(b.vx, b.vz) * 3.6).toFixed(1)} km/h`,
    ];
    c.save();
    c.shadowBlur = 0;
    c.fillStyle = 'rgba(0,0,0,0.45)';
    c.fillRect(8, this.h - this.bottom - 14 - lines.length * 14, 210, lines.length * 14 + 8);
    lines.forEach((l, i) => this.text(l, 14, this.h - this.bottom - 14 - (lines.length - 1 - i) * 14, 11, INK, 'left', 600));
    c.restore();
  }
}
