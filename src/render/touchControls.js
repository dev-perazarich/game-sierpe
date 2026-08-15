/*
 * Sierpe — indicador de los controles táctiles.
 * Copyright (C) 2026 dev-perazarich · GNU AGPL v3.0
 */

/**
 * touchControls.js — Dibuja la ayuda visual del gesto táctil activo.
 *
 * Se pinta en coordenadas de pantalla, encima de todo y sin la transformación
 * de cámara, para que el tamaño no dependa del zoom.
 *
 * Regla de diseño: el indicador tiene que ser legible pero no tapar el juego.
 * Todo va con opacidad baja y trazo fino, y desaparece en cuanto se suelta el
 * dedo. Lo único opaco es la punta de la flecha, que es lo que de verdad hay
 * que leer de un vistazo.
 */

import { rgba } from '../engine/math.js';

export function drawTouchControls(ctx, overlay, theme, snakeScreenPos) {
  if (!overlay) return;

  const accent = theme.ui?.accent ?? '#FF7A45';
  const ink = '#FFFFFF';

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (overlay.mode) {
    case 'joystick': drawJoystick(ctx, overlay, accent, ink); break;
    case 'flecha':   drawArrow(ctx, overlay, accent, ink, snakeScreenPos); break;
    default:         drawClassic(ctx, overlay, accent, ink, snakeScreenPos); break;
  }

  ctx.restore();
}

/** Mando virtual: base fija donde apoyaste el dedo y pomo que la sigue. */
function drawJoystick(ctx, o, accent, ink) {
  const R = 62;
  const knobR = 26;

  // Base
  ctx.beginPath();
  ctx.arc(o.ox, o.oy, R, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#000000', 0.22);
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.28);
  ctx.lineWidth = 2;
  ctx.stroke();

  // Marca de dirección sobre el borde
  if (o.magnitude > 0.05) {
    ctx.beginPath();
    ctx.arc(o.ox, o.oy, R, o.angle - 0.42, o.angle + 0.42);
    ctx.strokeStyle = rgba(accent, 0.85);
    ctx.lineWidth = 4;
    ctx.stroke();
  }

  // Pomo, limitado al radio de la base
  const m = Math.min(1, o.magnitude);
  const kx = o.ox + Math.cos(o.angle) * R * m;
  const ky = o.oy + Math.sin(o.angle) * R * m;

  ctx.beginPath();
  ctx.arc(kx, ky, knobR, 0, Math.PI * 2);
  ctx.fillStyle = rgba(ink, o.boosting ? 0.5 : 0.34);
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.6);
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Flecha: sale de la cabeza y apunta a donde va la serpiente, con una guía
 * discreta desde el origen del arrastre para que se entienda el gesto.
 */
function drawArrow(ctx, o, accent, ink, head) {
  // Rastro del gesto: de dónde a dónde has arrastrado.
  ctx.beginPath();
  ctx.moveTo(o.ox, o.oy);
  ctx.lineTo(o.x, o.y);
  ctx.strokeStyle = rgba(ink, 0.20);
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 7]);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.arc(o.ox, o.oy, 9, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(ink, 0.28);
  ctx.lineWidth = 2;
  ctx.stroke();

  if (!head || o.magnitude < 0.05) return;

  // La flecha en sí, anclada a la cabeza: es lo que hay que leer.
  const len = 46 + o.magnitude * 54;
  const gap = 30;
  const ax = head.x + Math.cos(o.angle) * gap;
  const ay = head.y + Math.sin(o.angle) * gap;
  const tx = head.x + Math.cos(o.angle) * (gap + len);
  const ty = head.y + Math.sin(o.angle) * (gap + len);

  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(tx, ty);
  ctx.strokeStyle = rgba(accent, 0.55);
  ctx.lineWidth = 5;
  ctx.stroke();

  // Punta
  const wing = 15;
  ctx.beginPath();
  ctx.moveTo(tx + Math.cos(o.angle) * 12, ty + Math.sin(o.angle) * 12);
  ctx.lineTo(tx + Math.cos(o.angle + 2.5) * wing, ty + Math.sin(o.angle + 2.5) * wing);
  ctx.lineTo(tx + Math.cos(o.angle - 2.5) * wing, ty + Math.sin(o.angle - 2.5) * wing);
  ctx.closePath();
  ctx.fillStyle = rgba(accent, o.boosting ? 1 : 0.9);
  ctx.fill();
}

/** Clásico: un punto de destino bajo el dedo y una guía hasta la cabeza. */
function drawClassic(ctx, o, accent, ink, head) {
  if (head) {
    ctx.beginPath();
    ctx.moveTo(head.x, head.y);
    ctx.lineTo(o.x, o.y);
    ctx.strokeStyle = rgba(accent, 0.22);
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.arc(o.x, o.y, 22, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(accent, 0.55);
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(o.x, o.y, 5, 0, Math.PI * 2);
  ctx.fillStyle = rgba(accent, o.boosting ? 1 : 0.8);
  ctx.fill();
}

/**
 * Vista previa estática para la pantalla de ajustes, donde no hay partida.
 * Dibuja el esquema indicado dentro del rectángulo dado.
 */
export function drawControlPreview(ctx, mode, w, h, theme) {
  const accent = theme.ui?.accent ?? '#FF7A45';
  const ink = '#FFFFFF';
  const cx = w * 0.5, cy = h * 0.58;
  const angle = -Math.PI / 3;

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Serpiente de muestra, siempre la misma, para comparar esquemas.
  ctx.beginPath();
  ctx.moveTo(cx - 46, cy + 26);
  ctx.quadraticCurveTo(cx - 16, cy + 20, cx - 6, cy - 2);
  ctx.strokeStyle = rgba(accent, 0.65);
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - 6, cy - 2, 7, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();

  const head = { x: cx - 6, y: cy - 2 };
  const o = {
    mode, angle, magnitude: 0.8, boosting: false,
    ox: cx + 26, oy: cy + 34,
    x: cx + 26 + Math.cos(angle) * 40,
    y: cy + 34 + Math.sin(angle) * 40,
  };

  if (mode === 'joystick') drawJoystickPreview(ctx, o, accent, ink);
  else if (mode === 'flecha') drawArrow(ctx, o, accent, ink, head);
  else drawClassic(ctx, { ...o, x: cx + 40, y: cy - 34 }, accent, ink, head);

  ctx.restore();
}

function drawJoystickPreview(ctx, o, accent, ink) {
  const R = 34, knobR = 15;
  ctx.beginPath();
  ctx.arc(o.ox, o.oy, R, 0, Math.PI * 2);
  ctx.fillStyle = rgba('#000000', 0.25);
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.3);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(o.ox, o.oy, R, o.angle - 0.45, o.angle + 0.45);
  ctx.strokeStyle = rgba(accent, 0.85);
  ctx.lineWidth = 3.5;
  ctx.stroke();

  const kx = o.ox + Math.cos(o.angle) * R * o.magnitude;
  const ky = o.oy + Math.sin(o.angle) * R * o.magnitude;
  ctx.beginPath();
  ctx.arc(kx, ky, knobR, 0, Math.PI * 2);
  ctx.fillStyle = rgba(ink, 0.36);
  ctx.fill();
  ctx.strokeStyle = rgba(ink, 0.6);
  ctx.lineWidth = 2;
  ctx.stroke();
}
