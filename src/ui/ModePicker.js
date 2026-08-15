/**
 * ModePicker.js — Selección de modo como pantalla principal.
 *
 * El menú anterior pedía un nombre obligatorio antes de dejarte jugar y mostraba
 * tres líneas de instrucciones que nadie lee. Aquí lo primero que ves es a qué
 * puedes jugar, y el modo elegido se recuerda entre sesiones.
 */

import { MODE_LIST } from '../modes/index.js';
import { todaysObjectives } from '../modes/daily.js';

export const ModePicker = {
  props: {
    modelValue: { type: String, required: true },
    dailyDone: { type: Object, default: null },
  },
  emits: ['update:modelValue', 'play'],

  setup() {
    return { modes: MODE_LIST, dailyObjectives: todaysObjectives() };
  },

  template: `
    <div class="modes">
      <button
        v-for="m in modes"
        :key="m.id"
        class="mode-card"
        :class="{ 'is-active': modelValue === m.id }"
        type="button"
        @click="$emit('update:modelValue', m.id)"
        @dblclick="$emit('play')"
      >
        <span class="mode-card__icon" aria-hidden="true">{{ m.icon }}</span>
        <span class="mode-card__body">
          <span class="mode-card__name">{{ m.name }}</span>
          <span class="mode-card__desc">{{ m.short }}</span>
        </span>
        <span class="mode-card__time">{{ m.duracion }}</span>
      </button>

      <button
        class="mode-card mode-card--daily"
        :class="{ 'is-active': modelValue === 'daily' }"
        type="button"
        @click="$emit('update:modelValue', 'daily')"
        @dblclick="$emit('play')"
      >
        <span class="mode-card__icon" aria-hidden="true">★</span>
        <span class="mode-card__body">
          <span class="mode-card__name">
            Desafío diario
            <span v-if="dailyDone" class="badge">{{ dailyDone.medals }}/3 hoy</span>
          </span>
          <span class="mode-card__desc">
            El mismo mapa para todos hoy. Tres objetivos, una medalla.
          </span>
          <ul class="mode-card__objectives">
            <li v-for="o in dailyObjectives" :key="o.id">{{ o.label }}</li>
          </ul>
        </span>
        <span class="mode-card__time">3 min</span>
      </button>
    </div>
  `,
};
