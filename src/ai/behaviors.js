/**
 * behaviors.js — Capa 2 del cerebro: los seis estados y su utilidad.
 *
 * Cada estado calcula una puntuación de 0 a 1 a partir de la percepción y de los
 * rasgos del bot, y produce un "deseo" (ángulo + peso) que la capa de dirección
 * convierte en giro. El cambio de estado lleva histéresis, para que el bot no
 * vibre entre dos ideas y parezca indeciso.
 */

import { interceptPoint, angleDiff, clamp, TAU } from '../engine/math.js';

export const STATES = ['FARM', 'HUNT', 'ENCIRCLE', 'FLEE', 'COIL', 'SCAVENGE'];

/* ═══════════════ Utilidades ═══════════════ */

export function scoreStates(bot, world, p, traits, memory) {
  const threat = p.nearestThreat;
  const prey = p.biggestPrey;
  const cluster = p.clusters[0];

  // ── FLEE: la amenaza real es una cabeza mayor que además viene hacia ti ──
  let flee = 0;
  if (threat) {
    const proximity = clamp(1 - threat.dist / 420, 0, 1);
    const facing = Math.max(0, Math.cos(angleDiff(threat.snake.angle, threat.angle + Math.PI)));
    const sizeGap = clamp((threat.ratio - 1) * 1.4, 0, 1);
    flee = proximity * (0.45 + facing * 0.55) * (0.5 + sizeGap * 0.5) * (0.55 + traits.cautela * 0.75);
  }
  flee = Math.max(flee, p.wallPressure * (0.35 + traits.cautela * 0.5));

  // ── COIL: acorralado. Sin salida limpia y con algo grande encima ──
  let coil = 0;
  if (threat && threat.dist < 200 && bot.mass > 60) {
    const trapped = clamp(p.crowding * 1.3 + p.wallPressure * 0.8, 0, 1);
    if (trapped > 0.55) coil = trapped * (0.4 + traits.cautela * 0.6);
  }

  // ── HUNT: corte frontal a alguien menor ──
  let hunt = 0;
  if (prey && bot.mass > 26) {
    const proximity = clamp(1 - prey.dist / 560, 0, 1);
    const gap = clamp((1 - prey.ratio) * 1.6, 0, 1);
    hunt = proximity * gap * (0.25 + traits.agresividad * 1.05);
    // Cazar con una amenaza pegada es cómo mueren los bots tontos.
    if (threat && threat.dist < 260) hunt *= 0.25;
  }

  // ── ENCIRCLE: mucho mayor y muy cerca → cerrar el cerco ──
  let encircle = 0;
  if (prey && prey.ratio < 0.62 && prey.dist < 300 && bot.mass > 90) {
    encircle = clamp(1 - prey.dist / 300, 0, 1) * (0.35 + traits.agresividad * 0.8) * (0.4 + traits.paciencia * 0.6);
  }

  // ── SCAVENGE: montón grande y fresco cerca ──
  let scavenge = 0;
  if (cluster) {
    const density = clamp(cluster.value / 260, 0, 1);
    const proximity = clamp(1 - cluster.dist / 520, 0, 1);
    scavenge = density * proximity * (0.3 + traits.codicia * 1.0);
    if (memory.recentDeathNear > 0) scavenge += 0.25 * traits.codicia;
  }

  // ── FARM: la línea base. Siempre hay algo que comer ──
  const farm = 0.28 + (cluster ? clamp(cluster.value / 500, 0, 0.25) : 0);

  return { FARM: farm, HUNT: hunt, ENCIRCLE: encircle, FLEE: flee, COIL: coil, SCAVENGE: scavenge };
}

/* ═══════════════ Deseos ═══════════════ */

export function desireFor(state, bot, world, p, traits, memory) {
  switch (state) {
    case 'FLEE':     return desireFlee(bot, world, p, traits);
    case 'HUNT':     return desireHunt(bot, world, p, traits);
    case 'ENCIRCLE': return desireEncircle(bot, world, p, traits, memory);
    case 'COIL':     return desireCoil(bot, world, p, traits, memory);
    case 'SCAVENGE': return desireScavenge(bot, world, p, traits, memory);
    default:         return desireFarm(bot, world, p, traits, memory);
  }
}

/**
 * Huir no es ir en línea recta al lado contrario: eso te mete en el borde o en
 * otro cuerpo. Se busca el hueco más ancho lejos de la amenaza.
 */
function desireFlee(bot, world, p, traits) {
  const t = p.nearestThreat;
  const away = t ? t.angle + Math.PI : bot.angle;

  // Sesgo hacia el centro del mapa: pegarse al borde huyendo es suicida.
  const cx = world.bounds.w / 2, cy = world.bounds.h / 2;
  const toCenter = Math.atan2(cy - bot.head.y, cx - bot.head.x);
  const centerPull = clamp(p.wallPressure * 1.4, 0, 1);

  const angle = blendAngles(away, toCenter, centerPull * 0.7);
  return { angle, weight: 1.35, avoidWeight: 1.6 };
}

/**
 * Corte frontal. La maniobra clave del género: no persigues la cabeza, apuntas
 * a donde va a estar y te cruzas por delante.
 */
