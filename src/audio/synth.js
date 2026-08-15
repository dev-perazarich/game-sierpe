/**
 * synth.js — Sintetizador WebAudio.
 *
 * Sin archivos que cargar, que es lo que encaja con la decisión de no tener
 * build: un oscilador, un filtro y una envolvente bastan para todo el diseño de
 * sonido del juego. También significa que el tema visual puede cambiar el timbre
 * (ver `waveform` y `filterCutoff` en cada tema) sin descargar nada nuevo.
 */

export class Synth {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.ambientBus = null;
    this.ready = false;
    this.ambientNodes = null;
    this.noiseBuffer = null;
  }

  /**
   * El contexto solo puede crearse tras un gesto del usuario. Se llama desde el
   * primer clic; si falla, el juego sigue sin sonido en lugar de romperse.
   */
  init() {
    if (this.ready) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);

      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = 0.8;
      this.sfxBus.connect(this.master);

      this.ambientBus = this.ctx.createGain();
      this.ambientBus.gain.value = 0.4;
      this.ambientBus.connect(this.master);

      this.noiseBuffer = this._makeNoise();
      this.ready = true;
      return true;
    } catch {
      return false;
    }
  }

  resume() {
    if (this.ctx?.state === 'suspended') this.ctx.resume();
  }

  setVolumes({ master, sfx, ambient, muted }) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(muted ? 0 : master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
    this.ambientBus.gain.setTargetAtTime(ambient, t, 0.05);
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** Tono con envolvente ADSR simplificada. */
  tone({ freq = 440, type = 'sine', dur = 0.15, gain = 0.25, attack = 0.005,
         sweepTo = null, filter = null, detune = 0, delay = 0 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;

    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    if (detune) osc.detune.setValueAtTime(detune, t0);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    let node = osc;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type ?? 'lowpass';
      f.frequency.setValueAtTime(filter.freq ?? 1200, t0);
      if (filter.sweepTo) f.frequency.exponentialRampToValueAtTime(filter.sweepTo, t0 + dur);
      f.Q.value = filter.q ?? 1;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    g.connect(this.sfxBus);

    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Ruido filtrado: turbo, impactos, roces. */
  noise({ dur = 0.2, gain = 0.2, cutoff = 900, sweepTo = null, type = 'lowpass', q = 1 } = {}) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(cutoff, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t0 + dur);
    f.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  /**
   * Lecho ambiental continuo: dos osciladores desafinados a través de un filtro
   * paso bajo lento. El tema decide el corte y la forma de onda.
   */
  startAmbient(theme) {
    if (!this.ready) return;
    this.stopAmbient();
    const ctx = this.ctx;

    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.09, ctx.currentTime, 1.6);
    g.connect(this.ambientBus);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = theme.audio?.filterCutoff ?? 2400;
    filter.Q.value = 0.7;
    filter.connect(g);

    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = (theme.audio?.filterCutoff ?? 2400) * 0.28;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    lfo.start();

    const oscs = [];
    for (const [freq, detune] of [[55, -7], [82.4, 5], [110, 11]]) {
      const o = ctx.createOscillator();
      o.type = theme.audio?.waveform === 'square' ? 'sawtooth' : 'sine';
      o.frequency.value = freq;
      o.detune.value = detune;
      const og = ctx.createGain();
      og.gain.value = 0.3;
      o.connect(og); og.connect(filter);
      o.start();
      oscs.push(o);
    }

    this.ambientNodes = { g, filter, lfo, oscs };
  }

  stopAmbient() {
    if (!this.ambientNodes) return;
    const { g, lfo, oscs } = this.ambientNodes;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, t, 0.4);
    setTimeout(() => {
      try {
        lfo.stop();
        for (const o of oscs) o.stop();
        g.disconnect();
      } catch { /* ya detenido */ }
    }, 1400);
    this.ambientNodes = null;
  }
}
