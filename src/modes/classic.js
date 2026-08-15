/**
 * classic.js — La partida infinita.
 *
 * Es la referencia contra la que se mide todo lo demás: sin condición de fin,
 * población constante y ninguna regla añadida. Si el tacto está bien aquí, está
 * bien en todas partes.
 */

import { defineMode, populate, uniqueName, formatTime } from './Mode.js';
import { BOT_NAMES, orbsForWorld, botsForWorld } from '../config.js';
import { botSkin } from '../themes/index.js';

export default defineMode({
  id: 'classic',
  name: 'Clásico',
  short: 'Sin final. Crece todo lo que puedas.',
  duration: null,
  friendlyFire: true,

  setup(world) {
    const W = 11000, H = 11000;
    world.setWorldSize(W, H);
    world.orbTarget = orbsForWorld(W, H);

    const theme = world.settings.themeObj;
    const difficulty = world.settings.difficultyValue;

    world.spawnPlayer(world.playerConfig.skin, world.playerConfig.name);
    populate(world, {
      count: botsForWorld(W, H),
      difficulty,
      massRange: [14, 120],
      skinFor: (i) => botSkin(i, theme),
      nameFor: (i) => uniqueName(world, BOT_NAMES, i),
    });

    world.fillOrbs(world.orbTarget);
    this.botRespawnQueue = [];
  },

  tick(world, dt) {
    // Reaparición diferida de bots: mantiene la población constante sin
    // setTimeout sueltos, que era el origen de los "bots fantasma" al reiniciar.
    for (let i = this.botRespawnQueue.length - 1; i >= 0; i--) {
      const entry = this.botRespawnQueue[i];
      entry.t -= dt;
      if (entry.t <= 0) {
        this.botRespawnQueue.splice(i, 1);
        world.respawn(entry.snake, { massKeep: 0 });
      }
    }
  },

  onKill(world, victim, killer) {
    if (victim.isPlayer) return;
    this.botRespawnQueue.push({ snake: victim, t: 3 });
  },

  isOver(world) {
    return !!world.player && !world.player.alive;
  },

  results(world) {
    const p = world.player;
    return {
      title: 'Fin de la partida',
      cause: describeCause(p),
      stats: [
        { label: 'Longitud', value: Math.round(p.peakMass) },
        { label: 'Eliminaciones', value: p.kills },
        { label: 'Orbes', value: p.eaten },
        { label: 'Tiempo', value: formatTime(world.time) },
      ],
      score: Math.round(p.peakMass),
      metric: 'peakMass',
    };
  },

  hud(world) {
    // Sin `primary`: la longitud ya vive abajo a la izquierda, en el bloque fijo
    // del HUD. Repetirla arriba solo ocuparía sitio.
    return {
      secondary: { label: 'Tiempo', value: formatTime(world.time) },
    };
  },
});

export function describeCause(snake) {
  if (!snake) return '';
  switch (snake.deathCause) {
    case 'edge':  return 'Chocaste contra el borde del mundo';
    case 'zone':  return 'La zona te alcanzó';
    case 'head':  return `Choque frontal con ${snake.killerName ?? 'un rival'}`;
    case 'spike': return `Las púas de ${snake.killerName ?? 'un rival'} te alcanzaron`;
    case 'body':  return `Chocaste contra ${snake.killerName ?? 'un rival'}`;
    default:      return 'Fin de la partida';
  }
}
