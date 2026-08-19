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
  { id: 'pattern:escamas',   kind: 'pattern', value: 'escamas',   label: 'Escamas',   req: null },
  { id: 'pattern:punteado',  kind: 'pattern', value: 'punteado',  label: 'Punteado',  req: null },
  { id: 'pattern:degradado', kind: 'pattern', value: 'degradado', label: 'Degradado', req: null },
  { id: 'pattern:pulso',     kind: 'pattern', value: 'pulso',     label: 'Pulso',     req: null },
  { id: 'pattern:diamantes', kind: 'pattern', value: 'diamantes', label: 'Diamantes', req: null },
  { id: 'pattern:escamas3d', kind: 'pattern', value: 'escamas3d', label: 'Escamas 3D', req: null },
  { id: 'pattern:zigzag',    kind: 'pattern', value: 'zigzag',    label: 'Zigzag',    req: null },
  { id: 'pattern:flores',    kind: 'pattern', value: 'flores',    label: 'Flores',    req: null },
  { id: 'pattern:galaxia',   kind: 'pattern', value: 'galaxia',   label: 'Galaxia',   req: null },

  // ── Ojos ──
  { id: 'eyes:redondos',  kind: 'eyes', value: 'redondos',  label: 'Redondos',  req: null },
  { id: 'eyes:rasgados',  kind: 'eyes', value: 'rasgados',  label: 'Rasgados',  req: null },
  { id: 'eyes:dormilon',  kind: 'eyes', value: 'dormilon',  label: 'Dormilón',  req: null },
  { id: 'eyes:ciclope',   kind: 'eyes', value: 'ciclope',   label: 'Cíclope',   req: null },
  { id: 'eyes:visor',     kind: 'eyes', value: 'visor',     label: 'Visor',     req: null },
  { id: 'eyes:gato',      kind: 'eyes', value: 'gato',      label: 'Gato',      req: null },
  { id: 'eyes:demonio',   kind: 'eyes', value: 'demonio',   label: 'Demonio',   req: null },
  { id: 'eyes:alien',     kind: 'eyes', value: 'alien',     label: 'Alien',     req: null },

  // ── Estelas ──
  { id: 'trail:chispas',    kind: 'trail', value: 'chispas',    label: 'Chispas',    req: null },
  { id: 'trail:burbujas',   kind: 'trail', value: 'burbujas',   label: 'Burbujas',   req: null },
  { id: 'trail:humo',       kind: 'trail', value: 'humo',       label: 'Humo',       req: null },
  { id: 'trail:fragmentos', kind: 'trail', value: 'fragmentos', label: 'Fragmentos', req: null },
  { id: 'trail:fuego',      kind: 'trail', value: 'fuego',      label: 'Fuego',      req: null },
  { id: 'trail:nieve',      kind: 'trail', value: 'nieve',      label: 'Nieve',      req: null },
  { id: 'trail:arcoiris',   kind: 'trail', value: 'arcoiris',   label: 'Arcoíris',   req: null },
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
