/**
 * domination.js — «Dominio». Tres equipos, cinco nodos.
 *
 * Cambia el objetivo de "ser el más largo" a "controlar el mapa", y es el único
 * modo con aliados: los bots de tu color juegan para el marcador común y
 * atienden tus marcas (clic derecho).
 *
 * Distinción por forma además de color en minimapa y nodos, para que los equipos
 * se puedan diferenciar sin depender de la percepción del color.
 */

import { defineMode, uniqueName, difficultyFor, formatTime } from './Mode.js';
import { BOT_NAMES, orbsForWorld } from '../config.js';
import { teamSkin, buildSkin } from '../themes/index.js';
import { EV } from '../engine/events.js';
import { ORB_KIND } from '../entities/Orb.js';
import { rgba, clamp } from '../engine/math.js';
import { describeCause } from './classic.js';

const TEAMS = [
  { id: 0, name: 'Verde',   color: '#5ad48c', shape: 'circle' },
  { id: 1, name: 'Ámbar',   color: '#f0b43c', shape: 'square' },
  { id: 2, name: 'Violeta', color: '#a97bf0', shape: 'triangle' },
];

const TARGET_SCORE = 1000;
const CAPTURE_RATE = 22;       // progreso por segundo y por serpiente aliada
const NODE_RADIUS = 300;       // escalado al mundo grande: si no, no se encuentran
const RESPAWN_TIME = 5;
const MASS_KEEP = 0.6;

