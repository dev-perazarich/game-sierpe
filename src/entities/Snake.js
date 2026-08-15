/**
 * Snake.js — La serpiente.
 *
 * Cambio estructural frente a la versión anterior: el cuerpo ya no es un array de
 * segmentos al que se hace unshift/pop una vez por fotograma (eso ataba el tamaño
 * a los FPS). Ahora se guarda el *rastro* de la cabeza con su longitud de arco, y
 * el cuerpo se muestrea sobre ese rastro a intervalos regulares. El resultado:
 *   - la longitud es correcta a cualquier velocidad y a cualquier tasa de refresco
 *   - el espaciado entre nodos es constante, así que el patrón no parpadea
 *   - render y colisión comparten el mismo muestreo, calculado una sola vez
 */

import {
  CFG, radiusForMass, bodyArcForMass, turnRateForRadius,
} from '../config.js';
import { clamp, damp, turnToward, wrapAngle, TAU } from '../engine/math.js';

let nextId = 1;

export class Snake {
  constructor({ x, y, angle, skin, name, isPlayer = false, team = null, mass = null, kind = 'normal' }) {
    this.id       = nextId++;
    this.name     = name;
    this.isPlayer = isPlayer;
    this.team     = team;
    this.kind     = kind;            // 'normal' | 'boss'
    this.skin     = skin;
    this.alive    = true;

    this.angle       = angle;
    this.targetAngle = angle;
    this.mass        = mass ?? CFG.snake.startMass;
    this.peakMass    = this.mass;

    this.boosting    = false;
    this.boostTimer  = 0;
    this.speedMul    = 1;            // lo tocan las cartas de Nido y los potenciadores
    this.turnMul     = 1;
    this.magnetMul   = 1;
    this.shield      = 0;            // impactos que absorbe
    this.spikeTimer  = 0;            // cola de púas activa
    this.invuln      = 1.2;          // gracia tras aparecer

    this.kills   = 0;
    this.score   = 0;
    this.eaten   = 0;
    this.brain   = null;             // lo rellena BotBrain para los no-jugadores

    // Cuerpo: array plano [x0,y0, x1,y1, …] donde el índice 0 es la cabeza.
    // Es a la vez la representación autoritativa y la que consumen render y
    // colisión, así que no hay dos versiones de la forma que puedan discrepar.
    this.spine     = [];
    this.spineStep = 0;
    this.traveled  = 0;          // distancia total recorrida (desfase del patrón)
    this._radius   = radiusForMass(this.mass);   // al nacer, sin transición
    this._head     = { x, y };
    this.prevHead  = { x, y };   // se reutiliza en cada step()
    this.bounds    = { minX: x, minY: y, maxX: x, maxY: y };

    this._seedChain(x, y, angle);
    this._updateBounds();
  }

  get head()   { return this._head; }

  /**
   * Grosor actual. NO es directamente radiusForMass(mass): se acerca a ese valor
   * de forma suave.
   *
   * Al eliminar a una serpiente grande la masa se triplica en un solo paso. Con
   * el radio atado a la masa, el grosor —y con él la separación entre nodos—
   * daba un salto instantáneo: el cuerpo se re-espaciaba entero de golpe y se
   * veía como un estirón. Con la transición, engordar es visible pero continuo,
   * y colisión y dibujo siguen usando exactamente el mismo valor.
   */
  get radius() { return this._radius; }
  get targetRadius() { return radiusForMass(this.mass); }
  get bodyArc(){ return bodyArcForMass(this.mass); }
  get length() { return Math.round(this.mass); }

  /** Separación entre nodos del cuerpo. Escala con el grosor. */
  get nodeSpacing() {
    return Math.max(4, this.radius * CFG.snake.spineStepFactor);
  }

  /** Nace estirada hacia atrás, no como un punto que se despliega. */
  _seedChain(x, y, angle) {
    const spacing = this.nodeSpacing;
    const n = Math.max(2, Math.round(this.bodyArc / spacing));
    this.spine.length = 0;
    for (let i = 0; i < n; i++) {
      this.spine.push(x - Math.cos(angle) * i * spacing,
                      y - Math.sin(angle) * i * spacing);
    }
    this.spineStep = spacing;
    this._head.x = x;
    this._head.y = y;
  }

