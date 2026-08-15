/**
 * Orb.js — Comida.
 *
 * Los orbes salen de un pool: nunca se hace splice en caliente. Se marcan como
 * muertos y una compactación diferida los recicla. También tienen estado
 * "atraído": dentro del radio de imán vuelan hacia la cabeza en vez de
 * desaparecer de golpe, que era lo que hacía que comer no se sintiera.
 */

import { CFG } from '../config.js';
import { rng as globalRng } from '../engine/rng.js';

export const ORB_KIND = {
  NORMAL: 0,
  BOOST:  1,   // soltado por la cola al acelerar
  DEATH:  2,   // restos de una serpiente muerta
  TEAM:   3,   // generado por un nodo en Dominio
  POISON: 4,   // rastro del jefe en Nido: resta masa
};

export class Orb {
  constructor() {
    this.active = false;
    this.reset(0, 0);
  }

  /**
   * @param {Function} rngFn  el RNG del MUNDO, no el global. El radio y el tono
   *   de cada orbe salen de aquí, así que usar el global rompía la promesa del
   *   desafío diario: mismo mapa, pero comida de distinto valor para cada uno.
   */
  reset(x, y, { r = null, kind = ORB_KIND.NORMAL, hue = null, team = null, value = null } = {}, rngFn = globalRng) {
    this.x = x;
    this.y = y;
    this.r = r ?? rngFn.range(CFG.orb.rMin, CFG.orb.rMax);
    this.kind = kind;
    this.team = team;
    this.value = value ?? this.r * CFG.orb.valuePerRadius;
    this.hue = hue ?? rngFn.int(0, 360);
    this.pulse = rngFn.range(0, Math.PI * 2);
    this.pulseSpeed = rngFn.range(1.6, 3.4);
    this.attractTo = null;
    this.attractT = 0;
    this.active = true;
    this.age = 0;
    this.ttl = kind === ORB_KIND.POISON ? 9 : Infinity;
    return this;
  }

  update(dt) {
    this.pulse += this.pulseSpeed * dt;
    this.age += dt;
    if (this.ttl !== Infinity && this.age > this.ttl) {
      this.active = false;
      return;
    }
    if (this.attractTo) {
      const s = this.attractTo;
      if (!s.alive) { this.attractTo = null; this.attractT = 0; return; }
      const dx = s.head.x - this.x;
      const dy = s.head.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      this.attractT = Math.min(1, this.attractT + dt * 5);
      const speed = CFG.orb.magnetSpeed * (0.35 + this.attractT);
      const move = Math.min(d, speed * dt);
      this.x += (dx / d) * move;
      this.y += (dy / d) * move;
    }
  }
}

/**
 * Pool de orbes con compactación diferida y crecimiento perezoso.
 *
 * Los objetos se crean según hacen falta en lugar de reservar la capacidad
 * entera por adelantado: los mapas grandes necesitan miles de orbes, pero Nido
 * usa unos cientos, y no tiene sentido que pague por lo que no usa.
 */
export class OrbPool {
  constructor(capacity = 14000, rngFn = globalRng) {
    this.items = [];
    this.count = 0;          // número de orbes vivos al frente del array
    this.capacity = capacity;
    this.rng = rngFn;        // el del mundo: ver Orb.reset
  }

  spawn(x, y, opts) {
    if (this.count >= this.capacity) this.compact();
    if (this.count >= this.capacity) return null;

    let orb = this.items[this.count];
    if (orb === undefined) {
      orb = new Orb();
      this.items[this.count] = orb;
    }
    this.count++;
    return orb.reset(x, y, opts, this.rng);
  }

  /** Iteración segura sobre los orbes vivos. */
  forEach(fn) {
    for (let i = 0; i < this.count; i++) {
      const o = this.items[i];
      if (o.active) fn(o, i);
    }
  }

  /** Mueve los muertos al final sin generar basura. */
  compact() {
    let write = 0;
    for (let read = 0; read < this.count; read++) {
      const o = this.items[read];
      if (o.active) {
        if (write !== read) {
          this.items[read] = this.items[write];
          this.items[write] = o;
        }
        write++;
      }
    }
    this.count = write;
  }

  clear() {
    for (let i = 0; i < this.count; i++) {
      if (this.items[i]) this.items[i].active = false;
    }
    this.count = 0;
  }
}

/**
 * Convierte una serpiente muerta en orbes repartidos por su cuerpo.
 * La masa devuelta es una fracción: matar tiene que ser rentable, pero no tanto
 * como para que una sola muerte decida la partida.
 */
export function scatterFromSnake(pool, snake, hueOverride = null) {
  const total = snake.mass * CFG.scoring.deathOrbFraction;
  const spine = snake.spine;
  const nodes = Math.max(1, spine.length / 2);
  const count = Math.min(CFG.scoring.deathOrbMax, Math.max(6, Math.round(nodes * 0.7)));
  const per = total / count;
  const r = Math.min(CFG.orb.rMax * 1.5, Math.max(CFG.orb.rMin, per / CFG.orb.valuePerRadius));

  const rngFn = pool.rng;
  for (let i = 0; i < count; i++) {
    const idx = Math.min(spine.length - 2, Math.floor((i / count) * nodes) * 2);
    pool.spawn(
      spine[idx] + rngFn.range(-CFG.orb.dropSpread, CFG.orb.dropSpread),
      spine[idx + 1] + rngFn.range(-CFG.orb.dropSpread, CFG.orb.dropSpread),
      { r, kind: ORB_KIND.DEATH, value: per, hue: hueOverride ?? snake.skin.hue },
    );
  }
}
