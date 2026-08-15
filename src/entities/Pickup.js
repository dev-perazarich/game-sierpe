/**
 * Pickup.js — Cajas de suministro y potenciadores temporales.
 * Los usan Cerco (cajas que caen en la zona) y Frenesí (zonas de bonificación).
 */

import { rng } from '../engine/rng.js';

export const POWER = {
  SPEED:   { id: 'speed',   name: 'Impulso',   dur: 8,  icon: '»' },
  MAGNET:  { id: 'magnet',  name: 'Imán',      dur: 12, icon: '◎' },
  SHIELD:  { id: 'shield',  name: 'Escudo',    dur: 0,  icon: '◇' },
  SPIKES:  { id: 'spikes',  name: 'Púas',      dur: 6,  icon: '✳' },
  AGILITY: { id: 'agility', name: 'Agilidad',  dur: 10, icon: '↺' },
};

const POWER_LIST = Object.values(POWER);

export class Pickup {
  /** @param {Function} rngFn el RNG del mundo, para que el desafío diario cuadre. */
  constructor(x, y, power = null, rngFn = rng) {
    this.x = x;
    this.y = y;
    this.power = power ?? rngFn.pick(POWER_LIST);
    this.r = 17;
    this.spin = rngFn.range(0, Math.PI * 2);
    this.bob = rngFn.range(0, Math.PI * 2);
    this.alive = true;
    this.age = 0;
  }

  update(dt) {
    this.age += dt;
    this.spin += dt * 1.1;
    this.bob += dt * 2.6;
  }
}

/** Aplica un potenciador a una serpiente y devuelve el efecto activo. */
export function applyPower(snake, power) {
  switch (power.id) {
    case 'speed':   snake.speedMul  = 1.22; break;
    case 'magnet':  snake.magnetMul = 3.2;  break;
    case 'shield':  snake.shield   += 1;    break;
    case 'spikes':  snake.spikeTimer = Math.max(snake.spikeTimer, power.dur); break;
    case 'agility': snake.turnMul   = 1.45; break;
  }
  return power.dur > 0 ? { id: power.id, remaining: power.dur, power } : null;
}

export function expirePower(snake, id) {
  switch (id) {
    case 'speed':   snake.speedMul  = 1; break;
    case 'magnet':  snake.magnetMul = 1; break;
    case 'agility': snake.turnMul   = 1; break;
  }
}
