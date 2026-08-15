/**
 * achievements.js — Logros.
 *
 * Se evalúan al terminar cada partida contra las estadísticas acumuladas. Cada
 * logro que se cumple abre normalmente un cosmético (ver cosmetics.js).
 */

import { checkUnlocks } from './cosmetics.js';

export const ACHIEVEMENTS = [
  { id: 'first_blood',  name: 'Primera sangre',   desc: 'Elimina a tu primer rival.',            check: (s) => s.totalKills >= 1 },
  { id: 'century',      name: 'Centenaria',       desc: 'Llega a 100 de longitud.',              check: (s) => s.bestLength >= 100 },
  { id: 'five_hundred', name: 'Colosal',          desc: 'Llega a 500 de longitud.',              check: (s) => s.bestLength >= 500 },
  { id: 'thousand',     name: 'Titán',            desc: 'Llega a 1000 de longitud.',             check: (s) => s.bestLength >= 1000 },
  { id: 'royale_top3',  name: 'Podio',            desc: 'Queda entre los 3 primeros en Cerco.',  check: (s) => s.bestRoyalePlace !== null && s.bestRoyalePlace <= 3 },
  { id: 'royale_win',   name: 'Última en pie',    desc: 'Gana una partida de Cerco.',            check: (s) => s.royaleWins >= 1 },
  { id: 'nest_10',      name: 'Resistente',       desc: 'Supera la oleada 10 en Nido.',          check: (s) => s.bestNestWave >= 10 },
  { id: 'nest_15',      name: 'Cazadora de jefes',desc: 'Supera la oleada 15 en Nido.',          check: (s) => s.bestNestWave >= 15 },
  { id: 'frenzy_2000',  name: 'Frenética',        desc: 'Consigue 2000 puntos en Frenesí.',      check: (s) => s.bestFrenzyScore >= 2000 },
  { id: 'domination',   name: 'Estratega',        desc: 'Gana una partida de Dominio.',          check: (s) => s.dominationWins >= 1 },
  { id: 'hunter',       name: 'Depredadora',      desc: 'Elimina a 50 rivales en total.',        check: (s) => s.totalKills >= 50 },
  { id: 'glutton',      name: 'Insaciable',       desc: 'Come 5000 orbes en total.',             check: (s) => s.totalEaten >= 5000 },
  { id: 'daily_3',      name: 'Constante',        desc: 'Racha de 3 desafíos diarios.',          check: (s) => s.dailyStreak >= 3 },
  { id: 'daily_7',      name: 'Devota',           desc: 'Racha de 7 desafíos diarios.',          check: (s) => s.dailyStreak >= 7 },
  { id: 'veteran',      name: 'Veterana',         desc: 'Juega 50 partidas.',                    check: (s) => s.games >= 50 },
];

/**
 * Evalúa todo y devuelve lo recién conseguido, para poder anunciarlo.
 * @returns {{ achievements: Array, cosmetics: Array }}
 */
export function evaluate(profile) {
  const newAchievements = [];
  for (const a of ACHIEVEMENTS) {
    const key = `ach:${a.id}`;
    if (profile.isUnlocked(key)) continue;
    if (a.check(profile.stats)) {
      profile.unlock(key);
      newAchievements.push(a);
    }
  }
  const newCosmetics = checkUnlocks(profile);
  return { achievements: newAchievements, cosmetics: newCosmetics };
}

export function progressList(profile) {
  return ACHIEVEMENTS.map((a) => ({
    ...a,
    done: profile.isUnlocked(`ach:${a.id}`),
  }));
}
