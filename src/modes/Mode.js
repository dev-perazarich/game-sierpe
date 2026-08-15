/**
 * Mode.js — Contrato común de los modos de juego.
 *
 * El motor no sabe nada de zonas que se encogen, de oleadas ni de nodos de
 * captura: solo llama a estos métodos. Añadir un modo nuevo es escribir un
 * archivo y registrarlo en modes/index.js.
 *
 * Todos los métodos son opcionales salvo setup, tick, isOver y results.
 */

export const BASE_MODE = {
  id: 'base',
  name: 'Modo',
  short: '',
  duration: null,          // segundos, o null si es infinito
  friendlyFire: true,
  orbHues: [155, 190, 45, 300, 20, 265],

  setup(world) {},                       // tamaño del mundo, población, reglas
  tick(world, dt) {},                    // lógica propia del modo
  onEat(world, snake, orb) { return orb.value; },
  onKill(world, victim, killer, cause) {},
  isOver(world) { return false; },
  results(world) { return {}; },

  // Opcionales
  // hud(world)                          → datos para el HUD de Vue
  // leaderboard(world)                  → filas del ranking
  // isSpawnValid(world, pos)            → veta puntos de aparición
  // isLethalPoint(world, x, y)          → lo consulta la traza anti-suicidio
  // dangerField(world, bot, perc, rays) → añade coste al mapa de peligro
  // orbSpawnPoint(world)                → dónde reponer comida
  // drawUnder / drawOver / drawMinimap / drawHudCanvas
};

export function defineMode(def) {
  return { ...BASE_MODE, ...def };
}

/** Reparto de dificultad de bots: unos pocos buenos, muchos normales, algunos malos. */
export function difficultyFor(index, total, base) {
  const t = index / Math.max(1, total - 1);
  // Curva: el 15 % superior por encima de la base, el 25 % inferior por debajo.
  if (t < 0.15) return Math.min(1, base + 0.22);
  if (t > 0.75) return Math.max(0.08, base - 0.20);
  return base + (t - 0.45) * 0.12;
}

/** Población de bots estándar, reutilizada por varios modos. */
export function populate(world, { count, difficulty, massRange = [14, 14], skinFor, nameFor, team = null }) {
  const created = [];
  for (let i = 0; i < count; i++) {
    const mass = world.rng.range(massRange[0], massRange[1]);
    created.push(world.spawnBot({
      skin: skinFor(i),
      name: nameFor(i),
      team,
      mass,
      difficulty: difficultyFor(i, count, difficulty),
    }));
  }
  return created;
}

export function uniqueName(world, pool, index) {
  const base = pool[index % pool.length];
  const suffix = index >= pool.length ? ` ${Math.floor(index / pool.length) + 1}` : '';
  return base + suffix;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
