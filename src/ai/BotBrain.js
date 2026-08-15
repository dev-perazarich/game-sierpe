/**
 * BotBrain.js — Orquesta las tres capas y administra el presupuesto de CPU.
 *
 * La percepción es lo caro, así que se escalona: cada bot la reconstruye uno de
 * cada 2-4 pasos según su habilidad, y los turnos se reparten por id para que no
 * coincidan todos en el mismo fotograma. Así 30 bots cuestan lo que costarían 10
 * pensando en cada paso.
 */

import { CFG } from '../config.js';
import { Perception } from './perception.js';
import { chooseDirection, shouldBoost } from './steering.js';
import { scoreStates, desireFor, STATES } from './behaviors.js';
import { makeTraits } from './personalities.js';
import { rng } from '../engine/rng.js';
import { clamp, angleDiff } from '../engine/math.js';

export class BotBrain {
  constructor(snake, world, { difficulty = 0.5, traits = null } = {}) {
    this.snake = snake;
    this.world = world;

    // Con el RNG del MUNDO, no el global. Es lo que hace que el desafío diario
    // sea de verdad el mismo para todos: misma semilla → mismo mapa, mismos
    // spawns y también las mismas personalidades de bot. Con el global, dos
    // jugadores del mismo día se enfrentaban a rivales distintos.
    this.rng = world.rng;
    this.traits = traits ?? makeTraits(this.rng, difficulty);

    this.perception = new Perception();
    this.state = 'FARM';
    this.stateTime = 0;
    this.scores = null;

    // Turno escalonado, desfasado por id para repartir el coste entre fotogramas.
    this.tickPhase = snake.id % this.traits.perceptEvery;
    this.tickCount = 0;

    // Latencia de reacción: el bot no responde al instante a lo que ve.
    this.reactionTimer = 0;
    this.pendingAngle = snake.angle;
    this.committedAngle = snake.angle;

    this.memory = {
      wanderTarget: null,
      wanderTime: 0,
      orbitDir: 0,
      orbitTime: 0,
      coilDir: 0,
      recentDeathNear: 0,
      lastMass: snake.mass,
      stuckTime: 0,
    };

    // Objetivos que puede fijar el modo (nodo de Dominio, marca del jugador).
    this.assignment = null;
  }

  reset() {
    this.state = 'FARM';
    this.stateTime = 0;
    this.memory.orbitDir = 0;
    this.memory.orbitTime = 0;
    this.memory.coilDir = 0;
    this.memory.wanderTarget = null;
    this.memory.wanderTime = 0;
  }

  setAssignment(target) {
    this.assignment = target;
  }

