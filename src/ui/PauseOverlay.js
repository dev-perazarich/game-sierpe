/**
 * PauseOverlay.js — Pausa con ajustes accesibles sin salir de la partida.
 * Poder cambiar tema o calidad sin perder la partida es la diferencia entre
 * probar los ajustes y no tocarlos nunca.
 */

import { SettingsPanel } from './SettingsPanel.js';

export const PauseOverlay = {
  components: { SettingsPanel },
  props: {
    settings: { type: Object, required: true },
    modeName: { type: String, default: '' },
    fps: { type: Number, default: 0 },
  },
  emits: ['resume', 'menu', 'restart', 'setting'],

  setup() {
    const showSettings = Vue.ref(false);
    return { showSettings };
  },

  template: `
    <div class="overlay">
      <div class="overlay__box" :class="{ 'is-wide': showSettings }">
        <p class="overlay__eyebrow">{{ modeName }}</p>
        <h2 class="overlay__title">Pausa</h2>

        <div v-if="!showSettings" class="overlay__actions">
          <button class="btn btn--primary" type="button" @click="$emit('resume')">Continuar</button>
          <button class="btn" type="button" @click="showSettings = true">Ajustes</button>
          <button class="btn" type="button" @click="$emit('restart')">Reiniciar</button>
          <button class="btn btn--ghost" type="button" @click="$emit('menu')">Salir al menú</button>
        </div>

        <div v-else class="overlay__settings">
          <SettingsPanel :settings="settings" :fps="fps"
                         @change="(k, v) => $emit('setting', k, v)" />
          <button class="btn btn--primary" type="button" @click="showSettings = false">Volver</button>
        </div>
      </div>
    </div>
  `,
};
