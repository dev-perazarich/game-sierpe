/**
 * SnakeEditor.js — Editor de serpiente con vista previa animada.
 *
 * La vista previa se mueve de verdad, en bucle, sobre el fondo del tema
 * seleccionado. Ver un patrón quieto no dice nada de cómo se ve en juego: los
 * patrones se dibujan con trazos discontinuos cuyo desfase avanza con el
 * movimiento, así que en estático parecen otra cosa.
 */

import { PATTERNS, EYE_STYLES, TRAILS, buildSkin, contrastRatio, hslHex } from '../themes/index.js';
import { catalogFor } from '../meta/cosmetics.js';
import { Snake } from '../entities/Snake.js';
import { drawSnake } from '../render/snakeRenderer.js';

const { ref, computed, onMounted, onBeforeUnmount, watch } = Vue;

export const SnakeEditor = {
  props: {
    appearance: { type: Object, required: true },
    theme: { type: Object, required: true },
    profile: { type: Object, required: true },
  },
  emits: ['change'],

  setup(props, { emit }) {
    const canvas = ref(null);
    let raf = 0;
    let preview = null;
    let t = 0;
    let last = 0;

    const patterns = computed(() => catalogFor('pattern', props.profile));
    const eyes = computed(() => catalogFor('eyes', props.profile));
    const trails = computed(() => catalogFor('trail', props.profile));

    // Contraste contra el fondo del tema. Si es bajo, la piel se aclara sola al
    // construirse; se avisa igualmente para que la elección sea informada.
    const contrast = computed(() =>
      contrastRatio(props.appearance.primary, props.theme.background.base).toFixed(1));
    const lowContrast = computed(() => Number(contrast.value) < 2.2);

    function set(key, value) {
      emit('change', { ...props.appearance, [key]: value });
    }

    function randomize() {
      const hue = Math.floor(Math.random() * 360);
      const openPatterns = patterns.value.filter((p) => !p.locked);
      const openEyes = eyes.value.filter((p) => !p.locked);
      const openTrails = trails.value.filter((p) => !p.locked);
      emit('change', {
        ...props.appearance,
        primary: hslHex(hue, 68, 58),
        secondary: hslHex((hue + 150) % 360, 60, 42),
        pattern: openPatterns[Math.floor(Math.random() * openPatterns.length)].value,
        eyes: openEyes[Math.floor(Math.random() * openEyes.length)].value,
        trail: openTrails[Math.floor(Math.random() * openTrails.length)].value,
      });
    }

    function rebuild() {
      const skin = buildSkin(props.appearance, props.theme);
      preview = new Snake({ x: 200, y: 90, angle: 0, skin, name: '', mass: 130 });
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      const c = canvas.value;
      if (!c || !preview) return;

      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      t += dt;

      // Recorrido en forma de ocho: enseña el patrón en curvas cerradas y
      // abiertas, que es donde se ve si funciona.
      const cx = 200, cy = 90;
      const tx = cx + Math.sin(t * 0.9) * 130;
      const ty = cy + Math.sin(t * 1.8) * 46;
      preview.aimAt(tx, ty);
      preview.step(1 / 60, { bounds: { w: 400, h: 180 }, mode: {} });

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.fillStyle = props.theme.background.base;
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.translate(w / 2 - preview.head.x * 0.78, h / 2 - preview.head.y * 0.78);
      ctx.scale(0.78, 0.78);
      drawSnake(ctx, preview, props.theme, { quality: 'high', lod: 0, time: t });
      ctx.restore();
    }

    onMounted(() => {
      rebuild();
      last = performance.now();
      raf = requestAnimationFrame(frame);
    });
    onBeforeUnmount(() => cancelAnimationFrame(raf));

    watch(() => [props.appearance.primary, props.appearance.secondary,
                 props.appearance.pattern, props.appearance.eyes, props.theme.id],
      rebuild);

    return { canvas, patterns, eyes, trails, set, randomize, contrast, lowContrast };
  },

  template: `
    <div class="editor">
      <div class="editor__preview">
        <canvas ref="canvas" aria-label="Vista previa de tu serpiente en movimiento"></canvas>
        <button class="btn btn--ghost editor__dice" type="button" @click="randomize">
          Aleatoria
        </button>
      </div>

      <p v-if="lowContrast" class="editor__warn">
        Este color se ve poco sobre el tema {{ theme.name }} (contraste {{ contrast }}:1).
        Se aclarará automáticamente en la partida.
      </p>

      <div class="editor__row">
        <label class="field">
          <span class="field__label">Color principal</span>
          <input type="color" :value="appearance.primary" @input="set('primary', $event.target.value)" />
        </label>
        <label class="field">
          <span class="field__label">Color secundario</span>
          <input type="color" :value="appearance.secondary" @input="set('secondary', $event.target.value)" />
        </label>
      </div>

      <div class="field">
        <span class="field__label">Patrón</span>
        <div class="chips">
          <button
            v-for="p in patterns" :key="p.id" type="button"
            class="chip" :class="{ 'is-active': appearance.pattern === p.value, 'is-locked': p.locked }"
            :disabled="p.locked"
            :title="p.locked ? p.req : p.label"
            @click="set('pattern', p.value)"
          >{{ p.label }}<span v-if="p.locked" class="chip__lock" aria-hidden="true">🔒</span></button>
        </div>
      </div>

      <div class="field">
        <span class="field__label">Ojos</span>
        <div class="chips">
          <button
            v-for="p in eyes" :key="p.id" type="button"
            class="chip" :class="{ 'is-active': appearance.eyes === p.value, 'is-locked': p.locked }"
            :disabled="p.locked" :title="p.locked ? p.req : p.label"
            @click="set('eyes', p.value)"
          >{{ p.label }}<span v-if="p.locked" class="chip__lock" aria-hidden="true">🔒</span></button>
        </div>
      </div>

      <div class="field">
        <span class="field__label">Estela de turbo</span>
        <div class="chips">
          <button
            v-for="p in trails" :key="p.id" type="button"
            class="chip" :class="{ 'is-active': appearance.trail === p.value, 'is-locked': p.locked }"
            :disabled="p.locked" :title="p.locked ? p.req : p.label"
            @click="set('trail', p.value)"
          >{{ p.label }}<span v-if="p.locked" class="chip__lock" aria-hidden="true">🔒</span></button>
        </div>
      </div>
    </div>
  `,
};