  think(dt) {
    const bot = this.snake;
    const t = this.traits;
    const m = this.memory;

    this.stateTime += dt;
    m.wanderTime -= dt;
    m.recentDeathNear = Math.max(0, m.recentDeathNear - dt);
    if (this.state === 'ENCIRCLE') m.orbitTime += dt; else m.orbitTime = 0;

    // ── Capa 1: percepción, escalonada y con nivel de detalle ──
    //
    // El escalonado por sí solo no basta en un mapa de 11.000 px: con 50 bots la
    // percepción se comía el presupuesto entero. Pero un bot a 5.000 px de ti no
    // necesita reaccionar en 90 ms, porque no lo estás viendo. Se le baja el
    // ritmo de pensamiento con la distancia al jugador y el coste cae a la
    // mitad sin que se note nada donde sí miras.
    const lod = this._lodMultiplier();
    this.tickCount++;
    const rebuild = (this.tickCount + this.tickPhase) % (t.perceptEvery * lod) === 0;
    if (rebuild) this.perception.build(bot, this.world);

    const p = this.perception;

    // ── Capa 2: decisión con histéresis ──
    if (rebuild) {
      const scores = scoreStates(bot, this.world, p, t, m);
      this.scores = scores;

      let best = this.state;
      let bestVal = -Infinity;
      for (const s of STATES) {
        if (scores[s] > bestVal) { bestVal = scores[s]; best = s; }
      }

      const currentVal = scores[this.state] ?? 0;
      const canSwitch = this.stateTime >= CFG.ai.stateMinTime * (0.5 + t.paciencia);
      const beatsMargin = bestVal > currentVal + CFG.ai.stateMargin;
      // Huir y enrollarse pueden interrumpir cualquier cosa: son supervivencia.
      const urgent = (best === 'FLEE' || best === 'COIL') && bestVal > currentVal + 0.05;

      if (best !== this.state && ((canSwitch && beatsMargin) || urgent)) {
        this.state = best;
        this.stateTime = 0;
        if (best === 'ENCIRCLE') m.orbitDir = 0;
        if (best === 'COIL') m.coilDir = 0;
      }
    }

    // ── Capa 3: dirección ──
    let desire = desireFor(this.state, bot, this.world, p, t, m);

    // Un encargo del modo (capturar un nodo, atender una marca) desvía el granjeo
    // pero nunca la supervivencia.
    if (this.assignment && (this.state === 'FARM' || this.state === 'SCAVENGE')) {
      const a = Math.atan2(this.assignment.y - bot.head.y, this.assignment.x - bot.head.x);
      desire = { angle: a, weight: 1.1, avoidWeight: 0.35 };
    }

    this.reactionTimer -= dt;
    if (this.reactionTimer <= 0) {
      // La elección de rumbo es lo más caro del cerebro (hasta 17 trazados con
      // consulta al hash cada uno), así que también se espacia con el nivel de
      // detalle. La calidad de juego cerca del jugador no cambia.
      this.reactionTimer = t.reactionTime * lod;
      const chosen = chooseDirection(bot, this.world, p, desire, t);
      // Ruido de puntería: es lo que separa a un bot fácil de uno brutal.
      this.committedAngle = chosen + (this.rng() - 0.5) * 2 * t.aimNoise;
    }

    bot.targetAngle = this.committedAngle;
    bot.boosting = shouldBoost(bot, p, this.state, t, this.rng) && bot.canBoost();

    this._antiStuck(dt);
    m.lastMass = bot.mass;
  }

  /**
   * Red de seguridad. Si un bot lleva mucho rato girando en el mismo sentido sin
   * ganar masa (típico de quedarse pegado a un borde), se le fuerza un objetivo
   * nuevo. Barato y evita el bot que orbita una esquina eternamente.
   */
  _antiStuck(dt) {
    const m = this.memory;
    const gained = this.snake.mass - m.lastMass;
    if (this.state === 'COIL' || this.state === 'ENCIRCLE') { m.stuckTime = 0; return; }

    if (gained < 0.01 && this.perception.wallPressure > 0.3) {
      m.stuckTime += dt;
    } else {
      m.stuckTime = Math.max(0, m.stuckTime - dt * 2);
    }

    if (m.stuckTime > 4) {
      m.stuckTime = 0;
      m.wanderTarget = {
        x: this.world.bounds.w / 2 + (this.rng() - 0.5) * this.world.bounds.w * 0.4,
        y: this.world.bounds.h / 2 + (this.rng() - 0.5) * this.world.bounds.h * 0.4,
      };
      m.wanderTime = 6;
      this.state = 'FARM';
      this.stateTime = 0;
    }
  }

  /**
   * Nivel de detalle del cerebro según la distancia al jugador.
   *
   * Los umbrales están en píxeles de mundo: ~1.900 es algo más de lo que cabe en
   * pantalla, así que todo lo que ves piensa a pleno rendimiento. Sin jugador
   * vivo (espectando, o en pruebas sin humano) se mantiene el ritmo normal para
   * que la simulación no se degrade sola.
   */
  _lodMultiplier() {
    const p = this.world.player;
    if (!p || !p.alive) return 1;
    const dx = this.snake.head.x - p.head.x;
    const dy = this.snake.head.y - p.head.y;
    const d2 = dx * dx + dy * dy;
    if (d2 > 4600 * 4600) return 4;
    if (d2 > 1900 * 1900) return 2;
    return 1;
  }

  /** Lo llama World cuando muere alguien cerca, para activar el carroñeo. */
  notifyDeathNear(x, y) {
    const d = Math.hypot(this.snake.head.x - x, this.snake.head.y - y);
    if (d < 700) this.memory.recentDeathNear = 3.5;
  }

  debugLabel() {
    return `${this.traits.label}·${this.state}`;
  }
}

export { clamp, angleDiff };
