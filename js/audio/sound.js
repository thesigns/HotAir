import { clamp } from '../core/utils.js';

// Sound synthesized with Web Audio – no audio files (GDD §11). The burner's roar is the signature sound;
// otherwise a balloon is silent (it moves with the air), and what the player hears is the ground below,
// fading with height: birdsong in the morning.
export class Sound {
  constructor() {
    this.ctx = null;
    this.burnWas = false;
    this.nextBird = 0;
  }

  // Must be called from a user-gesture handler (autoplay policy).
  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filter = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
    const noise = () => {
      const s = ctx.createBufferSource();
      s.buffer = this.noise;
      s.loop = true;
      s.start(0, Math.random() * 1.9);
      return s;
    };
    const lfo = (f, depth, target) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = gain(depth);
      o.connect(g).connect(target);
      o.start();
    };

    // the burner: a deep roar, a rumble under it and a hiss on top, all fluttering a little
    this.burner = gain();
    this.flutter = gain(1);
    lfo(11, 0.12, this.flutter.gain);
    this.burner.connect(this.flutter).connect(this.master);
    const roar = filter('bandpass', 260, 0.7);
    noise().connect(roar).connect(gain(1.6)).connect(this.burner);
    lfo(5.3, 60, roar.frequency);
    noise().connect(filter('lowpass', 110, 1.2)).connect(gain(2.4)).connect(this.burner);
    noise().connect(filter('highpass', 2600, 0.5)).connect(gain(0.18)).connect(this.burner);

    // the vent: the envelope fabric rustles, hot air rushes out of the top
    this.vent = gain();
    const rustle = filter('bandpass', 1100, 0.9);
    noise().connect(rustle).connect(this.vent).connect(this.master);
    lfo(6.5, 300, rustle.frequency);

    // the basket scraping over the ground
    this.scrape = gain();
    noise().connect(filter('lowpass', 420, 0.8)).connect(this.scrape).connect(this.master);
  }

  // st: { burn, vapour, vent, agl, drag (m/s on the ground), camDist, playing }
  update(st) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // closer to the camera, louder
    const near = clamp(1.15 - Math.log10(st.camDist / 8) * 0.38, 0.35, 1.1);
    const burn = st.burn ? 1 : st.vapour ? 0.3 + Math.random() * 0.25 : 0;
    this.burner.gain.setTargetAtTime(burn * 0.32 * near, t, burn > 0 ? 0.04 : 0.12);
    if (st.burn !== this.burnWas) {
      this.thump(0.12, st.burn ? 520 : 380, 160, 0.05);   // the blast valve
      this.burnWas = st.burn;
    }
    this.vent.gain.setTargetAtTime(st.vent ? 0.05 * near : 0, t, 0.08);
    this.scrape.gain.setTargetAtTime(clamp(st.drag, 0, 2) * 0.12, t, 0.1);

    // birds below, fading with height
    if (st.playing && t > this.nextBird) {
      const loud = clamp(1 - st.agl / 140, 0, 1);
      if (loud > 0.05) this.chirp(loud * 0.05);
      this.nextBird = t + 0.6 + Math.random() * 2.6;
    }
  }

  chirp(volume) {
    const ctx = this.ctx, t0 = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 4), base = 2800 + Math.random() * 1800;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * (0.09 + Math.random() * 0.05);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base, t);
      o.frequency.exponentialRampToValueAtTime(base * (1.25 + Math.random() * 0.3), t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volume, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  burst(volume, freq, decay, q = 0.8, type = 'bandpass') {
    if (!this.ctx || volume < 0.005) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * Math.max(0, 1.9 - decay), decay + 0.05);
  }

  thump(volume, from, to, decay) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.02);
  }

  tone(freq, volume, decay, delay = 0, partials = [[1, 1], [2, 0.2]]) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    for (const [mul, amp] of partials) {
      const o = ctx.createOscillator();
      o.frequency.value = freq * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(volume * amp, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  // the basket meets the ground: a thump and the wicker creaks
  touchdown(sink) {
    this.thump(clamp(0.25 + sink * 0.25, 0.2, 0.9), 150, 55, 0.3);
    this.burst(clamp(0.1 + sink * 0.1, 0.1, 0.4), 700, 0.35, 1.2);
  }

  rating(name) {
    const seq = { EXCEPTIONAL: [523, 659, 784, 1047], GOOD: [523, 659, 784], ROUGH: [440, 392] }[name];
    if (!seq) return;
    seq.forEach((f, i) => this.tone(f, 0.14, 0.5, i * 0.1));
  }

  // the crew on the radio: a squelch before the line
  radio() {
    this.burst(0.08, 2200, 0.12, 1.5);
    this.tone(1400, 0.03, 0.06, 0, [[1, 1]]);
  }

  crash(reason) {
    if (reason === 'water') {
      this.burst(0.7, 600, 1.4, 0.5, 'lowpass');
      this.burst(0.3, 2400, 0.8, 0.8);
    } else {
      this.burst(0.8, 500, 1.2, 0.4, 'lowpass');
      this.burst(0.4, 1800, 0.7, 2);
      this.thump(0.8, 110, 35, 0.7);
    }
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