  /** Vector velocidad actual, que la IA usa para predecir intercepciones. */
  velocity() {
    const sp = this.currentSpeed();
    return { x: Math.cos(this.angle) * sp, y: Math.sin(this.angle) * sp };
  }

  currentSpeed() {
    const base = this.boosting ? CFG.snake.boostSpeed : CFG.snake.baseSpeed;
    return base * this.speedMul;
  }

  canBoost() {
    return this.mass > CFG.snake.minMass;
  }

  /**
   * Avanza un paso fijo.
   * @returns {Array|null} orbes soltados por la cola al acelerar
   */
  step(dt, world) {
    if (!this.alive) return null;

    if (this.invuln > 0)     this.invuln -= dt;
    if (this.spikeTimer > 0) this.spikeTimer -= dt;

    // El grosor persigue a la masa en lugar de saltar con ella. Ver get radius().
    this._radius = damp(this._radius, this.targetRadius, CFG.snake.radiusEase, dt);

    // ── Giro, limitado por el radio: las grandes maniobran peor ──
    const maxTurn = turnRateForRadius(this.radius) * this.turnMul * dt;
    this.angle = turnToward(this.angle, this.targetAngle, maxTurn);

    // ── Turbo: cuesta masa y la devuelve al mundo como orbes ──
    let dropped = null;
    if (this.boosting && this.canBoost()) {
      const cost = CFG.snake.boostMassPerSec * dt;
      this.mass = Math.max(CFG.snake.minMass, this.mass - cost);
      this.boostTimer += dt;
      if (this.boostTimer >= CFG.snake.boostOrbEvery) {
        this.boostTimer -= CFG.snake.boostOrbEvery;
        dropped = this._tailPoint();
      }
    } else {
      this.boosting = false;
      this.boostTimer = 0;
    }

    // ── Avance ──
    const sp = this.currentSpeed() * dt;
    const h = this.head;
    const nx = h.x + Math.cos(this.angle) * sp;
    const ny = h.y + Math.sin(this.angle) * sp;

    // Objeto reutilizado, no uno nuevo por tick: con 50 serpientes eran 3.000
    // asignaciones por segundo que solo servían para alimentar al recolector.
    this.prevHead.x = h.x;
    this.prevHead.y = h.y;

    this._head.x = nx;
    this._head.y = ny;
    this.spine[0] = nx;
    this.spine[1] = ny;
    this.traveled += sp;

    this._followChain();
    this._fitNodeCount();
    this._updateBounds();

    if (this.mass > this.peakMass) this.peakMass = this.mass;
    return dropped;
  }

  /**
   * Cinemática de remolque: cada nodo persigue al anterior manteniendo la
   * separación fija.
   *
   * Este es el corazón del comportamiento del cuerpo. El modelo anterior
   * muestreaba el rastro grabado de la cabeza, y eso hace que la cola pase
   * EXACTAMENTE por donde pasó la cabeza: cero arrastre, medido. Con la cadena,
   * al girar cada nodo tira en línea recta hacia su predecesor y por tanto
   * recorta la curva por dentro, igual que las ruedas traseras de un remolque.
   *
   * La consecuencia que importa para el juego: al cerrar un cerco, el cuerpo se
   * va apretando hacia el centro en lugar de repetir la misma circunferencia, y
   * el hueco por el que puede escapar la presa se cierra solo.
   */
  _followChain() {
    const s = this.spine;
    const spacing = this.nodeSpacing;
    const maxBend = CFG.snake.maxBend;
    this.spineStep = spacing;

    // Ángulo del primer eslabón: de la cabeza hacia atrás.
    let prevAngle = Math.atan2(s[1] - s[3], s[0] - s[2]);
    if (!Number.isFinite(prevAngle)) prevAngle = this.angle + Math.PI;

    for (let i = 2; i < s.length; i += 2) {
      const dx = s[i] - s[i - 2];
      const dy = s[i + 1] - s[i - 1];
      let a = Math.atan2(dy, dx);
      if (dx === 0 && dy === 0) a = prevAngle;

      // Límite de articulación. Sin él, con giro cerrado la cadena degenera:
      // r_i = √(r_{i-1}² − s²) se vuelve imaginario en pocos nodos y el cuerpo
      // colapsa en un nudo en el centro. Con él, el cuerpo no puede enrollarse
      // más cerrado que un radio de unas dos veces su grosor, que es justo lo
      // que hace un cuerpo con volumen real.
      if (i > 2) {
        const diff = wrapAngle(a - prevAngle);
        if (diff > maxBend) a = prevAngle + maxBend;
        else if (diff < -maxBend) a = prevAngle - maxBend;
      }

      s[i]     = s[i - 2] + Math.cos(a) * spacing;
      s[i + 1] = s[i - 1] + Math.sin(a) * spacing;
      prevAngle = a;
    }
  }