export default defineMode({
  id: 'domination',
  name: 'Dominio',
  short: 'Tres equipos, cinco nodos. Controla el mapa, no solo tu tamaño.',
  duration: null,
  friendlyFire: false,
  orbHues: [150, 42, 275],

  setup(world) {
    const W = 8000, H = 8000;
    world.setWorldSize(W, H);
    world.orbTarget = orbsForWorld(W, H, 0.9);

    const theme = world.settings.themeObj;
    const difficulty = world.settings.difficultyValue;

    this.teams = TEAMS.map((t) => ({ ...t, score: 0, nodes: 0 }));
    this.playerTeam = 0;

    // Nodos: cuatro en cruz más uno central, que es el disputado de verdad.
    const w = world.bounds.w, h = world.bounds.h;
    this.nodes = [
      { id: 0, x: w * 0.5,  y: h * 0.5,  r: NODE_RADIUS * 1.15 },
      { id: 1, x: w * 0.22, y: h * 0.28, r: NODE_RADIUS },
      { id: 2, x: w * 0.78, y: h * 0.28, r: NODE_RADIUS },
      { id: 3, x: w * 0.22, y: h * 0.72, r: NODE_RADIUS },
      { id: 4, x: w * 0.78, y: h * 0.72, r: NODE_RADIUS },
    ].map((n) => ({ ...n, owner: null, progress: 0, capturing: null, contested: false, orbTimer: 0 }));

    // Jugador
    const playerSkin = buildSkin({
      ...world.playerConfig.raw,
      primary: TEAMS[0].color,
    }, theme);
    world.spawnPlayer(playerSkin, world.playerConfig.name);
    world.player.team = 0;

    // Bots: 7 aliados + 8 por equipo rival
    let idx = 0;
    for (const team of this.teams) {
      const count = team.id === this.playerTeam ? 7 : 8;
      for (let i = 0; i < count; i++) {
        const bot = world.spawnBot({
          skin: teamSkin(team.color, i, theme),
          name: uniqueName(world, BOT_NAMES, idx),
          team: team.id,
          mass: world.rng.range(16, 45),
          difficulty: difficultyFor(i, count, difficulty),
        });
        idx++;
      }
    }

    world.fillOrbs(world.orbTarget);

    this.respawnQueue = [];
    this.ping = null;
    this.pingTimer = 0;
    this.assignTimer = 0;
  },

  tick(world, dt) {
    this._tickNodes(world, dt);
    this._tickScore(world, dt);
    this._tickRespawns(world, dt);
    this._tickAssignments(world, dt);

    if (this.pingTimer > 0) this.pingTimer -= dt;
  },

  _tickNodes(world, dt) {
    for (const node of this.nodes) {
      // Cuántas serpientes de cada equipo hay dentro del radio.
      const inside = [0, 0, 0];
      for (const s of world.snakes) {
        if (!s.alive || s.team === null) continue;
        if (Math.hypot(s.head.x - node.x, s.head.y - node.y) < node.r) inside[s.team]++;
      }

      const present = inside.map((c, i) => ({ team: i, count: c })).filter((e) => e.count > 0);
      node.contested = present.length > 1;

      if (present.length === 0) {
        // Sin nadie dentro, la captura en curso se desvanece lentamente.
        if (node.owner === null && node.progress > 0) {
          node.progress = Math.max(0, node.progress - dt * 6);
          if (node.progress === 0) node.capturing = null;
        }
        continue;
      }

      // Contestado: se congela. Hay que expulsar al rival primero.
      if (node.contested) continue;

      const claimer = present[0];
      const rate = CAPTURE_RATE * Math.min(3, claimer.count) * dt;

      if (node.owner === claimer.team) {
        node.progress = Math.min(100, node.progress + rate);
        continue;
      }

      if (node.capturing !== claimer.team) {
        // Primero hay que borrar el progreso del dueño anterior.
        node.progress -= rate;
        if (node.progress <= 0) {
          node.progress = 0;
          node.owner = null;
          node.capturing = claimer.team;
        }
      } else {
        node.progress = Math.min(100, node.progress + rate);
        if (node.progress >= 100 && node.owner !== claimer.team) {
          node.owner = claimer.team;
          world.events.emit(EV.NODE_CAP, { node, team: this.teams[claimer.team] });
        }
      }
    }

    // Recuento de nodos por equipo
    for (const t of this.teams) t.nodes = 0;
    for (const n of this.nodes) if (n.owner !== null) this.teams[n.owner].nodes++;
  },

  _tickScore(world, dt) {
    for (const t of this.teams) {
      t.score += t.nodes * 12 * dt;
    }
    // Orbes de equipo generados por los nodos poseídos.
    for (const node of this.nodes) {
      if (node.owner === null) continue;
      node.orbTimer -= dt;
      if (node.orbTimer > 0) continue;
      node.orbTimer = 1.4;
      const a = world.rng.range(0, Math.PI * 2);
      const r = world.rng.range(20, node.r * 0.8);
      world.orbs.spawn(node.x + Math.cos(a) * r, node.y + Math.sin(a) * r, {
        r: 6.5, kind: ORB_KIND.TEAM, team: node.owner,
        hue: [150, 42, 275][node.owner],
      });
    }
  },

  _tickRespawns(world, dt) {
    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const e = this.respawnQueue[i];
      e.t -= dt;
      if (e.t > 0) continue;
      this.respawnQueue.splice(i, 1);

      // Reaparece junto a un nodo aliado, no en un punto aleatorio del mapa.
      const own = this.nodes.filter((n) => n.owner === e.snake.team);
      const node = own.length ? own[world.rng.int(0, own.length)] : null;
      world.respawn(e.snake, {
        massKeep: MASS_KEEP,
        nearX: node ? node.x : null,
        nearY: node ? node.y : null,
      });
    }
  },

  /** Reparte objetivos a los bots aliados: qué nodo atender. */
  _tickAssignments(world, dt) {
    this.assignTimer -= dt;
    if (this.assignTimer > 0) return;
    this.assignTimer = 2;

    for (const team of this.teams) {
      const members = world.bots.filter((s) => s.alive && s.team === team.id);
      if (!members.length) continue;

      // Prioridad: la marca del jugador (solo para su equipo), luego nodos
      // neutrales o rivales, y por último defender los propios.
      const priorities = this.nodes.slice().sort((a, b) => {
        const score = (n) => {
          let v = 0;
          if (n.owner === null) v += 3;
          else if (n.owner !== team.id) v += 2;
          else v += 1;
          if (n.contested) v += 2;
          if (n.id === 0) v += 1;                       // el central vale más
          if (team.id === this.playerTeam && this.ping && this.pingTimer > 0
              && this.ping.id === n.id) v += 6;
          return v;
        };
        return score(b) - score(a);
      });

      members.forEach((bot, i) => {
        if (!bot.brain) return;
        const target = priorities[i % Math.min(3, priorities.length)];
        bot.brain.setAssignment({ x: target.x, y: target.y });
      });
    }
  },

  /** Lo llama main.js con el clic derecho del jugador. */
  markPing(world, x, y) {
    let best = null, bestD = Infinity;
    for (const n of this.nodes) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) { bestD = d; best = n; }
    }
    if (!best) return null;
    this.ping = best;
    this.pingTimer = 12;
    this.assignTimer = 0;
    return best;
  },

  onEat(world, snake, orb) {
    // Los orbes del propio equipo valen doble: defender tu nodo tiene premio.
    if (orb.kind === ORB_KIND.TEAM && orb.team === snake.team) return orb.value * 2;
    return orb.value;
  },

  onKill(world, victim, killer) {
    if (killer && killer.team !== null && killer.team !== victim.team) {
      this.teams[killer.team].score += 15;
    }
    this.respawnQueue.push({ snake: victim, t: RESPAWN_TIME });
  },

  isSpawnValid() { return true; },

  isOver() {
    return this.teams.some((t) => t.score >= TARGET_SCORE);
  },

  results(world) {
    const sorted = this.teams.slice().sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const mine = this.teams[this.playerTeam];
    const won = winner.id === this.playerTeam;
    const p = world.player;

    return {
      title: won ? `¡Gana ${winner.name}!` : `Gana ${winner.name}`,
      cause: won ? 'Tu equipo controló el mapa' : `Tu equipo (${mine.name}) quedó con ${Math.round(mine.score)} puntos`,
      victory: won,
      stats: [
        { label: 'Tu equipo', value: Math.round(mine.score) },
        { label: 'Longitud', value: Math.round(p.peakMass) },
        { label: 'Eliminaciones', value: p.kills },
        { label: 'Tiempo', value: formatTime(world.time) },
      ],
      score: Math.round(mine.score) + p.kills * 20,
      metric: 'dominationWins',
      won,
    };
  },

  hud(world) {
    return {
      primary: { label: 'Tu equipo', value: Math.round(this.teams[this.playerTeam].score) },
      secondary: { label: 'Nodos', value: `${this.teams[this.playerTeam].nodes}/5` },
      teams: this.teams.map((t) => ({
        name: t.name, color: t.color, shape: t.shape,
        score: Math.round(t.score), nodes: t.nodes,
        pct: clamp(t.score / TARGET_SCORE, 0, 1) * 100,
        isPlayer: t.id === this.playerTeam,
      })),
      hint: 'Clic derecho sobre un nodo para pedir apoyo',
    };
  },

  leaderboard(world) {
    return world.snakes
      .filter((s) => s.alive)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 8)
      .map((s) => ({
        name: s.name, value: s.length, isPlayer: s.isPlayer,
        team: s.team, color: this.teams[s.team]?.color ?? s.skin.head,
      }));
  },

  drawUnder(ctx, world, theme, time, view) {
    for (const node of this.nodes) {
      const owner = node.owner !== null ? this.teams[node.owner] : null;
      const color = owner ? owner.color : '#8fa3b8';
      const pinged = this.ping === node && this.pingTimer > 0;

      ctx.save();

      // Disco
      ctx.globalAlpha = 0.10 + (owner ? 0.09 : 0);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.fill();

      // Anillo con la forma del equipo marcada en el centro
      ctx.globalAlpha = node.contested ? 0.55 + Math.sin(time * 9) * 0.3 : 0.75;
      ctx.strokeStyle = color;
      ctx.lineWidth = node.contested ? 4 : 2.5;
      ctx.setLineDash(node.owner === null ? [12, 10] : []);
      ctx.lineDashOffset = -time * 24;
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Arco de progreso
      if (node.progress > 0) {
        const capColor = node.capturing !== null ? this.teams[node.capturing].color : color;
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = capColor;
        ctx.lineWidth = 6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r - 8, -Math.PI / 2,
          -Math.PI / 2 + (node.progress / 100) * Math.PI * 2);
        ctx.stroke();
      }

      // Símbolo del dueño: distingue equipos sin depender del color
      ctx.globalAlpha = 0.5;
      drawTeamShape(ctx, owner ? owner.shape : 'diamond', node.x, node.y, 15, color);

      if (pinged) {
        const r = node.r + 18 + Math.sin(time * 6) * 6;
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.restore();
    }
  },

  drawMinimap(ctx, world, mm, theme) {
    for (const node of this.nodes) {
      const owner = node.owner !== null ? this.teams[node.owner] : null;
      ctx.save();
      ctx.globalAlpha = 0.9;
      drawTeamShape(ctx, owner ? owner.shape : 'diamond',
        mm.x + node.x * mm.sx, mm.y + node.y * mm.sy, 4.5,
        owner ? owner.color : 'rgba(200,215,230,0.6)');
      ctx.restore();
    }
  },
});

function drawTeamShape(ctx, shape, x, y, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (shape) {
    case 'square': ctx.rect(x - r * 0.8, y - r * 0.8, r * 1.6, r * 1.6); break;
    case 'triangle':
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.9, y + r * 0.7);
      ctx.lineTo(x - r * 0.9, y + r * 0.7);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r); ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r); ctx.lineTo(x - r, y);
      ctx.closePath();
      break;
    default: ctx.arc(x, y, r * 0.85, 0, Math.PI * 2);
  }
  ctx.fill();
}

export { TEAMS };
