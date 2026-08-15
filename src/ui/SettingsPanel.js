/**
 * SettingsPanel.js — Ajustes completos.
 *
 * El juego anterior no tenía ninguno. Aquí están los cuatro grupos que importan:
 * imagen, control, audio y accesibilidad. Todo se aplica en caliente y se guarda
 * al instante, sin botón de confirmar.
 */

import { THEME_LIST } from '../themes/index.js';
import { DIFFICULTY_LIST } from '../ai/personalities.js';

export const SettingsPanel = {
  props: {
    settings: { type: Object, required: true },
    fps: { type: Number, default: 0 },
  },
  emits: ['change'],

  setup(props, { emit }) {
    const themes = THEME_LIST;
    const difficulties = DIFFICULTY_LIST;
    const qualities = [
      { id: 'auto',   label: 'Automática' },
      { id: 'low',    label: 'Baja' },
      { id: 'medium', label: 'Media' },
      { id: 'high',   label: 'Alta' },
    ];

    const set = (key, value) => emit('change', key, value);
    const num = (key) => (e) => set(key, Number(e.target.value));
    const bool = (key) => (e) => set(key, e.target.checked);

    return { themes, difficulties, qualities, set, num, bool };
  },

  template: `
    <div class="settings">

      <section class="settings__group">
        <h3 class="settings__title">Imagen</h3>

        <div class="field">
          <span class="field__label">Tema visual</span>
          <div class="theme-grid">
            <button
              v-for="t in themes" :key="t.id" type="button"
              class="theme-opt" :class="{ 'is-active': settings.theme === t.id }"
              @click="set('theme', t.id)"
            >
              <span class="theme-opt__swatches">
                <span v-for="(c, i) in t.swatches" :key="i" :style="{ background: c }"></span>
              </span>
              <span class="theme-opt__name">{{ t.name }}</span>
              <span class="theme-opt__tag">{{ t.tagline }}</span>
            </button>
          </div>
        </div>

        <label class="field">
          <span class="field__label">
            Calidad gráfica
            <span v-if="settings.quality === 'auto'" class="field__hint">
              se ajusta sola si baja el rendimiento
            </span>
          </span>
          <select :value="settings.quality" @change="set('quality', $event.target.value)">
            <option v-for="q in qualities" :key="q.id" :value="q.id">{{ q.label }}</option>
          </select>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.showNames" @change="bool('showNames')" />
          <span>Mostrar nombres de rivales</span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.showMinimap" @change="bool('showMinimap')" />
          <span>Mostrar minimapa</span>
        </label>

        <label class="field" v-if="settings.showMinimap">
          <span class="field__label">Tamaño del minimapa <b>{{ settings.minimapSize }} px</b></span>
          <input type="range" min="96" max="220" step="4"
                 :value="settings.minimapSize" @input="num('minimapSize')($event)" />
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.showFps" @change="bool('showFps')" />
          <span>Mostrar FPS <span class="field__hint" v-if="fps">— ahora: {{ fps }}</span></span>
        </label>
      </section>

      <section class="settings__group">
        <h3 class="settings__title">Juego y control</h3>

        <label class="field">
          <span class="field__label">Dificultad de los bots</span>
          <select :value="settings.difficulty" @change="set('difficulty', $event.target.value)">
            <option v-for="d in difficulties" :key="d.id" :value="d.id">{{ d.label }}</option>
          </select>
          <span class="field__hint">
            Sube la habilidad: reaccionan antes y apuntan mejor. Nunca corren más que tú.
          </span>
        </label>

        <label class="field">
          <span class="field__label">Zona muerta del puntero <b>{{ settings.deadzone }} px</b></span>
          <input type="range" min="0" max="70" step="2"
                 :value="settings.deadzone" @input="num('deadzone')($event)" />
          <span class="field__hint">Radio alrededor de la cabeza donde el puntero se ignora.</span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.toggleBoost" @change="bool('toggleBoost')" />
          <span>Turbo por alternancia <span class="field__hint">— en vez de mantener pulsado</span></span>
        </label>
      </section>

      <section class="settings__group">
        <h3 class="settings__title">Audio</h3>

        <label class="switch">
          <input type="checkbox" :checked="settings.muted" @change="bool('muted')" />
          <span>Silenciar todo</span>
        </label>

        <label class="field">
          <span class="field__label">Volumen general <b>{{ Math.round(settings.masterVolume * 100) }}%</b></span>
          <input type="range" min="0" max="1" step="0.05"
                 :value="settings.masterVolume" @input="num('masterVolume')($event)" />
        </label>

        <label class="field">
          <span class="field__label">Efectos <b>{{ Math.round(settings.sfxVolume * 100) }}%</b></span>
          <input type="range" min="0" max="1" step="0.05"
                 :value="settings.sfxVolume" @input="num('sfxVolume')($event)" />
        </label>

        <label class="field">
          <span class="field__label">Ambiente <b>{{ Math.round(settings.ambientVolume * 100) }}%</b></span>
          <input type="range" min="0" max="1" step="0.05"
                 :value="settings.ambientVolume" @input="num('ambientVolume')($event)" />
        </label>
      </section>

      <section class="settings__group">
        <h3 class="settings__title">Accesibilidad</h3>

        <label class="switch">
          <input type="checkbox" :checked="settings.reducedMotion" @change="bool('reducedMotion')" />
          <span>
            Reducir movimiento
            <span class="field__hint">— quita partículas, sacudida y destellos</span>
          </span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.screenShake" @change="bool('screenShake')" />
          <span>Sacudida de pantalla</span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.highContrast" @change="bool('highContrast')" />
          <span>Alto contraste <span class="field__hint">— apaga el fondo y los halos</span></span>
        </label>

        <label class="switch">
          <input type="checkbox" :checked="settings.colorblindShapes" @change="bool('colorblindShapes')" />
          <span>Distinguir equipos por forma <span class="field__hint">— además del color</span></span>
        </label>

        <label class="field">
          <span class="field__label">Escala del HUD <b>{{ Math.round(settings.hudScale * 100) }}%</b></span>
          <input type="range" min="0.8" max="1.5" step="0.05"
                 :value="settings.hudScale" @input="num('hudScale')($event)" />
        </label>
      </section>

    </div>
  `,
};
