/**
 * frenzy.js — «Frenesí». Tres minutos por la máxima puntuación.
 *
 * Morir no te elimina: pierdes la mitad del marcador y vuelves en tres segundos.
 * Es deliberado: el modo vive del ritmo, y expulsarte al menú a los cuarenta
 * segundos lo mataría. También es la base del desafío diario.
 */

import { defineMode, populate, uniqueName, formatTime } from './Mode.js';
import { BOT_NAMES, orbsForWorld } from '../config.js';
import { botSkin } from '../themes/index.js';
import { EV } from '../engine/events.js';
import { rgba, clamp } from '../engine/math.js';

const DURATION = 180;
const STREAK_WINDOW = 1.2;     // s para encadenar
const STREAK_GRACE = 2.0;      // s antes de perderla
const TIERS = [
  { eats: 0,  mult: 1 },
  { eats: 8,  mult: 2 },
  { eats: 20, mult: 3 },
  { eats: 38, mult: 5 },
];

export default defineMode({
  id: 'frenzy',
  name: 'Frenesí',
  short: 'Tres minutos, multiplicadores de racha y zonas de bonificación.',
  duration: DURATION,
  friendlyFire: true,
  orbHues: [45, 20, 320, 175],

  setup(world) {
    const W = 6000, H = 6000;
    world.setWorldSize(W, H);
    world.orbTarget = orbsForWorld(W, H, 2);   // densidad doble: va de comer sin parar

    const theme = world.settings.themeObj;
    const difficulty = world.settings.difficultyValue;

    world.spawnPlayer(world.playerConfig.skin, world.playerConfig.name);
    populate(world, {
      count: 18,
      difficulty,
      massRange: [20, 90],
      skinFor: (i) => botSkin(i, theme),
      nameFor: (i) => uniqueName(world, BOT_NAMES, i),
    });
    world.fillOrbs(world.orbTarget);

    this.remaining = DURATION;
    this.score = 0;
    this.streakEats = 0;
    this.streakTimer = 0;
    this.mult = 1;
    this.bestMult = 1;
    this.multTime = { 2: 0, 3: 0, 5: 0 };
    this.bonusZone = null;
    this.bonusTimer = 12;
    this.respawnQueue = [];
    this.deaths = 0;
    this.noBoostEats = 0;      // para los objetivos del desafío diario
    this.usedBoost = false;
  },

  tick(world, dt) {
    this.remaining -= dt;
    this._tickStreak(world, dt);
    this._tickBonusZone(world, dt);

    for (let i = this.respawnQueue.length - 1; i >= 0; i--) {
      const e = this.respawnQueue[i];
      e.t -= dt;
      if (e.t <= 0) {
        this.respawnQueue.splice(i, 1);
        world.respawn(e.snake, { massKeep: e.snake.isPlayer ? 0 : 0 });
      }
    }

    if (world.player?.boosting) this.usedBoost = true;
    if (this.mult > 1) this.multTime[this.mult] = (this.multTime[this.mult] ?? 0) + dt;
  },

  _tickStreak(world, dt) {
    if (this.streakTimer <= 0) return;
    this.streakTimer -= dt;
    if (this.streakTimer > 0) return;

    // Racha perdida
    if (this.mult > 1) world.fxRef?.floatText(
      world.player.head.x, world.player.head.y, 'racha perdida', '#8fa3b8', 1, 14,
    );
    this.streakEats = 0;
    this.mult = 1;
  },

  _tickBonusZone(world, dt) {
    if (this.bonusZone) {
      this.bonusZone.life -= dt;
      if (this.bonusZone.life <= 0) this.bonusZone = null;
      return;
    }
    this.bonusTimer -= dt;
    if (this.bonusTimer > 0) return;
    this.bonusTimer = world.rng.range(22, 34);

    const margin = 800;
    this.bonusZone = {
      x: world.rng.range(margin, world.bounds.w - margin),
      y: world.rng.range(margin, world.bounds.h - margin),
      r: 620,
      life: 20,
      maxLife: 20,
    };
    // La zona trae comida: tiene que merecer el viaje.
    for (let i = 0; i < 140; i++) {
      const a = world.rng.range(0, Math.PI * 2);
      const rr = Math.sqrt(world.rng()) * this.bonusZone.r;
      world.orbs.spawn(
        this.bonusZone.x + Math.cos(a) * rr,
        this.bonusZone.y + Math.sin(a) * rr,
        { r: 6.5, hue: 45 },
      );
    }
  },

  _inBonus(x, y) {
    const z = this.bonusZone;
    return !!z && Math.hypot(x - z.x, y - z.y) < z.r;
  },

  onEat(world, snake, orb) {
    let value = orb.value;
    if (this._inBonus(orb.x, orb.y)) value *= 2;
    if (!snake.isPlayer) return value;

    // Racha: encadenar bocados sube el multiplicador del marcador.
    const chained = this.streakTimer > STREAK_GRACE - STREAK_WINDOW;
    this.streakEats = chained ? this.streakEats + 1 : 1;
    this.streakTimer = STREAK_GRACE;

    let tier = 1;
    for (const t of TIERS) if (this.streakEats >= t.eats) tier = t.mult;

    if (tier > this.mult) {
      this.mult = tier;
      this.bestMult = Math.max(this.bestMult, tier);
      world.events.emit(EV.STREAK, { x: snake.head.x, y: snake.head.y, mult: tier });
    }

    this.score += value * this.mult;
    if (!this.usedBoost) this.noBoostEats++;
    return value;
  },

  onKill(world, victim, killer) {
    if (killer?.isPlayer) this.score += 60;

    if (victim.isPlayer) {
      this.deaths++;
      this.score = Math.round(this.score * 0.5);   // muerte cuesta la mitad, no todo
      this.streakEats = 0;
      this.mult = 1;
      this.streakTimer = 0;
      this.respawnQueue.push({ snake: victim, t: 3 });
    } else {
      this.respawnQueue.push({ snake: victim, t: 2.5 });
    }
  },

  isOver() {
    return this.remaining <= 0;
  },

  results(world) {
    const p = world.player;
    return {
      title: 'Se acabó el tiempo',
      cause: `Multiplicador máximo ×${this.bestMult}`,
      stats: [
        { label: 'Puntos', value: Math.round(this.score) },
        { label: 'Mejor ×', value: `×${this.bestMult}` },
        { label: 'Orbes', value: p.eaten },
        { label: 'Muertes', value: this.deaths },
      ],
      score: Math.round(this.score),
      metric: 'frenzyScore',
      // Datos que consume el desafío diario para evaluar objetivos.
      challengeData: {
        score: Math.round(this.score),
        kills: p.kills,
        eaten: p.eaten,
        noBoostEats: this.noBoostEats,
        bestMult: this.bestMult,
        multTime5: this.multTime[5] ?? 0,
        deaths: this.deaths,
        peakMass: Math.round(p.peakMass),
      },
    };
  },

  hud(world) {
    return {
      primary: { label: 'Puntos', value: Math.round(this.score) },
      secondary: { label: 'Tiempo', value: formatTime(this.remaining), alert: this.remaining < 30 },
      mult: this.mult,
      streakPct: clamp(this.streakTimer / STREAK_GRACE, 0, 1) * 100,
      bonusActive: this.bonusZone !== null,
    };
  },

  orbSpawnPoint(world) {
    // Sesgo hacia la zona de bonificación mientras esté activa.
    if (this.bonusZone && world.rng.chance(0.35)) {
      const a = world.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(world.rng()) * this.bonusZone.r;
      return { x: this.bonusZone.x + Math.cos(a) * r, y: this.bonusZone.y + Math.sin(a) * r };
    }
    return {
      x: world.rng.range(40, world.bounds.w - 40),
      y: world.rng.range(40, world.bounds.h - 40),
    };
  },

  drawUnder(ctx, world, theme, time) {
    const z = this.bonusZone;
    if (!z) return;
    const fade = clamp(z.life / 3, 0, 1);
    const pulse = 0.6 + Math.sin(time * 3.4) * 0.25;

    ctx.save();
    ctx.globalAlpha = 0.14 * fade;
    ctx.fillStyle = '#ffd15c';
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = fade;
    ctx.strokeStyle = rgba('#ffd15c', 0.85 * pulse);
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 12]);
    ctx.lineDashOffset = -time * 40;
    ctx.beginPath();
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.setLineDash([]);
    ctx.globalAlpha = fade * 0.85;
    ctx.fillStyle = '#ffd15c';
    ctx.font = '700 22px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('×2', z.x, z.y + 8);
    ctx.restore();
  },

  /** Anillos concéntricos alrededor de la cabeza según el multiplicador. */
  drawOver(ctx, world, theme, time) {
    const p = world.player;
    if (!p || !p.alive || this.mult <= 1) return;
    const rings = this.mult === 5 ? 3 : this.mult === 3 ? 2 : 1;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < rings; i++) {
      const r = p.radius + 14 + i * 9 + Math.sin(time * 5 - i) * 3;
      ctx.strokeStyle = rgba('#ffd15c', 0.5 - i * 0.12);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.head.x, p.head.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },

  drawMinimap(ctx, world, mm) {
    const z = this.bonusZone;
    if (!z) return;
    ctx.save();
    ctx.strokeStyle = rgba('#ffd15c', 0.8);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(mm.x + z.x * mm.sx, mm.y + z.y * mm.sy, z.r * mm.sx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
});

export { DURATION as FRENZY_DURATION };
