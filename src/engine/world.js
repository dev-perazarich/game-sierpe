/**
 * world.js — Estado autoritativo del juego.
 *
 * Regla de oro: aquí vive la verdad, y el renderizador solo la lee. Nada de
 * `render/` muta una entidad. Es lo que deja la puerta abierta a sustituir este
 * World local por snapshots de un servidor sin reescribir la capa visual.
 */

import { CFG, STEP, radiusForMass } from '../config.js';
import { SpatialHash } from './spatial.js';
import { EventBus, EV } from './events.js';
import { Snake, randomSpawn } from '../entities/Snake.js';
import { OrbPool, ORB_KIND, scatterFromSnake } from '../entities/Orb.js';
import { Pickup, applyPower, expirePower } from '../entities/Pickup.js';
import { resolveCollisions, insertSnake, resetNodePool, CAUSE } from './collision.js';
import { BotBrain } from '../ai/BotBrain.js';
import { Director } from '../ai/director.js';
import { makeRng } from './rng.js';
import { clamp, dist } from './math.js';

export class World {
  constructor({ mode, seed, playerConfig, settings }) {
    this.mode = mode;
    this.rng = makeRng(seed);
    this.events = new EventBus();
    this.settings = settings;

    this.bounds = { w: CFG.world.w, h: CFG.world.h };
    this.time = 0;
    this.over = false;
    this.results = null;

    this.snakes = [];
    this.bots = [];
    this.player = null;
    this.orbs = new OrbPool(14000, this.rng);
    this.pickups = [];
    this.activePowers = [];

    this.bodyHash = new SpatialHash(64);
    this.orbHash = new SpatialHash(110);

    this.orbTarget = CFG.orb.count;
    this.director = new Director(this);

    this.killFeed = [];
    this.leaderboard = [];
    this._lbTimer = 0;
    this._scratch = [];

    this.playerConfig = playerConfig;
    this.mode.setup(this);
  }

  // ─────────────────────────────────────────────────────────
  // Construcción
  // ─────────────────────────────────────────────────────────

  setWorldSize(w, h) {
    this.bounds.w = w;
    this.bounds.h = h;
  }

  spawnPlayer(skin, name) {
    const pos = this._safeSpawn();
    this.player = new Snake({ ...pos, skin, name, isPlayer: true });
    this.snakes.push(this.player);
    this.events.emit(EV.SPAWN, { snake: this.player });
    return this.player;
  }

  spawnBot({ skin, name, team = null, mass = null, kind = 'normal', difficulty = 0.5, traits = null }) {
    const pos = this._safeSpawn();
    const bot = new Snake({ ...pos, skin, name, team, mass, kind });
    bot.brain = new BotBrain(bot, this, { difficulty, traits });
    this.snakes.push(bot);
    this.bots.push(bot);
    this.events.emit(EV.SPAWN, { snake: bot });
    return bot;
  }

