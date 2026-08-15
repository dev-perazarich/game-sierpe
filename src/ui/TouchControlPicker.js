/*
 * Sierpe — selector de esquema de control táctil.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * TouchControlPicker.js — Elige entre los tres esquemas de control táctil.
 *
 * Cada opción se dibuja en su propio canvas con el mismo código que usa el
 * juego, así que la vista previa no puede mentir sobre cómo se verá luego.
 */

import { drawControlPreview } from '../render/touchControls.js';

const { ref, onMounted, onBeforeUnmount, watch, nextTick } = Vue;

export const MODOS_TACTILES = [
  {
    id: 'flecha',
    label: 'Flecha',
    desc: 'Arrastra desde cualquier punto. La serpiente sigue la dirección del arrastre.',
  },
  {
    id: 'clasico',
    label: 'Clásico',
    desc: 'La serpiente va hacia tu dedo, igual que con el ratón.',
  },
  {
    id: 'joystick',
    label: 'Joystick',
    desc: 'Mando virtual donde apoyes el dedo. El más preciso en giros largos.',
  },
];

export const TouchControlPicker = {
  props: {
    modelValue: { type: String, required: true },
    theme: { type: Object, required: true },
  },
  emits: ['update:modelValue'],

  setup(props) {
    const canvases = ref([]);
    let observer = null;

    function render() {
      for (const [i, modo] of MODOS_TACTILES.entries()) {
        const c = canvases.value[i];
        if (!c) continue;
        const w = c.clientWidth, h = c.clientHeight;
        // Mientras la pestaña esté oculta el canvas mide 0. No se dibuja, pero
        // el observador de abajo lo reintentará en cuanto tenga tamaño.
        if (!w || !h) continue;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const bw = Math.round(w * dpr), bh = Math.round(h * dpr);
        if (c.width !== bw || c.height !== bh) { c.width = bw; c.height = bh; }

        const ctx = c.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = props.theme.background.base;
        ctx.fillRect(0, 0, w, h);
        drawControlPreview(ctx, modo.id, w, h, props.theme);
      }
    }

    onMounted(() => {
      nextTick(render);
      // El panel de ajustes vive dentro de un v-show, así que al montarse tiene
      // display:none y tamaño cero. Un ResizeObserver es lo único que se entera
      // de cuándo pasa a ser visible; sin él los canvas se quedaban en blanco.
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => render());
        for (const c of canvases.value) if (c) observer.observe(c);
      }
      window.addEventListener('resize', render);
    });

    onBeforeUnmount(() => {
      observer?.disconnect();
      window.removeEventListener('resize', render);
    });

    watch(() => props.theme.id, () => nextTick(render));

    return { modos: MODOS_TACTILES, canvases, render };
  },

  template: `
    <div class="ctrl-picker">
      <button
        v-for="(m, i) in modos" :key="m.id" type="button"
        class="ctrl-opt" :class="{ 'is-active': modelValue === m.id }"
        @click="$emit('update:modelValue', m.id)"
      >
        <canvas :ref="el => { if (el) canvases[i] = el }" aria-hidden="true"></canvas>
        <span class="ctrl-opt__text">
          <span class="ctrl-opt__name">{{ m.label }}</span>
          <span class="ctrl-opt__desc">{{ m.desc }}</span>
        </span>
      </button>
    </div>
  `,
};
