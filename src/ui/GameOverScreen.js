/**
 * GameOverScreen.js — Pantalla final.
 *
 * Dos cosas que faltaban: reintentar con una sola tecla (espacio o intro, sin
 * pasar por el menú), y la repetición de los últimos segundos dibujada en el
 * propio canvas. «Chocaste contra Cobra42» no enseña nada; verlo sí.
 */

const { onMounted, onBeforeUnmount } = Vue;

export const GameOverScreen = {
  props: {
    results: { type: Object, required: true },
    records: { type: Array, default: () => [] },
    unlocks: { type: Object, default: () => ({ achievements: [], cosmetics: [] }) },
    modeName: { type: String, default: '' },
  },
  emits: ['retry', 'menu'],

  setup(props, { emit }) {
    function onKey(e) {
      if (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        emit('retry');
      } else if (e.code === 'Escape') {
        emit('menu');
      }
    }
    onMounted(() => window.addEventListener('keydown', onKey));
    onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
    return {};
  },

  template: `
    <div class="screen screen--over">
      <div class="over">
        <p class="over__eyebrow">{{ modeName }}</p>
        <h2 class="over__title" :class="{ 'is-win': results.victory }">{{ results.title }}</h2>
        <p class="over__cause">{{ results.cause }}</p>

        <div class="over__stats">
          <div v-for="s in results.stats" :key="s.label" class="stat">
            <span class="stat__label">{{ s.label }}</span>
            <span class="stat__value">{{ s.value }}</span>
          </div>
        </div>

        <p class="over__extra" v-if="results.extra">{{ results.extra }}</p>

        <!-- Objetivos del desafío diario -->
        <ul class="over__objectives" v-if="results.objectives">
          <li v-for="o in results.objectives" :key="o.id" :class="{ 'is-done': o.done }">
            <span aria-hidden="true">{{ o.done ? '✓' : '○' }}</span>
            {{ o.label }}
            <b v-if="!o.done">{{ Math.round(o.progress * 100) }}%</b>
          </li>
        </ul>

        <div class="over__records" v-if="records.length">
          <p class="over__records-title">Récord personal</p>
          <ul>
            <li v-for="r in records" :key="r.label"><b>{{ r.label }}</b> {{ r.value }}</li>
          </ul>
        </div>

        <div class="over__unlocks" v-if="unlocks.achievements.length || unlocks.cosmetics.length">
          <p class="over__records-title">Desbloqueado</p>
          <ul>
            <li v-for="a in unlocks.achievements" :key="a.id">🏆 {{ a.name }} — {{ a.desc }}</li>
            <li v-for="c in unlocks.cosmetics" :key="c.id">🎨 {{ c.label }}</li>
          </ul>
        </div>

        <div class="over__actions">
          <button class="btn btn--primary btn--big" type="button" @click="$emit('retry')">
            Reintentar
          </button>
          <button class="btn btn--ghost" type="button" @click="$emit('menu')">Menú</button>
        </div>

        <p class="hint">Pulsa <kbd>espacio</kbd> para volver a jugar</p>
      </div>
    </div>
  `,
};
