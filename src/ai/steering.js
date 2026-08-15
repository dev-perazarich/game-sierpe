/**
 * steering.js — Capa 3 del cerebro: de "quiero ir allí" a "giro tanto".
 *
 * Context steering: en lugar de apuntar directamente al objetivo y rezar, se
 * evalúan los N rayos del mapa de percepción y se elige el que maximiza
 * interés menos peligro. Encima va la prueba de trazado, que simula el camino
 * real con el radio de giro real del bot y descarta lo que acaba en un cuerpo o
 * en un borde. Esa comprobación sola elimina casi todas las muertes tontas.
 */

import { CFG, turnRateForRadius } from '../config.js';
import { Perception, RAYS, RAY_STEP } from './perception.js';
import { angleDiff, clamp, distToSegment2, TAU } from '../engine/math.js';

const scratchNodes = [];
// Arrays constantes: crear [1,-1] en cada intento era basura por tick.
const SIGNS_A = [1, -1];
const SIGNS_B = [-1, 1];

/**
 * Elige el ángulo final del bot.
 * @param {object} desire  { angle, weight, avoidWeight }
 * @returns {number} ángulo del mundo
 */
export function chooseDirection(bot, world, perception, desire, traits) {
  const danger = perception.danger;
  const cur = bot.angle;

  // Coste de giro: cambiar mucho de rumbo tiene precio, para que no oscile.
  const turnLimit = turnRateForRadius(bot.radius) * bot.turnMul;

  let bestIdx = -1;
  let bestScore = -Infinity;
  const avoidW = 1 + traits.cautela * 1.8 + (desire.avoidWeight ?? 0);

  for (let i = 0; i < RAYS; i++) {
    const a = Perception.rayAngle(i);
    const delta = Math.abs(angleDiff(cur, a));

    // Un bot no puede girar 180° en un paso; los rayos hacia atrás valen menos.
    if (delta > 2.5) continue;

    const alignDesire = Math.cos(angleDiff(a, desire.angle));
    const inertia = 1 - delta / Math.PI;

    const score =
        alignDesire * (2.2 * (desire.weight ?? 1))
      + inertia * 0.55
      - danger[i] * avoidW;

    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  if (bestIdx === -1) return cur;

  // Interpolación entre el rayo elegido y sus vecinos: evita el escalonado de
  // 15° que se nota como movimiento robótico.
  const refined = refineAngle(bestIdx, danger, desire, cur, avoidW);

  // Prueba de trazado. Si el mejor rayo lleva a la muerte, se prueban alternativas
  // en abanico hacia ambos lados y se elige la primera que sobrevive.
  if (isPathClear(bot, world, refined, traits.traceDepth)) return refined;

  for (let spread = 1; spread <= 8; spread++) {
    // El orden de tanteo sale del RNG del mundo, no del global: si no, dos
    // partidas con la misma semilla divergirían aquí.
    for (const sign of (world.rng() < 0.5 ? SIGNS_A : SIGNS_B)) {
      const cand = refined + sign * spread * RAY_STEP;
      const delta = Math.abs(angleDiff(cur, cand));
      if (delta > 2.6) continue;
      if (isPathClear(bot, world, cand, traits.traceDepth)) return cand;
    }
  }

  // Nada limpio. Si lo que aprieta es el borde, el rayo "menos malo" puede ser
  // el propio muro, así que se gira hacia el interior del mapa aunque haya que
  // atravesar tráfico: chocar con alguien es recuperable, el borde no.
  if (perception.wallPressure > 0.25) {
    const toCenter = Math.atan2(
      world.bounds.h / 2 - bot.head.y,
      world.bounds.w / 2 - bot.head.x,
    );
    // Sin girar más de lo que el cuerpo permite en un paso razonable.
    return cur + clamp(angleDiff(cur, toCenter), -1.2, 1.2);
  }

  return refined;
}

function refineAngle(idx, danger, desire, cur, avoidW) {
  const prev = (idx - 1 + RAYS) % RAYS;
  const next = (idx + 1) % RAYS;
  const score = (i) => {
    const a = Perception.rayAngle(i);
    return Math.cos(angleDiff(a, desire.angle)) * 2.2 - danger[i] * avoidW;
  };
  const sp = score(prev), sc = score(idx), sn = score(next);
  // Vértice de la parábola que pasa por los tres puntos.
  const denom = (sp - 2 * sc + sn);
  let offset = 0;
  if (Math.abs(denom) > 1e-6) offset = clamp(0.5 * (sp - sn) / denom, -1, 1);
  return Perception.rayAngle(idx) + offset * RAY_STEP;
}

/**
 * Simula el avance del bot con su radio de giro real y comprueba si sobrevive.
 * No es una simulación completa: no hace falta. Basta con proyectar el arco.
 */
export function isPathClear(bot, world, targetAngle, steps) {
  const speed = bot.currentSpeed();
  const turnRate = turnRateForRadius(bot.radius) * bot.turnMul;
  const r = bot.radius;

  // La anticipación se mide en DISTANCIA, no en tiempo fijo. Con un paso fijo de
  // 0,09 s una serpiente enorme miraba solo ~100 px por delante, cuando necesita
  // más de 200 para completar un giro: por eso se comían el borde. El radio de
  // giro (v/ω) es la escala correcta.
  const turnRadius = speed / Math.max(0.1, turnRate);
  const lookDist = Math.max(150, turnRadius * 2.8);
  const dt = lookDist / (speed * steps);
  const turn = turnRate * dt;

  let x = bot.head.x;
  let y = bot.head.y;
  let a = bot.angle;

  const w = world.bounds.w;
  const h = world.bounds.h;
  const margin = r + 14;

  for (let i = 0; i < steps; i++) {
    const diff = angleDiff(a, targetAngle);
    a += clamp(diff, -turn, turn);

    const px = x, py = y;
    x += Math.cos(a) * speed * dt;
    y += Math.sin(a) * speed * dt;

    if (x < margin || y < margin || x > w - margin || y > h - margin) return false;
    if (world.mode.isLethalPoint && world.mode.isLethalPoint(world, x, y)) return false;

    // Solo consultamos el hash cada dos pasos: es lo caro y la resolución sobra.
    if ((i & 1) === 0) {
      const nodes = world.bodyHash.query(x, y, r + 30, scratchNodes);
      for (let k = 0; k < nodes.length; k++) {
        const n = nodes[k];
        if (n.snake === bot) continue;
        if (n.snake.team !== null && n.snake.team === bot.team) continue;
        if (n.snake.spikeTimer > 0 && n.isHead) continue;
        const reach = r + n.r + 4;
        if (distToSegment2(n.x, n.y, px, py, x, y) < reach * reach) return false;
      }
    }
  }
  return true;
}

/**
 * Decide si merece la pena gastar turbo. El bot antiguo aceleraba al azar el 1 %
 * de los fotogramas, que es exactamente el peor uso posible de un recurso que
 * cuesta masa.
 */
export function shouldBoost(bot, perception, state, traits, rngFn = Math.random) {
  if (!bot.canBoost()) return false;
  // Un bot torpe malgasta el turbo; uno hábil lo administra.
  const skill = traits.boostSkill;

  switch (state) {
    case 'FLEE': {
      const t = perception.nearestThreat;
      if (!t) return false;
      // Solo si de verdad está cerrando distancia, no por pánico.
      const closing = Math.cos(angleDiff(t.angle + Math.PI, t.snake.angle)) > 0.3;
      return t.dist < 190 + skill * 90 && closing;
    }
    case 'HUNT': {
      const p = perception.biggestPrey;
      if (!p) return false;
      return p.dist > 130 && p.dist < 420 && bot.mass > 40;
    }
    case 'SCAVENGE': {
      const c = perception.clusters[0];
      return !!c && c.dist > 180 && c.value > 90 && perception.crowding > 0.25;
    }
    case 'ENCIRCLE':
      return false;   // acelerar rompe el cerco: el radio de giro empeora
    case 'COIL':
      return false;
    default:
      // Granjeo: solo un bot poco hábil quema masa por llegar antes a un orbe.
      return skill < 0.3 && rngFn() < 0.004;
  }
}
