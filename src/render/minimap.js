/**
 * minimap.js — Minimapa con distinción por forma además de por color.
 *
 * Lo de la forma no es un adorno: en Dominio los tres equipos se distinguían
 * solo por color, lo que dejaba fuera a quien no distingue rojo de verde.
 */

import { rgba, clamp } from '../engine/math.js';

const TEAM_SHAPES = ['circle', 'square', 'triangle', 'diamond'];

/**
 * Radar circular, abajo a la derecha.
 *
 * Circular y no cuadrado por dos razones: deja las esquinas de la pantalla
 * libres, y sobre todo comunica que lo que ves es "tu entorno" y no un plano
 * del mapa. Abajo a la derecha porque el ojo vive en el centro y las esquinas
 * inferiores son el sitio natural de la información de estado.
 */
export function drawMinimap(ctx, world, camera, theme, settings) {
  if (!settings.showMinimap) return;

  const size = settings.minimapSize ?? 132;
  const pad = 18;
  const x = camera.viewW - size - pad;
  const y = camera.viewH - size - pad;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const radius = size / 2;
  const sx = size / world.bounds.w;
  const sy = size / world.bounds.h;

  ctx.save();

  // Disco de fondo
  ctx.globalAlpha = 0.88;
  ctx.fillStyle = theme.ui?.panel ?? 'rgba(10,16,22,0.82)';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = theme.ui?.panelBorder ?? 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
  ctx.clip();

  // Elementos que el modo quiera pintar (zona de Cerco, nodos de Dominio)
  world.mode.drawMinimap?.(ctx, world, { x, y, size, sx, sy }, theme);

  // Bots
  for (const s of world.snakes) {
    if (!s.alive || s.isPlayer) continue;
    const px = x + s.head.x * sx;
    const py = y + s.head.y * sy;
    const r = clamp(1.4 + s.radius / 14, 1.4, 3.6);
    ctx.globalAlpha = s.isHunter ? 1 : 0.78;
    ctx.fillStyle = s.skin.head;
    if (s.team !== null && settings.colorblindShapes) {
      drawShape(ctx, TEAM_SHAPES[s.team % TEAM_SHAPES.length], px, py, r + 0.6);
    } else {
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    if (s.isHunter) {
      ctx.strokeStyle = '#ff7a5c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Jugador
  const p = world.player;
  if (p && p.alive) {
    const px = x + p.head.x * sx;
    const py = y + p.head.y * sy;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px, py, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.skin.head;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  }

  // Rectángulo de vista
  const rect = camera.viewRect(0);
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.strokeRect(
    x + rect.minX * sx, y + rect.minY * sy,
    (rect.maxX - rect.minX) * sx, (rect.maxY - rect.minY) * sy,
  );

  ctx.restore();
  ctx.restore();
}

function drawShape(ctx, shape, x, y, r) {
  ctx.beginPath();
  switch (shape) {
    case 'square':   ctx.rect(x - r, y - r, r * 2, r * 2); break;
    case 'triangle':
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r, y + r * 0.8);
      ctx.lineTo(x - r, y + r * 0.8);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.moveTo(x, y - r * 1.2);
      ctx.lineTo(x + r * 1.1, y);
      ctx.lineTo(x, y + r * 1.2);
      ctx.lineTo(x - r * 1.1, y);
      ctx.closePath();
      break;
    default: ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export { rgba };
