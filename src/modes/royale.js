/**
 * royale.js — «Cerco». Battle royale con zona que se contrae.
 *
 * Da a cada partida un arco: recolectar tranquilo, negociar el espacio y una
 * pelea final claustrofóbica. Sin reaparición: morir es quedar eliminado, con tu
 * puesto final en pantalla.
 *
 * Lo importante de la implementación es que la zona no es solo un círculo
 * dibujado: se expone a los bots a través de dangerField() e isLethalPoint(), de
 * modo que la leen con su percepción normal, la evitan y la usan para acorralar.
 */

import { defineMode, populate, uniqueName, formatTime } from './Mode.js';
import { BOT_NAMES, orbsForWorld } from '../config.js';
import { botSkin } from '../themes/index.js';
import { EV } from '../engine/events.js';
import { Pickup } from '../entities/Pickup.js';
import { Perception } from '../ai/perception.js';
import { rgba, clamp } from '../engine/math.js';
import { describeCause } from './classic.js';

// Radios reescalados al mundo nuevo: el primer cierre tiene que ser un recorte
// notable del área inicial, no un salto absurdo desde el borde del mapa.
const PHASES = [
  { wait: 45, close: 34, radius: 4600 },
  { wait: 34, close: 30, radius: 3100 },
  { wait: 30, close: 26, radius: 2000 },
  { wait: 26, close: 24, radius: 1200 },
  { wait: 22, close: 20, radius: 700 },
  { wait: 18, close: 18, radius: 380 },
];

const DAMAGE_INTERVAL = 0.4;   // s entre mordiscos fuera de la zona
const DAMAGE_AMOUNT = 1.6;     // masa por mordisco

