/**
 * daily.js — Desafío diario.
 *
 * Envoltorio con semilla sobre Frenesí. La semilla se deriva de la fecha local,
 * así que el mapa, los spawns y las zonas de bonificación son idénticos durante
 * toda la jornada. No hace falta servidor para que sea un desafío compartido:
 * basta con que el mundo sea determinista.
 */

import frenzy from './frenzy.js';
import { defineMode } from './Mode.js';
import { seedFromDate, dateKey, makeRng } from '../engine/rng.js';

/** Catálogo de objetivos. Cada uno se evalúa contra challengeData. */
const OBJECTIVES = [
  { id: 'score1200', label: 'Consigue 1200 puntos',        test: (d) => d.score >= 1200,     progress: (d) => d.score / 1200 },
  { id: 'score2000', label: 'Consigue 2000 puntos',        test: (d) => d.score >= 2000,     progress: (d) => d.score / 2000 },
  { id: 'kills5',    label: 'Elimina a 5 rivales',         test: (d) => d.kills >= 5,        progress: (d) => d.kills / 5 },
  { id: 'kills3',    label: 'Elimina a 3 rivales',         test: (d) => d.kills >= 3,        progress: (d) => d.kills / 3 },
  { id: 'eat200',    label: 'Come 200 orbes',              test: (d) => d.eaten >= 200,      progress: (d) => d.eaten / 200 },
  { id: 'noboost',   label: 'Come 120 orbes sin usar turbo', test: (d) => d.noBoostEats >= 120, progress: (d) => d.noBoostEats / 120 },
  { id: 'mult5',     label: 'Alcanza el multiplicador ×5', test: (d) => d.bestMult >= 5,     progress: (d) => d.bestMult / 5 },
  { id: 'hold5',     label: 'Mantén ×5 durante 30 s',      test: (d) => d.multTime5 >= 30,   progress: (d) => d.multTime5 / 30 },
  { id: 'nodeath',   label: 'Termina sin morir',           test: (d) => d.deaths === 0,      progress: (d) => (d.deaths === 0 ? 1 : 0) },
  { id: 'mass300',   label: 'Llega a 300 de longitud',     test: (d) => d.peakMass >= 300,   progress: (d) => d.peakMass / 300 },
];

/** Los tres objetivos del día, deterministas a partir de la fecha. */
export function todaysObjectives(date = new Date()) {
  const rng = makeRng(seedFromDate(date) * 7919);
  const pool = OBJECTIVES.slice();
  const out = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    out.push(pool.splice(rng.int(0, pool.length), 1)[0]);
  }
  return out;
}

export function todaysSeed(date = new Date()) {
  return seedFromDate(date);
}

export default defineMode({
  ...frenzy,
  id: 'daily',
  name: 'Desafío diario',
  short: 'El mismo mapa para todos hoy. Tres objetivos, una medalla.',

  setup(world) {
    // El RNG del mundo ya viene con la semilla del día desde main.js.
    frenzy.setup.call(this, world);
    this.objectives = todaysObjectives();
    this.dateKey = dateKey();
  },

  tick(world, dt) {
    frenzy.tick.call(this, world, dt);
  },

  onEat(world, snake, orb) { return frenzy.onEat.call(this, world, snake, orb); },
  onKill(world, victim, killer) { return frenzy.onKill.call(this, world, victim, killer); },
  isOver(world) { return frenzy.isOver.call(this, world); },
  orbSpawnPoint(world) { return frenzy.orbSpawnPoint.call(this, world); },
  drawUnder(...args) { return frenzy.drawUnder.apply(this, args); },
  drawOver(...args) { return frenzy.drawOver.apply(this, args); },
  drawMinimap(...args) { return frenzy.drawMinimap.apply(this, args); },

  results(world) {
    const base = frenzy.results.call(this, world);
    const data = base.challengeData;
    const completed = this.objectives.map((o) => ({
      id: o.id,
      label: o.label,
      done: o.test(data),
      progress: Math.min(1, o.progress(data)),
    }));
    const medals = completed.filter((c) => c.done).length;

    return {
      ...base,
      title: medals === 3 ? '¡Desafío completo!' : `${medals} de 3 objetivos`,
      cause: `Desafío del ${this.dateKey}`,
      objectives: completed,
      medals,
      metric: 'dailyMedals',
      dateKey: this.dateKey,
    };
  },

  hud(world) {
    const base = frenzy.hud.call(this, world);
    const live = {
      score: Math.round(this.score),
      kills: world.player?.kills ?? 0,
      eaten: world.player?.eaten ?? 0,
      noBoostEats: this.noBoostEats,
      bestMult: this.bestMult,
      multTime5: this.multTime[5] ?? 0,
      deaths: this.deaths,
      peakMass: Math.round(world.player?.peakMass ?? 0),
    };
    return {
      ...base,
      objectives: this.objectives.map((o) => ({
        label: o.label,
        done: o.test(live),
        pct: Math.min(100, o.progress(live) * 100),
      })),
    };
  },
});
