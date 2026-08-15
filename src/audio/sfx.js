/**
 * sfx.js — Diseño de sonido, enganchado al bus de eventos del mundo.
 *
 * El motor no llama a nada de aquí: se suscribe a los mismos eventos que las
 * partículas. Quitar el audio entero es no llamar a bind().
 */

import { Synth } from './synth.js';
import { EV } from '../engine/events.js';

export class Sfx {
  constructor(settings) {
    this.synth = new Synth();
    this.settings = settings;
    this._unsub = [];
    this.theme = null;
    this.eatCooldown = 0;
    this.boostNoiseTimer = 0;
    this.streakStep = 0;
  }

  init() {
    const ok = this.synth.init();
    if (ok) this.applyVolumes();
    return ok;
  }

  applyVolumes() {
    this.synth.setVolumes({
      master: this.settings.masterVolume,
      sfx: this.settings.sfxVolume,
      ambient: this.settings.ambientVolume,
      muted: this.settings.muted,
    });
  }

  setTheme(theme) {
    this.theme = theme;
    if (this.synth.ready && !this.settings.muted) this.synth.startAmbient(theme);
  }

  stopAmbient() { this.synth.stopAmbient(); }

  /** Sonidos de interfaz, disponibles fuera de partida. */
  ui(kind) {
    if (!this.synth.ready) return;
    switch (kind) {
      case 'click':   this.synth.tone({ freq: 640, type: 'triangle', dur: 0.06, gain: 0.12 }); break;
      case 'hover':   this.synth.tone({ freq: 880, type: 'sine', dur: 0.035, gain: 0.05 }); break;
      case 'confirm': this.synth.tone({ freq: 520, type: 'triangle', dur: 0.1, gain: 0.16, sweepTo: 780 }); break;
      case 'back':    this.synth.tone({ freq: 420, type: 'triangle', dur: 0.09, gain: 0.12, sweepTo: 300 }); break;
      case 'unlock':
        this.synth.tone({ freq: 660, type: 'triangle', dur: 0.12, gain: 0.18 });
        this.synth.tone({ freq: 880, type: 'triangle', dur: 0.16, gain: 0.16, delay: 0.09 });
        this.synth.tone({ freq: 1320, type: 'sine', dur: 0.24, gain: 0.12, delay: 0.18 });
        break;
    }
  }

  bind(world, theme) {
    this.unbind();
    this.theme = theme;
    const wave = theme.audio?.waveform ?? 'sine';
    const on = (type, fn) => this._unsub.push(world.events.on(type, fn));

    on(EV.EAT, ({ snake, poison }) => {
      if (!snake.isPlayer || !this.synth.ready) return;
      if (this.eatCooldown > 0) return;
      this.eatCooldown = 0.045;

      if (poison) {
        this.synth.tone({ freq: 180, type: 'sawtooth', dur: 0.22, gain: 0.2, sweepTo: 90,
          filter: { type: 'lowpass', freq: 700 } });
        return;
      }
      // El tono sube con el tamaño: un bocado grande suena distinto de uno chico.
      const base = 520 + Math.min(420, snake.mass * 0.9);
      this.synth.tone({ freq: base, type: wave === 'square' ? 'square' : 'sine',
        dur: 0.055, gain: 0.09, sweepTo: base * 1.35 });
    });

    on(EV.KILL, ({ killer, victim }) => {
      if (!this.synth.ready) return;
      if (killer.isPlayer) {
        this.synth.tone({ freq: 120, type: 'sine', dur: 0.35, gain: 0.34, sweepTo: 55 });
        this.synth.noise({ dur: 0.3, gain: 0.2, cutoff: 2600, sweepTo: 220 });
        this.synth.tone({ freq: 660, type: 'triangle', dur: 0.14, gain: 0.16, delay: 0.05, sweepTo: 990 });
      } else if (victim.isPlayer) {
        this._deathSound();
      }
    });

    on(EV.DEATH, ({ snake, killer }) => {
      if (killer || !snake.isPlayer) return;
      this._deathSound();
    });

    on(EV.PICKUP, ({ snake }) => {
      if (!snake.isPlayer) return;
      this.synth.tone({ freq: 700, type: 'triangle', dur: 0.1, gain: 0.2, sweepTo: 1200 });
      this.synth.tone({ freq: 1400, type: 'sine', dur: 0.18, gain: 0.12, delay: 0.08 });
    });

    on(EV.STREAK, ({ mult }) => {
      const map = { 2: 660, 3: 830, 5: 1100 };
      this.synth.tone({ freq: map[mult] ?? 660, type: 'triangle', dur: 0.16, gain: 0.2, sweepTo: (map[mult] ?? 660) * 1.5 });
    });

    on(EV.ZONE_PHASE, ({ closing }) => {
      if (!closing) return;
      this.synth.tone({ freq: 180, type: 'sawtooth', dur: 0.9, gain: 0.16, sweepTo: 120,
        filter: { type: 'lowpass', freq: 900, sweepTo: 300 } });
    });

    on(EV.WAVE_START, ({ boss }) => {
      if (boss) {
        this.synth.tone({ freq: 70, type: 'sawtooth', dur: 1.4, gain: 0.3, sweepTo: 45,
          filter: { type: 'lowpass', freq: 500 } });
        this.synth.noise({ dur: 1.0, gain: 0.16, cutoff: 400 });
      } else {
        this.synth.tone({ freq: 330, type: 'triangle', dur: 0.2, gain: 0.18 });
        this.synth.tone({ freq: 495, type: 'triangle', dur: 0.26, gain: 0.16, delay: 0.14 });
      }
    });

    on(EV.NODE_CAP, () => {
      this.synth.tone({ freq: 440, type: 'triangle', dur: 0.14, gain: 0.18 });
      this.synth.tone({ freq: 660, type: 'triangle', dur: 0.2, gain: 0.15, delay: 0.1 });
    });

    return () => this.unbind();
  }

  _deathSound() {
    this.synth.tone({ freq: 340, type: 'sawtooth', dur: 0.85, gain: 0.3, sweepTo: 48,
      filter: { type: 'lowpass', freq: 1800, sweepTo: 200 } });
    this.synth.noise({ dur: 0.6, gain: 0.18, cutoff: 1400, sweepTo: 120 });
  }

  /** Se llama cada fotograma: mantiene el siseo del turbo mientras esté activo. */
  update(dt, world) {
    if (this.eatCooldown > 0) this.eatCooldown -= dt;
    if (!this.synth.ready || this.settings.muted) return;

    const p = world.player;
    if (p?.alive && p.boosting) {
      this.boostNoiseTimer -= dt;
      if (this.boostNoiseTimer <= 0) {
        this.boostNoiseTimer = 0.11;
        this.synth.noise({ dur: 0.16, gain: 0.055, cutoff: 1900, sweepTo: 900, type: 'bandpass', q: 1.4 });
      }
    } else {
      this.boostNoiseTimer = 0;
    }
  }

  unbind() {
    for (const fn of this._unsub) fn();
    this._unsub.length = 0;
  }
}
