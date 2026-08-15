/**
 * perception.js — Capa 1 del cerebro: qué ve el bot.
 *
 * Produce dos cosas por reconstrucción:
 *   1. Un mapa de peligro angular: N rayos desde la cabeza, cada uno con un coste
 *      acumulado por cuerpos ajenos, bordes del mundo y zonas prohibidas del modo.
 *   2. Cúmulos de comida por densidad. El bot antiguo iba al orbe más cercano, que
 *      es la decisión tonta: aquí va al centro de masa del mejor montón.
 *
 * Es la parte cara, así que se reconstruye cada 2-4 pasos según la habilidad del
 * bot y se reutiliza en los pasos intermedios.
 */

import { CFG, turnRateForRadius } from '../config.js';
import { TAU, clamp } from '../engine/math.js';

const RAYS = CFG.ai.rays;
const RAY_STEP = TAU / RAYS;

export class Perception {
  constructor() {
    this.danger = new Float32Array(RAYS);
    this.interest = new Float32Array(RAYS);
    this.threats = [];        // serpientes mayores cerca
    this.prey = [];           // serpientes menores cerca
    this.clusters = [];       // { x, y, value, count, dist }
    this.nearestThreat = null;
    this.biggestPrey = null;
    this.wallPressure = 0;    // 0..1, cuánto aprieta el borde
    this.crowding = 0;        // 0..1, cuánta masa ajena hay alrededor
    this._scratch = [];

    // Estructuras reutilizadas entre reconstrucciones. Con 50 bots pensando
    // cada tres pasos, crear un Map y dos Float32Array por reconstrucción son
    // miles de asignaciones por segundo, y el recolector las paga en picos.
    this._grid = new Map();
    this._clusterPool = [];
    this._smoothBuf = new Float32Array(RAYS);
  }

  _takeCluster() {
    let c = this._clusterPool[this.clusters.length];
    if (c === undefined) {
      c = { x: 0, y: 0, value: 0, count: 0, dist: 0, angle: 0 };
      this._clusterPool[this.clusters.length] = c;
    }
    return c;
  }

  /** Índice del rayo que corresponde a un ángulo del mundo. */
  static rayFor(angle) {
    let a = angle % TAU;
    if (a < 0) a += TAU;
    return Math.floor(a / RAY_STEP) % RAYS;
  }

  static rayAngle(i) {
    return i * RAY_STEP;
  }

  build(bot, world) {
    const d = this.danger;
    const it = this.interest;
    d.fill(0);
    it.fill(0);
    this.threats.length = 0;
    this.prey.length = 0;
    this.clusters.length = 0;
    this.nearestThreat = null;
    this.biggestPrey = null;

    const hx = bot.head.x;
    const hy = bot.head.y;
    const R = CFG.ai.perceptionRadius;
    const myR = bot.radius;

    this._scanBodies(bot, world, hx, hy, R, myR, d);
    this._scanSnakes(bot, world, hx, hy, R);
    this._scanWalls(bot, world, hx, hy, d);
    if (world.mode.dangerField) world.mode.dangerField(world, bot, this, d);
    this._scanFood(bot, world, hx, hy, it);

    // Suavizado circular: sin esto el bot elige rayos aislados y da tirones.
    smoothRing(d, 0.34, this._smoothBuf);
    smoothRing(it, 0.22, this._smoothBuf);
  }

  /** Cuerpos ajenos → coste en los rayos que los apuntan. */
  _scanBodies(bot, world, hx, hy, R, myR, d) {
    const nodes = world.bodyHash.query(hx, hy, R, this._scratch);
    let crowd = 0;

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.snake === bot) continue;
      if (n.snake.team !== null && n.snake.team === bot.team) continue;

