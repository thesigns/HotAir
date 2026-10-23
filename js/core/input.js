const buzz = (ms) => { try { navigator.vibrate?.(ms); } catch { /* not supported */ } };

// Controls (GDD §4): BURN under the right thumb and VENT under the left, both held; the camera is dragged
// (orbit), pinched (zoom) and double-tapped (reset) anywhere outside the buttons. Keyboard and mouse on
// a computer. Pointer Events throughout, so several fingers work at once.
export class Input {
  constructor(canvas) {
    this.enabled = false;
    this.burnKey = false;
    this.ventKey = false;
    this.burnTouch = null;      // pointer id holding the button
    this.ventTouch = null;
    this.onPause = null;
    this.onOrbit = null;        // (dx, dy) in px
    this.onZoom = null;         // (factor) > 1 = closer
    this.onReset = null;
    this.pointers = new Map();  // camera gestures: id → { x, y }
    this.pinch = 0;
    this.lastTap = { t: 0, x: 0, y: 0 };
    this.buzzAt = 0;
    this.haptics = true;
    this.toggleBurn = false;    // settings: tap to start and tap to stop the burner
    this.latched = false;       // the burner, switched on in that mode
    this.burnBtn = document.getElementById('burn-btn');

    this.hold(document.getElementById('burn-btn'), 'burnTouch');
    this.hold(document.getElementById('vent-btn'), 'ventTouch');
    document.getElementById('pause-btn').addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onPause?.(); });
    this.bindCamera(canvas);
    this.bindKeyboard();
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('blur', () => this.release());
  }

  get burn() { return this.enabled && (this.latched || this.burnKey || this.burnTouch !== null); }

  buzz(ms) { if (this.haptics) buzz(ms); }

  latch(on) {
    this.latched = on;
    this.burnBtn.classList.toggle('latched', on);
    this.buzz(on ? 18 : 8);
  }
  get vent() { return this.enabled && (this.ventKey || this.ventTouch !== null); }

  release() {
    this.burnKey = this.ventKey = false;
    if (this.latched) this.latch(false);
    this.burnTouch = this.ventTouch = null;
    this.pointers.clear();
    for (const id of ['burn-btn', 'vent-btn']) document.getElementById(id).classList.remove('pressed');
  }

  // A button that works while it is held.
  hold(el, slot) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.enabled || this[slot] !== null) return;
      if (slot === 'burnTouch' && this.toggleBurn) { this.latch(!this.latched); return; }
      try { el.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this[slot] = e.pointerId;
      el.classList.add('pressed');
      this.buzz(18);
    });
    const up = (e) => {
      if (this[slot] !== e.pointerId) return;
      this[slot] = null;
      el.classList.remove('pressed');
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  // Haptic pulses while the burner roars.
  tick(burning) {
    const now = performance.now();
    if (burning && now > this.buzzAt) { this.buzz(14); this.buzzAt = now + 380; }
  }

  bindCamera(canvas) {
    canvas.addEventListener('pointerdown', (e) => {
      try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
      if (this.pointers.size === 2) this.pinch = this.spread();
    });
    canvas.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      if (this.pointers.size === 1) this.onOrbit?.(dx, dy);
      else if (this.pointers.size === 2) {
        const s = this.spread();
        if (this.pinch > 0 && s > 0) this.onZoom?.(s / this.pinch);
        this.pinch = s;
      }
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      this.pointers.delete(e.pointerId);
      this.pinch = this.pointers.size === 2 ? this.spread() : 0;
      // a tap: short and still; two taps close together reset the view
      const now = performance.now();
      if (e.type === 'pointerup' && now - p.t0 < 250 && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < 12) {
        const l = this.lastTap;
        if (now - l.t < 320 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 40) {
          this.onReset?.();
          l.t = 0;
        } else {
          Object.assign(l, { t: now, x: e.clientX, y: e.clientY });
        }
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.onZoom?.(Math.exp(-e.deltaY * 0.0012));
    }, { passive: false });
    canvas.addEventListener('dblclick', (e) => { e.preventDefault(); this.onReset?.(); });
  }

  spread() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  bindKeyboard() {
    const set = (e, down) => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': case 'Space':
          if (!this.toggleBurn) this.burnKey = down;
          else if (down && this.enabled) this.latch(!this.latched);
          break;
        case 'KeyS': case 'ArrowDown': this.ventKey = down; break;
        default: return false;
      }
      return true;
    };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (e.code === 'KeyP' || e.code === 'Escape') { if (!e.repeat) this.onPause?.(); return; }
      if (e.repeat) return;
      if (set(e, true) && this.burnKey && this.enabled) this.buzz(18);
    });
    window.addEventListener('keyup', (e) => set(e, false));
  }
}
