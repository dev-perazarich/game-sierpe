/**
 * HudOverlay.js — HUD modular por modo.
 *
 * El HUD anterior era fijo y mostraba siempre lo mismo (puntos, longitud, turbo),
 * incluso cuando lo relevante era otra cosa. Aquí cada modo declara qué widgets
 * necesita a través de `hud()`, y este componente los compone.
 */

import { Leaderboard } from './Leaderboard.js';

export const HudOverlay = {
  components: { Leaderboard },
  props: {
    snap: { type: Object, required: true },
    modeId: { type: String, required: true },
    settings: { type: Object, required: true },
    fps: { type: Number, default: 0 },
    compact: { type: Boolean, default: false },
  },
  emits: ['pause', 'card'],

  setup(props) {
    const m = Vue.computed(() => props.snap.mode ?? {});
    return { m };
  },

  template: `
    <div class="hud" :style="{ '--hud-scale': settings.hudScale }">

      <!--
        Disposición: el centro de la pantalla queda LIBRE. Es donde vive tu
        cabeza y donde miras el 100 % del tiempo, así que toda la información se
        reparte por las esquinas: estado del modo arriba a la izquierda, ranking
        arriba a la derecha, tu longitud abajo a la izquierda y el radar abajo a
        la derecha (lo pinta el canvas).
      -->
      <div class="hud__top">
        <div class="hud__stats">
          <button class="btn btn--icon" type="button" @click="$emit('pause')" aria-label="Pausa">
            ❚❚
          </button>
          <div class="stat-chip" v-if="m.primary" :class="{ 'is-alert': m.primary.alert }">
            <span class="stat-chip__label">{{ m.primary.label }}</span>
            <span class="stat-chip__value">{{ m.primary.value }}</span>
          </div>
          <div class="stat-chip" v-if="m.secondary" :class="{ 'is-alert': m.secondary.alert }">
            <span class="stat-chip__label">{{ m.secondary.label }}</span>
            <span class="stat-chip__value">{{ m.secondary.value }}</span>
          </div>
          <span v-if="settings.showFps" class="fps">{{ fps }} fps</span>
        </div>
      </div>

      <!-- Abajo a la izquierda: tu estado personal -->
      <div class="hud__own">
        <p class="own__length">
          <span class="own__label">Tu longitud</span>
          <b>{{ snap.length }}</b>
        </p>
        <p class="own__rank">
          Puesto <b>{{ snap.rank }}</b> de {{ snap.total }}
          <span v-if="snap.kills > 0" class="own__kills">· {{ snap.kills }} bajas</span>
        </p>
      </div>

      <!-- Marcadores de equipo (Dominio) -->
      <div class="teams" v-if="m.teams">
        <div v-for="t in m.teams" :key="t.name" class="teams__row" :class="{ 'is-mine': t.isPlayer }">
          <span class="teams__shape" :data-shape="t.shape" :style="{ background: t.color }" aria-hidden="true"></span>
          <span class="teams__name">{{ t.name }}</span>
          <span class="teams__bar"><i :style="{ width: t.pct + '%', background: t.color }"></i></span>
          <span class="teams__score">{{ t.score }}</span>
          <span class="teams__nodes">{{ t.nodes }}⬢</span>
        </div>
        <p class="teams__hint" v-if="m.hint">{{ m.hint }}</p>
      </div>

      <!-- Multiplicador de racha (Frenesí) -->
      <div class="streak" v-if="m.mult && m.mult > 1">
        <span class="streak__mult">×{{ m.mult }}</span>
        <span class="streak__bar"><i :style="{ width: m.streakPct + '%' }"></i></span>
      </div>

      <!-- Objetivos del desafío diario -->
      <ul class="objectives" v-if="m.objectives">
        <li v-for="o in m.objectives" :key="o.label" :class="{ 'is-done': o.done }">
          <span class="objectives__mark" aria-hidden="true">{{ o.done ? '✓' : '○' }}</span>
          <span class="objectives__label">{{ o.label }}</span>
          <span class="objectives__bar"><i :style="{ width: o.pct + '%' }"></i></span>
        </li>
      </ul>

      <!-- Aviso de fase / jefe -->
      <div class="banner" v-if="m.zonePhase || m.boss">
        <span v-if="m.zonePhase">{{ m.zonePhase }}</span>
        <span v-if="m.boss" class="banner__boss">{{ m.boss.name }} · {{ m.boss.mass }}</span>
      </div>

      <!-- Potenciadores activos -->
      <ul class="powers" v-if="snap.powers.length">
        <li v-for="p in snap.powers" :key="p.id">
          <span class="powers__icon" aria-hidden="true">{{ p.icon }}</span>
          <span class="powers__name">{{ p.name }}</span>
          <span class="powers__time">{{ Math.ceil(p.remaining) }}s</span>
        </li>
      </ul>

      <!-- Ranking -->
      <Leaderboard
        class="hud__leaderboard"
        :rows="snap.leaderboard"
        :kill-feed="snap.killFeed"
        :compact="compact"
      />

      <!-- Espectando (Cerco tras morir) -->
      <p class="spectating" v-if="m.spectating">
        Viendo a <b>{{ m.spectating }}</b>
      </p>

      <!-- Elección de carta (Nido) — congela el mundo -->
      <div class="cards" v-if="m.cards">
        <h2 class="cards__title">Elige una mejora</h2>
        <div class="cards__row">
          <button
            v-for="c in m.cards" :key="c.id" type="button"
            class="card" @click="$emit('card', c.id)"
          >
            <span class="card__name">{{ c.name }}</span>
            <span class="card__desc">{{ c.desc }}</span>
          </button>
        </div>
        <ul class="cards__taken" v-if="m.taken?.length">
          <li v-for="t in m.taken" :key="t.id">{{ t.name }}</li>
        </ul>
      </div>

    </div>
  `,
};
