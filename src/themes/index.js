/**
 * themes/index.js — Registro de temas y generación de pieles.
 *
 * Un tema define el mundo; una piel define una serpiente concreta dentro de él.
 * Las pieles se derivan de dos colores base elegidos por el jugador, y se
 * comprueba su contraste contra el fondo del tema activo para que no exista
 * ninguna combinación invisible.
 */

import panal from './panal.js';
import abyss from './abyss.js';
import neon from './neon.js';
import cartoon from './cartoon.js';
import { hexToRgb, mixHex, clamp } from '../engine/math.js';

export const THEMES = { panal, abyss, neon, cartoon };
// «Panal» va primero porque es el tema por defecto.
export const THEME_LIST = [panal, abyss, neon, cartoon];

export function getTheme(id) {
  return THEMES[id] ?? panal;
}

export const PATTERNS = [
  { id: 'liso',      label: 'Liso' },
  { id: 'rayas',     label: 'Rayas' },
  { id: 'bandas',    label: 'Bandas' },
  { id: 'escamas',   label: 'Escamas' },
  { id: 'punteado',  label: 'Punteado' },
  { id: 'degradado', label: 'Degradado' },
  { id: 'pulso',     label: 'Pulso' },
];

export const EYE_STYLES = [
  { id: 'redondos',  label: 'Redondos' },
  { id: 'rasgados',  label: 'Rasgados' },
  { id: 'dormilon',  label: 'Dormilón' },
  { id: 'ciclope',   label: 'Cíclope' },
  { id: 'visor',     label: 'Visor' },
];

export const TRAILS = [
  { id: 'chispas',    label: 'Chispas' },
  { id: 'burbujas',   label: 'Burbujas' },
  { id: 'humo',       label: 'Humo' },
  { id: 'fragmentos', label: 'Fragmentos' },
];

/** Luminancia relativa, para la comprobación de contraste. */
function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Construye la piel usada por el renderizador a partir de la configuración del
 * jugador. Si el color primario no contrasta lo suficiente con el fondo del
 * tema, se aclara hasta que lo haga: mejor desviarse un poco del color elegido
 * que dejar una serpiente que no se ve.
 */
export function buildSkin({ primary, secondary, pattern, eyes, trail }, theme) {
  let head = primary;
  const bg = theme.background.base;

  let guard = 0;
  while (contrastRatio(head, bg) < 2.2 && guard++ < 12) {
    head = mixHex(head, '#ffffff', 0.12);
  }

  return {
    head,
    body:  mixHex(head, '#000000', 0.20),
    body2: secondary,
    dark:  mixHex(head, '#000000', 0.42),
    glow:  mixHex(head, '#ffffff', 0.18),
    hue:   hueOf(head),
    pattern: pattern ?? 'liso',
    eyes:  eyes ?? 'redondos',
    trail: trail ?? 'chispas',
  };
}

export function hueOf(hex) {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h;
  if (max === rn)      h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else                 h = (rn - gn) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Paleta de pieles para los bots: tonos repartidos por la rueda de color. */
export function botSkin(index, theme) {
  const hue = (index * 47) % 360;
  const primary = hslHex(hue, 68, 58);
  const secondary = hslHex((hue + 22) % 360, 60, 40);
  const patterns = ['liso', 'rayas', 'bandas', 'escamas', 'punteado'];
  return buildSkin({
    primary,
    secondary,
    pattern: patterns[index % patterns.length],
    eyes: 'redondos',
    trail: 'chispas',
  }, theme);
}

export function teamSkin(teamColor, index, theme) {
  const hue = hueOf(teamColor);
  const primary = hslHex(hue, 62, clamp(46 + (index % 4) * 7, 40, 70));
  return buildSkin({
    primary,
    secondary: mixHex(teamColor, '#000000', 0.4),
    pattern: index % 2 ? 'bandas' : 'liso',
    eyes: 'redondos',
    trail: 'chispas',
  }, theme);
}

export function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(Math.min(k(n) - 3, 9 - k(n)), 1));
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