  /** Ajusta el número de nodos cuando cambian la masa o el grosor. */
  _fitNodeCount() {
    const s = this.spine;
    const spacing = this.nodeSpacing;
    const target = Math.max(2, Math.round(this.bodyArc / spacing));
    const have = s.length / 2;

    if (have < target) {
      // Crecer: los nodos nuevos se apilan en la punta de la cola y la cadena
      // los va estirando en los pasos siguientes. Así crecer no da un tirón.
      const tx = s[s.length - 2];
      const ty = s[s.length - 1];
      for (let i = have; i < target; i++) s.push(tx, ty);
    } else if (have > target) {
      s.length = target * 2;
    }
  }

  _updateBounds() {
    const s = this.spine;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < s.length; i += 2) {
      const x = s[i], y = s[i + 1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const pad = this.radius + 4;
    this.bounds.minX = minX - pad;
    this.bounds.minY = minY - pad;
    this.bounds.maxX = maxX + pad;
    this.bounds.maxY = maxY + pad;
  }

  _tailPoint() {
    const s = this.spine;
    return { x: s[s.length - 2], y: s[s.length - 1] };
  }

  /** Ancho del cuerpo en la posición `t` del espinazo (0 = cabeza, 1 = cola). */
  widthAt(t) {
    const r = this.radius;
    // Cuello ligeramente más grueso y cola afilada: da dirección a la silueta.
    if (t < 0.06) return r * (0.94 + t * 1.0);
    if (t > 0.82) return r * (1 - (t - 0.82) / 0.18 * 0.55);
    return r;
  }

  grow(amount) {
    this.mass += amount;
    if (this.mass > this.peakMass) this.peakMass = this.mass;
  }

  shrink(amount) {
    this.mass = Math.max(1, this.mass - amount);
  }

  /** Reaparece en el sitio dado conservando la fracción de masa indicada. */
  respawn(x, y, angle, massKeep = 0) {
    this.alive  = true;
    this.angle  = angle;
    this.targetAngle = angle;
    this.mass   = Math.max(CFG.snake.startMass, this.mass * massKeep);
    this.boosting = false;
    this.boostTimer = 0;
    this.invuln = 1.6;
    this.shield = 0;
    this.spikeTimer = 0;
    this.traveled = 0;
    // Sin transición al reaparecer: si no, el cuerpo se sembraría con el grosor
    // que tenía justo antes de morir.
    this._radius = radiusForMass(this.mass);
    this._seedChain(x, y, angle);
    this._updateBounds();
    if (this.brain) this.brain.reset();
  }

  /** Punto del espinazo más cercano a (x, y). Lo usa la IA para el cerco. */
  nearestSpineIndex(x, y) {
    let best = 0, bestD = Infinity;
    const s = this.spine;
    for (let i = 0; i < s.length; i += 2) {
      const dx = s[i] - x, dy = s[i + 1] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return { index: best, dist: Math.sqrt(bestD) };
  }

  aimAt(x, y) {
    this.targetAngle = Math.atan2(y - this.head.y, x - this.head.x);
  }

  aimAngle(a) {
    this.targetAngle = ((a % TAU) + TAU) % TAU;
  }
}

export function randomSpawn(rngFn, world, margin = 260) {
  return {
    x: rngFn.range(margin, world.w - margin),
    y: rngFn.range(margin, world.h - margin),
    angle: rngFn.range(0, TAU),
  };
}

export { clamp };
