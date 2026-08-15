/**
 * director.js — Presión dinámica de la partida.
 *
 * Observa cómo le va al jugador y ajusta la agresividad del mundo, con topes
 * conservadores para que no se note. El objetivo es que las partidas no se
 * aplanen: ni un dominio aburrido cuando eres enorme, ni una paliza cuando
 * acabas de reaparecer.
 *
 * Lo que NUNCA hace: dar más velocidad a los bots, abaratarles el turbo o darles
 * información que no podrían percibir. Solo reorienta intenciones.
 */

import { clamp } from '../engine/math.js';

export class Director {
  constructor(world) {
    this.world = world;
    this.enabled = true;
    this.timer = 0;
    this.dominanceTime = 0;
    this.strugglingTime = 0;
    this.hunterId = null;
    this.hunterTime = 0;
  }

  update(dt) {
    if (!this.enabled) return;
    const w = this.world;
    const p = w.player;
    if (!p || !p.alive) { this.dominanceTime = 0; this._clearHunter(); return; }

    this.timer -= dt;

    // ── Medir la situación ──
    let bigger = 0, total = 0, maxOther = 0;
    for (const s of w.snakes) {
      if (!s.alive || s === p) continue;
      total++;
      if (s.mass > p.mass) bigger++;
      if (s.mass > maxOther) maxOther = s.mass;
    }
    if (total === 0) return;

    const dominating = bigger === 0 && p.mass > maxOther * 1.6 && p.mass > 160;
    const struggling = p.mass < 40 && bigger > total * 0.6;

    this.dominanceTime  = dominating ? this.dominanceTime + dt  : Math.max(0, this.dominanceTime - dt * 2);
    this.strugglingTime = struggling ? this.strugglingTime + dt : Math.max(0, this.strugglingTime - dt * 2);

    if (this.timer > 0) { this._tickHunter(dt); return; }
    this.timer = 1.5;

    // ── Dominas demasiado: alguien empieza a buscarte ──
    if (this.dominanceTime > 12 && !this.hunterId) this._assignHunter(p);

    // ── Lo estás pasando mal: los grandes miran a otro lado un rato ──
    if (this.strugglingTime > 6) {
      for (const s of w.bots) {
        if (!s.alive || !s.brain) continue;
        if (s.mass < p.mass * 2) continue;
        const d = Math.hypot(s.head.x - p.head.x, s.head.y - p.head.y);
        if (d < 620) {
          // No los teletransporta ni los frena: solo les da un objetivo lejos.
          s.brain.memory.wanderTarget = {
            x: clamp(p.head.x + (s.head.x - p.head.x) * 3, 300, w.bounds.w - 300),
            y: clamp(p.head.y + (s.head.y - p.head.y) * 3, 300, w.bounds.h - 300),
          };
          s.brain.memory.wanderTime = 5;
        }
      }
      this.strugglingTime = 0;
    }

    this._tickHunter(dt);
  }

  /** Asciende a un bot capaz a "cazador": le fija el objetivo, nada más. */
  _assignHunter(player) {
    const w = this.world;
    let best = null, bestScore = -Infinity;
    for (const s of w.bots) {
      if (!s.alive || !s.brain) continue;
      if (s.mass < player.mass * 0.35) continue;
      const d = Math.hypot(s.head.x - player.head.x, s.head.y - player.head.y);
      const score = s.brain.traits.habilidad * 2 + s.mass / 400 - d / 2500;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) return;
    this.hunterId = best.id;
    this.hunterTime = 26;
    best.brain.traits.agresividad = Math.min(0.98, best.brain.traits.agresividad + 0.25);
    best.isHunter = true;
  }

  _tickHunter(dt) {
    if (!this.hunterId) return;
    const w = this.world;
    const hunter = w.snakes.find((s) => s.id === this.hunterId);
    const p = w.player;

    this.hunterTime -= dt;
    if (!hunter || !hunter.alive || !p || !p.alive || this.hunterTime <= 0) {
      this._clearHunter();
      return;
    }
    // Solo le decimos dónde mirar. El resto de su cerebro sigue mandando: si ve
    // peligro, huirá igual, y si el jugador se le escapa, lo perderá.
    hunter.brain.setAssignment({ x: p.head.x, y: p.head.y });
  }

  _clearHunter() {
    if (!this.hunterId) return;
    const hunter = this.world.snakes.find((s) => s.id === this.hunterId);
    if (hunter?.brain) {
      hunter.brain.setAssignment(null);
      hunter.isHunter = false;
    }
    this.hunterId = null;
    this.dominanceTime = 0;
  }
}