export default defineMode({
  id: 'royale',
  name: 'Cerco',
  short: '30 serpientes, una zona que se cierra. Sin segundas oportunidades.',
  duration: null,
  friendlyFire: true,
  orbHues: [155, 190, 45, 20],

  setup(world) {
    const W = 13000, H = 13000;
    world.setWorldSize(W, H);
    world.orbTarget = orbsForWorld(W, H, 0.85);

    const theme = world.settings.themeObj;
    const difficulty = world.settings.difficultyValue;

    // La zona se crea ANTES de cualquier aparición: `isSpawnValid` la consulta,
    // y el mundo llama a ese método ya durante spawnPlayer.
    const startRadius = Math.hypot(world.bounds.w, world.bounds.h) / 2;
    this.zone = {
      x: world.bounds.w / 2,
      y: world.bounds.h / 2,
      radius: startRadius,
      targetRadius: startRadius,
      targetX: world.bounds.w / 2,
      targetY: world.bounds.h / 2,
      startRadius: 0, startX: 0, startY: 0,
    };

    world.spawnPlayer(world.playerConfig.skin, world.playerConfig.name);
    populate(world, {
      count: 39,
      difficulty,
      massRange: [14, 45],
      skinFor: (i) => botSkin(i, theme),
      nameFor: (i) => uniqueName(world, BOT_NAMES, i),
    });
    world.fillOrbs(world.orbTarget);

    this.phase = 0;
    this.timer = PHASES[0].wait;
    this.closing = false;
    this.damageTimers = new Map();
    this.crateTimer = 22;
    this.eliminated = [];
    this.startCount = world.snakes.length;
    this.playerPlace = null;
    this.spectating = null;
  },

  tick(world, dt) {
    this._tickZone(world, dt);
    this._tickDamage(world, dt);
    this._tickCrates(world, dt);
  },

  _tickZone(world, dt) {
    const z = this.zone;
    this.timer -= dt;

    if (!this.closing) {
      if (this.timer <= 0 && this.phase < PHASES.length) {
        const p = PHASES[this.phase];
        this.closing = true;
        this.timer = p.close;

        // El centro nuevo se elige dentro del círculo actual, para que la zona
        // nunca deje a nadie fuera sin aviso ni se salga del mundo.
        const maxDrift = Math.max(0, z.radius - p.radius) * 0.55;
        const a = world.rng.range(0, Math.PI * 2);
        const d = world.rng.range(0, maxDrift);
        z.startRadius = z.radius;
        z.startX = z.x; z.startY = z.y;
        z.targetRadius = p.radius;
        z.targetX = clamp(z.x + Math.cos(a) * d, p.radius, world.bounds.w - p.radius);
        z.targetY = clamp(z.y + Math.sin(a) * d, p.radius, world.bounds.h - p.radius);

        world.events.emit(EV.ZONE_PHASE, { phase: this.phase + 1, closing: true });
      }
    } else {
      const p = PHASES[this.phase];
      const t = 1 - clamp(this.timer / p.close, 0, 1);
      const e = t * t * (3 - 2 * t);          // suavizado: la zona no da tirones
      z.radius = z.startRadius + (z.targetRadius - z.startRadius) * e;
      z.x = z.startX + (z.targetX - z.startX) * e;
      z.y = z.startY + (z.targetY - z.startY) * e;

      if (this.timer <= 0) {
        this.closing = false;
        this.phase++;
        z.radius = z.targetRadius;
        z.x = z.targetX; z.y = z.targetY;
        this.timer = this.phase < PHASES.length ? PHASES[this.phase].wait : Infinity;
        world.events.emit(EV.ZONE_PHASE, { phase: this.phase, closing: false });
      }
    }
  },

  _tickDamage(world, dt) {
    const z = this.zone;
    for (const s of world.snakes) {
      if (!s.alive) continue;
      const d = Math.hypot(s.head.x - z.x, s.head.y - z.y);
      if (d <= z.radius) { this.damageTimers.delete(s.id); continue; }

      let t = (this.damageTimers.get(s.id) ?? 0) - dt;
      if (t <= 0) {
        t = DAMAGE_INTERVAL;
        s.shrink(DAMAGE_AMOUNT);
        if (s.isPlayer) world.fxRef?.pulseVignette(0.5, '#ff5b3a');
        if (s.mass <= 2) world.kill(s, null, 'zone');
      }
      this.damageTimers.set(s.id, t);
    }
  },

  _tickCrates(world, dt) {
    this.crateTimer -= dt;
    if (this.crateTimer > 0) return;
    this.crateTimer = world.rng.range(18, 30);
    if (world.pickups.length > 4) return;

    const z = this.zone;
    const a = world.rng.range(0, Math.PI * 2);
    const r = world.rng.range(0, z.radius * 0.8);
    const x = z.x + Math.cos(a) * r;
    const y = z.y + Math.sin(a) * r;
    world.pickups.push(new Pickup(x, y, null, world.rng));
    // Un suministro trae también comida: el punto tiene que merecer el viaje.
    for (let i = 0; i < 14; i++) {
      world.orbs.spawn(
        x + world.rng.range(-70, 70),
        y + world.rng.range(-70, 70),
        { r: 7.5, hue: 45 },
      );
    }
  },

  // ── Cómo ven los bots la zona ───────────────────────────────

  isLethalPoint(world, x, y) {
    const z = this.zone;
    // Margen: un bot no debería rozar el borde de la zona ni por accidente.
    return Math.hypot(x - z.x, y - z.y) > z.radius - 30;
  },

  dangerField(world, bot, perception, rays) {
    const z = this.zone;
    const dx = bot.head.x - z.x;
    const dy = bot.head.y - z.y;
    const d = Math.hypot(dx, dy);
    const margin = z.radius - d;

    // Fuera o a punto de salir: huir hacia el centro es lo único que importa.
    if (margin < 320) {
      const toCenter = Math.atan2(-dy, -dx);
      const weight = margin < 0 ? 9 : (1 - margin / 320) * 5.5;
      // Encarece todo lo que apunte hacia fuera.
      const outward = toCenter + Math.PI;
      perception._spread(rays, outward, Math.PI / 2.2, weight);
      perception.wallPressure = Math.max(perception.wallPressure, clamp(1 - margin / 320, 0, 1));
    }
  },

  isSpawnValid(world, pos) {
    const z = this.zone;
    return Math.hypot(pos.x - z.x, pos.y - z.y) < z.radius * 0.85;
  },

  orbSpawnPoint(world) {
    const z = this.zone;
    const a = world.rng.range(0, Math.PI * 2);
    const r = Math.sqrt(world.rng()) * z.radius * 0.95;
    return { x: z.x + Math.cos(a) * r, y: z.y + Math.sin(a) * r };
  },

  // ── Reglas ──────────────────────────────────────────────────

  onKill(world, victim, killer) {
    const remaining = world.snakes.filter((s) => s.alive).length;
    this.eliminated.push({ name: victim.name, place: remaining + 1 });
    if (victim.isPlayer) {
      this.playerPlace = remaining + 1;
      // Espectar al líder en lugar de expulsar al menú.
      this.spectating = world.snakes
        .filter((s) => s.alive)
        .sort((a, b) => b.mass - a.mass)[0] ?? null;
    }
  },

  isOver(world) {
    const alive = world.snakes.filter((s) => s.alive);
    if (alive.length <= 1) return true;
    // Si el jugador ha muerto, se le dan unos segundos de espectador y se cierra.
    if (this.playerPlace !== null) {
      this.postDeath = (this.postDeath ?? 0) + 1 / 60;
      return this.postDeath > 6;
    }
    return false;
  },

  results(world) {
    const p = world.player;
    const alive = world.snakes.filter((s) => s.alive);
    const won = p && p.alive && alive.length === 1;

    let place;
    if (won) {
      place = 1;
    } else if (this.playerPlace !== null) {
      place = this.playerPlace;          // murió: el puesto se fijó al eliminarlo
    } else {
      // Sigue viva pero la partida acabó por otra vía: se ordena por tamaño.
      const ranked = alive.slice().sort((a, b) => b.mass - a.mass);
      const idx = ranked.findIndex((s) => s.isPlayer);
      place = idx === -1 ? alive.length + 1 : idx + 1;
    }

    return {
      title: won ? '¡Última en pie!' : `Puesto #${place}`,
      cause: won ? `Sobreviviste a ${this.startCount - 1} rivales` : describeCause(p),
      victory: won,
      stats: [
        { label: 'Puesto', value: `#${place} de ${this.startCount}` },
        { label: 'Longitud', value: Math.round(p.peakMass) },
        { label: 'Eliminaciones', value: p.kills },
        { label: 'Tiempo', value: formatTime(world.time) },
      ],
      score: (this.startCount - place + 1) * 100 + p.kills * 50,
      metric: 'royalePlace',
      place,
    };
  },

  hud(world) {
    const alive = world.snakes.filter((s) => s.alive).length;
    return {
      primary: { label: 'Vivas', value: alive, alert: alive <= 5 },
      secondary: {
        label: this.closing ? 'Cerrando' : 'Cierre en',
        value: this.timer === Infinity ? '—' : formatTime(this.timer),
        alert: this.closing,
      },
      zonePhase: `Fase ${Math.min(this.phase + 1, PHASES.length)}/${PHASES.length}`,
      spectating: this.spectating && !world.player.alive ? this.spectating.name : null,
    };
  },

  cameraTarget(world) {
    // Tras morir, la cámara sigue al líder en lugar de quedarse congelada.
    if (world.player?.alive) return world.player;
    if (this.spectating && this.spectating.alive) return this.spectating;
    return world.snakes.find((s) => s.alive) ?? null;
  },

  leaderboard(world) {
    return world.snakes
      .filter((s) => s.alive)
      .sort((a, b) => b.mass - a.mass)
      .slice(0, 8)
      .map((s) => ({ name: s.name, value: s.length, isPlayer: s.isPlayer, color: s.skin.head }));
  },

  // ── Dibujo ──────────────────────────────────────────────────

  drawOver(ctx, world, theme, time, view) {
    const z = this.zone;
    const pulse = 0.55 + Math.sin(time * 3) * 0.2;
    const color = this.closing ? '#ff5b3a' : '#ff8a4a';

    // Tinte de todo lo que queda fuera de la zona.
    ctx.save();
    ctx.beginPath();
    ctx.rect(view.minX, view.minY, view.maxX - view.minX, view.maxY - view.minY);
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2, true);
    ctx.fillStyle = rgba(color, 0.13);
    ctx.fill('evenodd');
    ctx.restore();

    // Muro
    ctx.save();
    ctx.strokeStyle = rgba(color, 0.9 * pulse);
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = rgba(color, 0.16 * pulse);
    ctx.lineWidth = 40;
    ctx.stroke();

    // Círculo objetivo mientras se cierra: hay que poder anticipar dónde correr.
    if (this.closing) {
      ctx.setLineDash([16, 14]);
      ctx.lineDashOffset = -time * 30;
      ctx.strokeStyle = rgba('#ffffff', 0.4);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(z.targetX, z.targetY, z.targetRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  drawMinimap(ctx, world, mm, theme) {
    const z = this.zone;
    ctx.save();
    ctx.strokeStyle = rgba(this.closing ? '#ff5b3a' : '#ff8a4a', 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mm.x + z.x * mm.sx, mm.y + z.y * mm.sy, z.radius * mm.sx, 0, Math.PI * 2);
    ctx.stroke();
    if (this.closing) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = rgba('#ffffff', 0.5);
      ctx.beginPath();
      ctx.arc(mm.x + z.targetX * mm.sx, mm.y + z.targetY * mm.sy, z.targetRadius * mm.sx, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
});