  /** Busca un punto libre para aparecer: nada peor que nacer dentro de alguien. */
  _safeSpawn(nearX = null, nearY = null, spread = 400) {
    for (let attempt = 0; attempt < 24; attempt++) {
      const pos = nearX !== null
        ? {
            x: clamp(nearX + this.rng.range(-spread, spread), 180, this.bounds.w - 180),
            y: clamp(nearY + this.rng.range(-spread, spread), 180, this.bounds.h - 180),
            angle: this.rng.range(0, Math.PI * 2),
          }
        : randomSpawn(this.rng, this.bounds, 300);

      if (this.mode.isSpawnValid && !this.mode.isSpawnValid(this, pos)) continue;

      let clear = true;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        if (dist(pos.x, pos.y, s.head.x, s.head.y) < 260) { clear = false; break; }
      }
      if (clear) return pos;
    }
    return randomSpawn(this.rng, this.bounds, 300);
  }

  fillOrbs(target = this.orbTarget) {
    this.orbTarget = target;
    // compact() deja `count` igual al número de orbes vivos, así que sirve como
    // recuento sin tener que recorrer el pool otra vez.
    this.orbs.compact();
    for (let i = this.orbs.count; i < target; i++) {
      this.orbs.spawn(
        this.rng.range(40, this.bounds.w - 40),
        this.rng.range(40, this.bounds.h - 40),
        { hue: this._orbHue() },
      );
    }
  }

  _orbHue() {
    const hues = this.mode.orbHues || [155, 190, 45, 300, 20, 265];
    return hues[this.rng.int(0, hues.length)] + this.rng.range(-12, 12);
  }

  // ─────────────────────────────────────────────────────────
  // Simulación
  // ─────────────────────────────────────────────────────────

  tick(dt) {
    if (this.over) return;
    this.time += dt;

    this._tickPowers(dt);
    this.mode.tick(this, dt);

    // ── Movimiento ──
    for (const s of this.snakes) {
      if (!s.alive) continue;
      if (s.brain) s.brain.think(dt);
      const drop = s.step(dt, this);
      if (drop) {
        this.orbs.spawn(drop.x, drop.y, {
          r: 4.4, kind: ORB_KIND.BOOST,
          value: CFG.snake.boostMassPerSec * CFG.snake.boostOrbEvery * 0.62,
          hue: s.skin.hue,
        });
        this.events.emit(EV.BOOST_DROP, { snake: s, x: drop.x, y: drop.y });
      }
    }

    // ── Índices espaciales ──
    this.bodyHash.clear();
    this.orbHash.clear();
    resetNodePool();
    for (const s of this.snakes) {
      if (s.alive) insertSnake(this.bodyHash, s);
    }
    this.orbs.forEach((o) => {
      o.update(dt);
      if (o.active) this.orbHash.insert(o.x, o.y, o);
    });

    // ── Comer ──
    for (const s of this.snakes) {
      if (s.alive) this._eat(s, dt);
    }

    // ── Bordes y reglas del modo ──
    for (const s of this.snakes) {
      if (!s.alive || s.invuln > 0) continue;
      const h = s.head;
      const r = s.radius;
      if (h.x < r || h.y < r || h.x > this.bounds.w - r || h.y > this.bounds.h - r) {
        this.kill(s, null, CAUSE.EDGE);
      }
    }

    // ── Colisiones, en una sola pasada ──
    const deaths = resolveCollisions(this.snakes, this.bodyHash, {
      friendlyFire: this.mode.friendlyFire === true,
    });
    for (const d of deaths) this.kill(d.victim, d.killer, d.cause);

    // ── Recogidas ──
    this._tickPickups(dt);

    // ── Mantenimiento ──
    this.orbs.compact();
    this._replenishOrbs();

    this._lbTimer -= dt;
    if (this._lbTimer <= 0) {
      this._lbTimer = 0.25;
      this._rebuildLeaderboard();
    }

    for (let i = this.killFeed.length - 1; i >= 0; i--) {
      this.killFeed[i].t -= dt;
      if (this.killFeed[i].t <= 0) this.killFeed.splice(i, 1);
    }

    this.director.update(dt);

    if (this.mode.isOver(this)) {
      this.over = true;
      this.results = this.mode.results(this);
      this.events.emit(EV.MODE_OVER, this.results);
    }
  }

  _eat(snake, dt) {
    const h = snake.head;
    const range = snake.radius + CFG.orb.magnetRange * snake.magnetMul;
    const found = this.orbHash.query(h.x, h.y, range, this._scratch);

    for (let i = 0; i < found.length; i++) {
      const orb = found[i];
      if (!orb.active) continue;
      if (orb.team !== null && orb.team !== snake.team && orb.kind === ORB_KIND.TEAM) continue;

      const d = dist(h.x, h.y, orb.x, orb.y);

      if (d < snake.radius + orb.r) {
        orb.active = false;
        if (orb.kind === ORB_KIND.POISON) {
          snake.shrink(orb.value * 2.4);
          this.events.emit(EV.EAT, { snake, orb, poison: true });
        } else {
          const gain = this.mode.onEat ? this.mode.onEat(this, snake, orb) : orb.value;
          snake.grow(gain);
          snake.eaten++;
          this.events.emit(EV.EAT, { snake, orb, value: gain });
        }
      } else if (!orb.attractTo && d < range) {
        orb.attractTo = snake;
      }
    }
  }

  _tickPickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.update(dt);
      let taken = null;
      for (const s of this.snakes) {
        if (!s.alive) continue;
        if (dist(s.head.x, s.head.y, p.x, p.y) < s.radius + p.r) { taken = s; break; }
      }
      if (taken) {
        const eff = applyPower(taken, p.power);
        if (eff) this.activePowers.push({ snake: taken, ...eff });
        this.pickups.splice(i, 1);
        this.events.emit(EV.PICKUP, { snake: taken, power: p.power, x: p.x, y: p.y });
      }
    }
  }

  _tickPowers(dt) {
    for (let i = this.activePowers.length - 1; i >= 0; i--) {
      const a = this.activePowers[i];
      a.remaining -= dt;
      if (a.remaining <= 0 || !a.snake.alive) {
        expirePower(a.snake, a.id);
        this.activePowers.splice(i, 1);
      }
    }
  }

  _replenishOrbs() {
    // Se llama justo después de compact(), así que `count` ya son los vivos.
    const deficit = this.orbTarget - this.orbs.count;
    if (deficit <= 0) return;
    // Como mucho unos pocos por paso: repoblar de golpe se nota como un parpadeo.
    const batch = Math.min(deficit, 6);
    for (let i = 0; i < batch; i++) {
      const p = this.mode.orbSpawnPoint
        ? this.mode.orbSpawnPoint(this)
        : { x: this.rng.range(40, this.bounds.w - 40), y: this.rng.range(40, this.bounds.h - 40) };
      if (p) this.orbs.spawn(p.x, p.y, { hue: this._orbHue(), team: p.team ?? null, kind: p.kind ?? ORB_KIND.NORMAL });
    }
  }

  // ─────────────────────────────────────────────────────────
  // Muerte
  // ─────────────────────────────────────────────────────────

  kill(snake, killer, cause) {
    if (!snake.alive) return;
    snake.alive = false;
    snake.deathCause = cause;
    snake.killerName = killer ? killer.name : null;

    scatterFromSnake(this.orbs, snake, snake.skin.hue);

    if (killer && killer !== snake && killer.alive) {
      killer.kills++;
      killer.grow(snake.mass * CFG.scoring.killMassShare);
      this.killFeed.unshift({ killer: killer.name, victim: snake.name, t: 4.5, isPlayer: killer.isPlayer });
      if (this.killFeed.length > 5) this.killFeed.pop();
      this.events.emit(EV.KILL, { killer, victim: snake, cause });
    }

    this.events.emit(EV.DEATH, { snake, killer, cause });
    this.mode.onKill?.(this, snake, killer, cause);
  }

  /** Reaparición gestionada por el modo. `massKeep` 0 = empezar de cero. */
  respawn(snake, { massKeep = 0, nearX = null, nearY = null } = {}) {
    const pos = this._safeSpawn(nearX, nearY);
    snake.respawn(pos.x, pos.y, pos.angle, massKeep);
    this.events.emit(EV.SPAWN, { snake });
  }

  removeSnake(snake) {
    snake.alive = false;
    snake.removed = true;
    const i = this.snakes.indexOf(snake);
    if (i !== -1) this.snakes.splice(i, 1);
    const j = this.bots.indexOf(snake);
    if (j !== -1) this.bots.splice(j, 1);
  }

  // ─────────────────────────────────────────────────────────
  // Consultas
  // ─────────────────────────────────────────────────────────

  aliveSnakes() {
    return this.snakes.filter((s) => s.alive);
  }

  _rebuildLeaderboard() {
    const rows = this.mode.leaderboard
      ? this.mode.leaderboard(this)
      : this.snakes
          .filter((s) => s.alive)
          .map((s) => ({ name: s.name, value: s.length, isPlayer: s.isPlayer, team: s.team, color: s.skin.body }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);
    this.leaderboard = rows;
  }

  /** Snapshot de solo lectura para el HUD reactivo de Vue. */
  snapshot() {
    const p = this.player;
    return {
      time: this.time,
      alive: p ? p.alive : false,
      length: p ? p.length : 0,
      kills: p ? p.kills : 0,
      mass: p ? p.mass : 0,
      boosting: p ? p.boosting : false,
      canBoost: p ? p.canBoost() : false,
      rank: this._playerRank(),
      total: this.snakes.length,
      leaderboard: this.leaderboard,
      killFeed: this.killFeed,
      powers: this.activePowers
        .filter((a) => a.snake === p)
        .map((a) => ({ id: a.id, icon: a.power.icon, name: a.power.name, remaining: a.remaining })),
      mode: this.mode.hud ? this.mode.hud(this) : null,
      over: this.over,
    };
  }

  _playerRank() {
    if (!this.player) return 0;
    let rank = 1;
    for (const s of this.snakes) {
      if (s.alive && s !== this.player && s.mass > this.player.mass) rank++;
    }
    return rank;
  }

  destroy() {
    this.events.clear();
    this.snakes.length = 0;
    this.bots.length = 0;
    this.orbs.clear();
    this.pickups.length = 0;
    this.activePowers.length = 0;
  }
}

export { CAUSE, ORB_KIND, EV, STEP };
