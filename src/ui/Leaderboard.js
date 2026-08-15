/**
 * Leaderboard.js — Ranking en vivo y registro de eliminaciones.
 * En móvil se pliega a las tres primeras posiciones en lugar de desaparecer,
 * que es lo que hacía la versión anterior.
 */

export const Leaderboard = {
  props: {
    rows: { type: Array, default: () => [] },
    killFeed: { type: Array, default: () => [] },
    compact: { type: Boolean, default: false },
  },

  setup(props) {
    const visible = Vue.computed(() => (props.compact ? props.rows.slice(0, 3) : props.rows));
    return { visible };
  },

  template: `
    <div class="leaderboard">
      <ol class="leaderboard__list">
        <li
          v-for="(r, i) in visible"
          :key="r.name + i"
          class="leaderboard__row"
          :class="{ 'is-player': r.isPlayer }"
        >
          <span class="leaderboard__rank">{{ i + 1 }}</span>
          <span class="leaderboard__dot" :style="{ background: r.color }" aria-hidden="true"></span>
          <span class="leaderboard__name">{{ r.name }}</span>
          <span class="leaderboard__value">{{ r.value }}</span>
        </li>
      </ol>

      <transition-group name="feed" tag="ul" class="killfeed" v-if="killFeed.length">
        <li v-for="k in killFeed" :key="k.killer + k.victim + k.t"
            :class="{ 'is-player': k.isPlayer }">
          <b>{{ k.killer }}</b> eliminó a <span>{{ k.victim }}</span>
        </li>
      </transition-group>
    </div>
  `,
};
