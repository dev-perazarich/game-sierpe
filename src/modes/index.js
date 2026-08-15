/**
 * modes/index.js — Registro de modos.
 * Añadir un modo es importar su archivo y meterlo en la lista.
 */

import classic from './classic.js';
import royale from './royale.js';
import domination from './domination.js';
import nest from './nest.js';
import frenzy from './frenzy.js';
import daily from './daily.js';

export const MODES = { classic, royale, domination, nest, frenzy, daily };

/** Los cinco que se muestran como tarjetas en el menú, en orden. */
export const MODE_LIST = [
  { ...classic,    duracion: 'Sin límite', icon: '∞' },
  { ...royale,     duracion: '≈ 7 min',    icon: '◎' },
  { ...domination, duracion: '≈ 8 min',    icon: '⬢' },
  { ...nest,       duracion: 'Hasta morir',icon: '✳' },
  { ...frenzy,     duracion: '3 min',      icon: '⧗' },
];

export function getMode(id) {
  return MODES[id] ?? classic;
}

/**
 * Instancia fresca de un modo. Es importante: los modos guardan estado propio
 * (zona, oleada, nodos), así que reutilizar el objeto entre partidas arrastraría
 * la partida anterior.
 */
export function instantiateMode(id) {
  const def = getMode(id);
  return Object.create(Object.getPrototypeOf(def), Object.getOwnPropertyDescriptors(def));
}
