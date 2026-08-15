/**
 * rng.js — Generador con semilla (mulberry32).
 * Necesario para los desafíos diarios: misma fecha → mismo mapa y mismos spawns
 * para todo el mundo, sin servidor.
 */

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (min, max) => min + next() * (max - min);
  next.int = (min, max) => Math.floor(next.range(min, max));
  next.pick = (arr) => arr[next.int(0, arr.length)];
  next.chance = (p) => next() < p;
  return next;
}

/** Semilla derivada de una fecha local, en formato AAAAMMDD. */
export function seedFromDate(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  return y * 10000 + m * 100 + d;
}

export function dateKey(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** RNG global no determinista, para todo lo que no sea un desafío diario. */
export const rng = makeRng((Math.random() * 0xffffffff) >>> 0);
