/**
 * events.js — Bus de eventos del mundo.
 * FX, audio, logros y HUD se enganchan aquí en lugar de que la lógica del juego
 * los conozca. Es lo que permite añadir sonido o partículas sin tocar el motor.
 */

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    this.handlers.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear() {
    this.handlers.clear();
  }
}

/** Nombres de evento usados por el juego, en un solo sitio para evitar erratas. */
export const EV = {
  EAT:        'eat',
  BOOST_DROP: 'boostDrop',
  KILL:       'kill',
  DEATH:      'death',
  SPAWN:      'spawn',
  ZONE_PHASE: 'zonePhase',
  WAVE_START: 'waveStart',
  WAVE_END:   'waveEnd',
  BOSS:       'boss',
  NODE_CAP:   'nodeCaptured',
  STREAK:     'streak',
  PICKUP:     'pickup',
  MODE_OVER:  'modeOver',
};