      const dx = n.x - hx;
      const dy = n.y - hy;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) continue;

      const clearance = dist - n.r - myR;
      if (clearance > 300) continue;

      crowd += n.r / Math.max(60, dist);

      // Coste inversamente proporcional al margen. A 300 px casi nada, pegado enorme.
      const cost = clamp(1 - clearance / 300, 0, 1);
      const weight = cost * cost * 3.4;

      // El cono afectado se ensancha al acercarse: de lejos un cuerpo tapa poco.
      const half = Math.atan2(n.r + myR + 26, dist);
      const center = Math.atan2(dy, dx);
      this._spread(d, center, half, weight);
    }

    this.crowding = clamp(crowd / 6, 0, 1);
  }

  /** Cabezas rivales: peligro extra hacia delante suyo, o presa si son menores. */
  _scanSnakes(bot, world, hx, hy, R) {
    let nearestD = Infinity;
    let biggest = 0;

    for (const s of world.snakes) {
      if (s === bot || !s.alive) continue;
      if (s.team !== null && s.team === bot.team) continue;

      const dx = s.head.x - hx;
      const dy = s.head.y - hy;
      const dist = Math.hypot(dx, dy);
      if (dist > R) continue;

      const ratio = s.mass / Math.max(1, bot.mass);
      const entry = { snake: s, dist, ratio, angle: Math.atan2(dy, dx) };

      if (ratio > 1.06) {
        this.threats.push(entry);
        if (dist < nearestD) { nearestD = dist; this.nearestThreat = entry; }

        // Un rival mayor no solo es peligroso donde está: es peligroso donde va.
        const lead = Math.min(340, dist * 0.9);
        const px = s.head.x + Math.cos(s.angle) * lead - hx;
        const py = s.head.y + Math.sin(s.angle) * lead - hy;
        const pd = Math.hypot(px, py) || 1;
        const w = clamp(1 - dist / R, 0, 1) * 2.6;
        this._spread(this.danger, Math.atan2(py, px), Math.atan2(70, pd), w);
      } else if (ratio < 0.88) {
        this.prey.push(entry);
        if (s.mass > biggest) { biggest = s.mass; this.biggestPrey = entry; }
      }
    }
  }

  /**
   * Bordes del mundo. El borde mata, así que pesa mucho — y el aviso tiene que
   * llegar con margen para girar. Un radio fijo de 220 px bastaba para una
   * serpiente delgada y era insuficiente para una enorme, que necesita el doble
   * de recorrido para cambiar de rumbo: de ahí que el aviso escale con la
   * velocidad y con el radio de giro.
   */
  _scanWalls(bot, world, hx, hy, d) {
    const turnRadius = bot.currentSpeed() / Math.max(0.1, turnRateForRadius(bot.radius));
    const warn = Math.max(CFG.world.edgeWarn, turnRadius * 3.2);
    const w = world.bounds.w, h = world.bounds.h;
    const checks = [
      { dist: hx,     angle: Math.PI },
      { dist: w - hx, angle: 0 },
      { dist: hy,     angle: -Math.PI / 2 },
      { dist: h - hy, angle: Math.PI / 2 },
    ];
    let pressure = 0;
    for (const c of checks) {
      if (c.dist > warn) continue;
      const t = 1 - c.dist / warn;
      pressure = Math.max(pressure, t);
      this._spread(d, c.angle, Math.PI / 2.1, t * t * 6.5);
    }
    this.wallPressure = pressure;
  }

  /**
   * Cúmulos de comida por rejilla gruesa. Ir al centro de masa de un montón vale
   * mucho más que ir al orbe suelto más cercano, y además evita que veinte bots
   * converjan sobre el mismo píxel.
   */
  _scanFood(bot, world, hx, hy, it) {
    const R = 560;
    const found = world.orbHash.query(hx, hy, R, this._scratch);
    if (found.length === 0) return;

    const CELL = 150;
    const grid = this._grid;
    grid.clear();

    for (let i = 0; i < found.length; i++) {
      const o = found[i];
      if (!o.active) continue;
      if (o.team !== null && o.team !== bot.team) continue;
      const cx = Math.floor(o.x / CELL);
      const cy = Math.floor(o.y / CELL);
      const key = cx * 10007 + cy;
      let g = grid.get(key);
      if (g === undefined) { g = { x: 0, y: 0, value: 0, count: 0 }; grid.set(key, g); }
      g.x += o.x * o.value;
      g.y += o.y * o.value;
      g.value += o.value;
      g.count++;
    }

    for (const g of grid.values()) {
      if (g.value <= 0) continue;
      const cx = g.x / g.value;
      const cy = g.y / g.value;
      const dx = cx - hx, dy = cy - hy;
      const dist = Math.hypot(dx, dy) || 1;
      const cluster = this._takeCluster();
      cluster.x = cx; cluster.y = cy;
      cluster.value = g.value; cluster.count = g.count;
      cluster.dist = dist; cluster.angle = Math.atan2(dy, dx);
      this.clusters.push(cluster);

      // Interés decreciente con la distancia y creciente con el valor del montón.
      const w = (g.value / (60 + dist * 0.35));
      this._spread(it, cluster.angle, 0.42, w);
    }

    this.clusters.sort((a, b) => (b.value / (80 + b.dist)) - (a.value / (80 + a.dist)));
    if (this.clusters.length > 6) this.clusters.length = 6;
  }

  /** Reparte un peso sobre los rayos dentro de un cono, con caída suave. */
  _spread(arr, centerAngle, halfWidth, weight) {
    const half = clamp(halfWidth, RAY_STEP * 0.6, Math.PI);
    const span = Math.ceil(half / RAY_STEP);
    const c = Perception.rayFor(centerAngle);
    for (let k = -span; k <= span; k++) {
      const idx = (c + k + RAYS * 2) % RAYS;
      const falloff = 1 - Math.abs(k) / (span + 1);
      arr[idx] += weight * falloff;
    }
  }
}

/** El búfer de trabajo se pasa desde fuera: `arr.slice()` asignaba por llamada. */
function smoothRing(arr, amount, buf) {
  const n = arr.length;
  buf.set(arr);
  for (let i = 0; i < n; i++) {
    const a = buf[(i - 1 + n) % n];
    const b = buf[i];
    const c = buf[(i + 1) % n];
    arr[i] = b * (1 - amount) + (a + c) * 0.5 * amount;
  }
}

export { RAYS, RAY_STEP };
