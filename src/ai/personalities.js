/**
 * personalities.js — Rasgos que sesgan las funciones de utilidad de cada bot.
 *
 * Dos bots del mismo nivel de dificultad juegan de forma reconociblemente
 * distinta. Eso es lo que hace que un mundo lleno de IA parezca vivo en lugar
 * de parecer doce copias del mismo autómata.
 */

import { clamp } from '../engine/math.js';

/**
 * Arquetipos. Cada uno es un centro alrededor del cual se sortean los rasgos,
 * para que la variedad no sea ruido uniforme sino tipos reconocibles.
 */
export const ARCHETYPES = [
  { id: 'cazador',   label: 'Cazador',    agresividad: 0.85, codicia: 0.45, cautela: 0.30, paciencia: 0.65 },
  { id: 'granjero',  label: 'Granjero',   agresividad: 0.15, codicia: 0.75, cautela: 0.70, paciencia: 0.80 },
  { id: 'carroñero', label: 'Carroñero',  agresividad: 0.35, codicia: 0.95, cautela: 0.45, paciencia: 0.35 },
  { id: 'guardián',  label: 'Guardián',   agresividad: 0.45, codicia: 0.30, cautela: 0.85, paciencia: 0.90 },
  { id: 'errático',  label: 'Errático',   agresividad: 0.60, codicia: 0.60, cautela: 0.25, paciencia: 0.15 },
  { id: 'emboscador',label: 'Emboscador', agresividad: 0.70, codicia: 0.40, cautela: 0.60, paciencia: 0.95 },
];

/**
 * Genera un juego de rasgos.
 * @param {number} difficulty 0..1 — controla SOLO habilidad. Nunca velocidad.
 */
export function makeTraits(rngFn, difficulty = 0.5, forced = null) {
  const arch = forced
    ? ARCHETYPES.find((a) => a.id === forced) ?? rngFn.pick(ARCHETYPES)
    : rngFn.pick(ARCHETYPES);

  const jitter = (base, spread = 0.18) => clamp(base + rngFn.range(-spread, spread), 0.05, 0.98);

  // La habilidad es el único rasgo atado a la dificultad, y se traduce en dos
  // cosas medibles: cuánto tarda en reaccionar y cuánto falla el ángulo.
  const habilidad = clamp(difficulty + rngFn.range(-0.12, 0.12), 0.05, 1);

  return {
    archetype:   arch.id,
    label:       arch.label,
    agresividad: jitter(arch.agresividad),
    codicia:     jitter(arch.codicia),
    cautela:     jitter(arch.cautela),
    paciencia:   jitter(arch.paciencia),
    habilidad,

    // Derivados de la habilidad — los consume BotBrain directamente.
    reactionTime: 0.32 - habilidad * 0.24,        // 320 ms → 80 ms
    aimNoise:     0.18 - habilidad * 0.16,        // ±0,18 rad → ±0,02 rad
    traceDepth:   Math.round(4 + habilidad * 6),  // 4 → 10 pasos de anticipación
    perceptEvery: habilidad > 0.7 ? 2 : habilidad > 0.35 ? 3 : 4,
    boostSkill:   habilidad,                      // cómo de bien administra el turbo
  };
}

/** Dificultad por nivel, expuesta en ajustes y usada por los modos. */
export const DIFFICULTY = {
  facil:   { id: 'facil',   label: 'Fácil',   value: 0.28 },
  normal:  { id: 'normal',  label: 'Normal',  value: 0.52 },
  dificil: { id: 'dificil', label: 'Difícil', value: 0.76 },
  brutal:  { id: 'brutal',  label: 'Brutal',  value: 0.94 },
};

export const DIFFICULTY_LIST = Object.values(DIFFICULTY);
