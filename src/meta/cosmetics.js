/**
 * cosmetics.js — Catálogo de cosméticos y sus condiciones de desbloqueo.
 *
 * Nada se compra: cada cosmético cuelga de un logro concreto. La lista de
 * desbloqueos es, en la práctica, la lista de cosas que el juego quiere
 * enseñarte a hacer.
 */

import { PATTERNS, EYE_STYLES, TRAILS } from '../themes/index.js';

/**
 * `req` null significa disponible desde el principio.
 * `check(stats)` recibe el objeto de estadísticas del perfil.
 */
export const COSMETICS = [
  // ── Patrones ──
  { id: 'pattern:liso',      kind: 'pattern', value: 'liso',      label: 'Liso',      req: null },
  { id: 'pattern:rayas',     kind: 'pattern', value: 'rayas',     label: 'Rayas',     req: null },
  { id: 'pattern:bandas',    kind: 'pattern', value: 'bandas',    label: 'Bandas',    req: null },
  { id: 'pattern:escamas',   kind: 'pattern', value: 'escamas',   label: 'Escamas',
    req: 'Alcanza 250 de longitud', check: (s) => s.bestLength >= 250 },
  { id: 'pattern:punteado',  kind: 'pattern', value: 'punteado',  label: 'Punteado',
    req: 'Come 2000 orbes en total', check: (s) => s.totalEaten >= 2000 },
  { id: 'pattern:degradado', kind: 'pattern', value: 'degradado', label: 'Degradado',
    req: 'Alcanza 500 de longitud', check: (s) => s.bestLength >= 500 },
  { id: 'pattern:pulso',     kind: 'pattern', value: 'pulso',     label: 'Pulso',
    req: 'Gana una partida de Cerco', check: (s) => s.royaleWins >= 1 },

  // ── Ojos ──
  { id: 'eyes:redondos',  kind: 'eyes', value: 'redondos',  label: 'Redondos',  req: null },
  { id: 'eyes:rasgados',  kind: 'eyes', value: 'rasgados',  label: 'Rasgados',
    req: 'Elimina a 25 rivales', check: (s) => s.totalKills >= 25 },
  { id: 'eyes:dormilon',  kind: 'eyes', value: 'dormilon',  label: 'Dormilón',
    req: 'Juega 20 partidas', check: (s) => s.games >= 20 },
  { id: 'eyes:ciclope',   kind: 'eyes', value: 'ciclope',   label: 'Cíclope',
    req: 'Supera la oleada 10 en Nido', check: (s) => s.bestNestWave >= 10 },
  { id: 'eyes:visor',     kind: 'eyes', value: 'visor',     label: 'Visor',
    req: 'Supera la oleada 15 en Nido', check: (s) => s.bestNestWave >= 15 },

  // ── Estelas ──
  { id: 'trail:chispas',    kind: 'trail', value: 'chispas',    label: 'Chispas',    req: null },
  { id: 'trail:burbujas',   kind: 'trail', value: 'burbujas',   label: 'Burbujas',
    req: 'Queda entre los 3 primeros en Cerco', check: (s) => s.bestRoyalePlace !== null && s.bestRoyalePlace <= 3 },
  { id: 'trail:humo',       kind: 'trail', value: 'humo',       label: 'Humo',
    req: 'Consigue 2500 puntos en Frenesí', check: (s) => s.bestFrenzyScore >= 2500 },
  { id: 'trail:fragmentos', kind: 'trail', value: 'fragmentos', label: 'Fragmentos',
    req: 'Racha de 3 desafíos diarios', check: (s) => s.dailyStreak >= 3 },
];

export function catalogFor(kind, profile) {
  return COSMETICS
    .filter((c) => c.kind === kind)
    .map((c) => ({
      ...c,
      locked: c.req !== null && !profile.isUnlocked(c.id),
    }));
}

/** Revisa qué cosméticos cumplen ya su condición. Devuelve los recién abiertos. */
export function checkUnlocks(profile) {
  const opened = [];
  for (const c of COSMETICS) {
    if (c.req === null || profile.isUnlocked(c.id)) continue;
    if (c.check(profile.stats)) {
      profile.unlock(c.id);
      opened.push(c);
    }
  }
  return opened;
}

/** Garantiza que la apariencia guardada no use nada bloqueado. */
export function sanitizeAppearance(appearance, profile) {
  const fix = (kind, current, fallback) => {
    const item = COSMETICS.find((c) => c.kind === kind && c.value === current);
    if (!item) return fallback;
    if (item.req !== null && !profile.isUnlocked(item.id)) return fallback;
    return current;
  };
  appearance.pattern = fix('pattern', appearance.pattern, 'liso');
  appearance.eyes    = fix('eyes',    appearance.eyes,    'redondos');
  appearance.trail   = fix('trail',   appearance.trail,   'chispas');
  return appearance;
}

export { PATTERNS, EYE_STYLES, TRAILS };
