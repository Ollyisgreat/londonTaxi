// All sounds are synthesised with WebAudio — no audio files needed.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(c.destination);
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    // electric drive whine + low hum
    this.motorGain = c.createGain();
    this.motorGain.gain.value = 0;
    this.m1 = c.createOscillator();
    this.m1.type = 'sine';
    this.m2 = c.createOscillator();
    this.m2.type = 'triangle';
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    this.m1.connect(lp);
    this.m2.connect(lp);
    lp.connect(this.motorGain);
    this.motorGain.connect(this.master);
    this.m1.start();
    this.m2.start();
    // range-extender engine rumble
    this.eng = c.createOscillator();
    this.eng.type = 'sawtooth';
    this.engGain = c.createGain();
    this.engGain.gain.value = 0;
    const elp = c.createBiquadFilter();
    elp.type = 'lowpass';
    elp.frequency.value = 220;
    this.eng.connect(elp);
    elp.connect(this.engGain);
    this.engGain.connect(this.master);
    this.eng.frequency.value = 38;
    this.eng.start();
    // road / tyre noise
    this.roadGain = this.noiseLayer('lowpass', 500);
    this.rainGain = this.noiseLayer('highpass', 2200);
    this.ambGain = this.noiseLayer('bandpass', 350);
    this.ambGain.gain.value = 0.03;
  }
  noiseLayer(type, f) {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = c.createGain();
    g.gain.value = 0;
    s.connect(fl);
    fl.connect(g);
    g.connect(this.master);
    s.start();
    return g;
  }
  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }
  update(speed, throttle, raining, inside) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const v = Math.abs(speed);
    const f = 140 + v * 38;
    this.m1.frequency.setTargetAtTime(f, t, 0.08);
    this.m2.frequency.setTargetAtTime(f * 0.5, t, 0.08);
    this.motorGain.gain.setTargetAtTime(0.012 + 0.03 * throttle + Math.min(v / 22, 1) * 0.02, t, 0.1);
    this.engGain.gain.setTargetAtTime(0.05 + 0.04 * throttle, t, 0.2);
    this.eng.frequency.setTargetAtTime(36 + throttle * 10 + v * 0.6, t, 0.2);
    this.roadGain.gain.setTargetAtTime(Math.min(v / 20, 1) * (inside ? 0.08 : 0.14), t, 0.1);
    this.rainGain.gain.setTargetAtTime(raining ? (inside ? 0.05 : 0.08) : 0, t, 0.6);
  }
  tone(freq, dur, type = 'sine', vol = 0.2, delay = 0, slide = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }
  noise(dur, f = 1000, vol = 0.3, type = 'bandpass', delay = 0) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const fl = c.createBiquadFilter();
    fl.type = type;
    fl.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }
  click() { this.tone(2400, 0.02, 'square', 0.05); this.tone(1600, 0.02, 'square', 0.04, 0.05); }
  key() { this.tone(1900, 0.06, 'square', 0.06); }
  beep() { this.tone(1800, 0.12, 'sine', 0.15); }
  approved() { this.tone(1500, 0.12, 'sine', 0.15); this.tone(2000, 0.2, 'sine', 0.15, 0.13); }
  declined() { this.tone(400, 0.25, 'square', 0.1); this.tone(300, 0.35, 'square', 0.1, 0.27); }
  meterTick() { this.tone(3200, 0.03, 'square', 0.025); }
  meterStart() { this.tone(1200, 0.08, 'sine', 0.12); this.tone(1600, 0.1, 'sine', 0.12, 0.09); }
  lock() { this.noise(0.06, 900, 0.25); this.tone(180, 0.05, 'square', 0.08); }
  door() { this.noise(0.25, 300, 0.5, 'lowpass'); this.tone(90, 0.15, 'sine', 0.3, 0.02); }
  coins() { for (let k = 0; k < 4; k++) this.tone(3500 + Math.random() * 2500, 0.08, 'sine', 0.05, k * 0.05); }
  note() { this.noise(0.15, 3000, 0.12, 'highpass'); }
  printer() { for (let k = 0; k < 14; k++) this.noise(0.05, 2400, 0.08, 'bandpass', k * 0.07); }
  crash(v) { this.noise(0.4, 400, Math.min(0.9, 0.15 + v * 0.06), 'lowpass'); this.noise(0.25, 2500, Math.min(0.5, v * 0.04), 'bandpass', 0.02); }
  chime() { this.tone(880, 0.25, 'sine', 0.12); this.tone(660, 0.35, 'sine', 0.12, 0.22); }
  cash() { this.tone(2600, 0.08, 'triangle', 0.12); this.tone(3400, 0.25, 'triangle', 0.1, 0.08); }
  fine() { this.tone(500, 0.2, 'sawtooth', 0.08); this.tone(380, 0.35, 'sawtooth', 0.08, 0.2); }
  horn(dur = 0.4, dist = 0) {
    const vol = 0.15 / (1 + dist / 25);
    this.tone(415, dur, 'square', vol);
    this.tone(520, dur, 'square', vol * 0.8);
  }
  startHorn() {
    if (!this.ctx || this.hornNodes) return;
    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0.12;
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = o2.type = 'square';
    o1.frequency.value = 392;
    o2.frequency.value = 494;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(this.master);
    o1.start(); o2.start();
    this.hornNodes = [o1, o2, g];
  }
  stopHorn() {
    if (!this.hornNodes) return;
    const [o1, o2] = this.hornNodes;
    o1.stop(); o2.stop();
    this.hornNodes = null;
  }
}