function desireHunt(bot, world, p, traits) {
  const prey = p.biggestPrey;
  if (!prey) return desireFarm(bot, world, p, traits, { wander: bot.angle });

  const s = prey.snake;
  const v = s.velocity();
  const ip = interceptPoint(bot.head.x, bot.head.y, s.head.x, s.head.y, v.x, v.y, bot.currentSpeed());

  // Desplazamiento lateral: hay que cruzarse por delante, no colisionar de morro
  // (un choque frontal lo decide la masa, y no siempre ganas).
  const side = Math.sign(angleDiff(s.angle, Math.atan2(bot.head.y - s.head.y, bot.head.x - s.head.x))) || 1;
  const lead = clamp(prey.dist * 0.35, 40, 150);
  const px = ip.x + Math.cos(s.angle + side * Math.PI / 2) * lead * 0.35;
  const py = ip.y + Math.sin(s.angle + side * Math.PI / 2) * lead * 0.35;

  return {
    angle: Math.atan2(py - bot.head.y, px - bot.head.x),
    weight: 1.2 + traits.agresividad * 0.4,
    avoidWeight: -0.35,     // aceptar algo más de riesgo: si no, nunca cierra
  };
}

/**
 * Cerco: orbitar la presa con radio decreciente hasta cerrar el círculo.
 * Es lo que hace temibles a las serpientes grandes y lo que el bot antiguo
 * no sabía hacer en absoluto.
 */
function desireEncircle(bot, world, p, traits, memory) {
  const prey = p.biggestPrey;
  if (!prey) return desireFarm(bot, world, p, traits, memory);

  const s = prey.snake;
  if (memory.orbitDir === 0) {
    memory.orbitDir = angleDiff(bot.angle, Math.atan2(s.head.y - bot.head.y, s.head.x - bot.head.x)) > 0 ? -1 : 1;
  }

  // Radio objetivo que se cierra con el tiempo que llevas orbitando.
  const target = clamp(230 - memory.orbitTime * 40, bot.radius * 3.2, 240);
  const toPrey = Math.atan2(s.head.y - bot.head.y, s.head.x - bot.head.x);

  // Tangente + corrección radial: si estás lejos entras, si estás dentro sales.
  const radialError = clamp((prey.dist - target) / 140, -1, 1);
  const tangent = toPrey + memory.orbitDir * Math.PI / 2;
  const angle = blendAngles(tangent, toPrey, clamp(radialError * 0.8, -0.9, 0.9));

  return { angle, weight: 1.15, avoidWeight: 0.2 };
}

/**
 * Espiral defensivo: acorralado y sin salida, te enrollas sobre ti mismo. Nadie
 * puede entrar en un ovillo cerrado, así que el atacante acaba desistiendo.
 */
function desireCoil(bot, world, p, traits, memory) {
  if (memory.coilDir === 0) memory.coilDir = world.rng() < 0.5 ? -1 : 1;
  // Giro al máximo de forma sostenida, alejándose un poco del borde si aprieta.
  let angle = bot.angle + memory.coilDir * 0.9;
  if (p.wallPressure > 0.4) {
    const cx = world.bounds.w / 2, cy = world.bounds.h / 2;
    angle = blendAngles(angle, Math.atan2(cy - bot.head.y, cx - bot.head.x), 0.45);
  }
  return { angle, weight: 1.5, avoidWeight: 0.6 };
}

function desireScavenge(bot, world, p, traits, memory) {
  const c = p.clusters[0];
  if (!c) return desireFarm(bot, world, p, traits, memory);
  return {
    angle: Math.atan2(c.y - bot.head.y, c.x - bot.head.x),
    weight: 1.05 + traits.codicia * 0.35,
    avoidWeight: 0.35 - traits.codicia * 0.25,
  };
}

/**
 * Granjeo. Elige el cúmulo con mejor relación valor/riesgo, y si no hay nada
 * interesante, deambula con un objetivo persistente en lugar de oscilar (el
 * "wobble" senoidal del código anterior era lo que hacía que los bots parecieran
 * borrachos).
 */
function desireFarm(bot, world, p, traits, memory) {
  let best = null;
  let bestScore = -Infinity;

  for (const c of p.clusters) {
    // Penaliza los montones que están en la dirección de una amenaza.
    let risk = 0;
    for (const t of p.threats) {
      const align = Math.cos(angleDiff(c.angle, t.angle));
      if (align > 0.35) risk += align * clamp(1 - t.dist / 500, 0, 1);
    }
    const score = (c.value / (90 + c.dist * 0.55)) - risk * (1.4 + traits.cautela * 2.2);
    if (score > bestScore) { bestScore = score; best = c; }
  }

  if (best && bestScore > 0) {
    return { angle: best.angle, weight: 1, avoidWeight: 0.3 };
  }

  // Deambular: un punto objetivo que se mantiene varios segundos.
  if (!memory.wanderTarget || memory.wanderTime <= 0) {
    const margin = 420;
    // Rango de deambuleo proporcional al mundo: 1600 px fijos eran un paso
    // enorme en un mapa pequeño y un pasito en uno de 11.000.
    const reach = Math.min(3200, world.bounds.w * 0.22);
    memory.wanderTarget = {
      x: clamp(bot.head.x + (world.rng() - 0.5) * reach, margin, world.bounds.w - margin),
      y: clamp(bot.head.y + (world.rng() - 0.5) * reach, margin, world.bounds.h - margin),
    };
    memory.wanderTime = 3 + world.rng() * 4 * (0.5 + traits.paciencia);
  }
  const w = memory.wanderTarget;
  return {
    angle: Math.atan2(w.y - bot.head.y, w.x - bot.head.x),
    weight: 0.8,
    avoidWeight: 0.4,
  };
}

/** Interpolación angular por el camino corto. */
function blendAngles(a, b, t) {
  return a + angleDiff(a, b) * clamp(t, 0, 1);
}

export { blendAngles };
