import { clamp } from './math.js';

/** Estado mínimo de movimento — compartilhado por servidor (autoritativo) e cliente (previsão). */
export interface MoveBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Tempo restante de investida/bote (velocidade travada). */
  dashT: number;
  dashDx: number;
  dashDy: number;
  dashSpeed: number;
}

export interface MoveParams {
  /** Velocidade máxima já com lentidão aplicada. */
  maxSpeed: number;
  accel: number;
  decel: number;
  radius: number;
}

/** Normaliza o eixo do joystick/teclado: sem NaN, magnitude ≤ 1. */
export function sanitizeAxis(ix: unknown, iy: unknown): [number, number] {
  let x = typeof ix === 'number' && Number.isFinite(ix) ? ix : 0;
  let y = typeof iy === 'number' && Number.isFinite(iy) ? iy : 0;
  x = clamp(x, -1, 1);
  y = clamp(y, -1, 1);
  const m = Math.hypot(x, y);
  if (m > 1) {
    x /= m;
    y /= m;
  }
  if (m < 0.02) return [0, 0];
  return [x, y];
}

/**
 * Um passo de movimento com tempo fixo. Determinístico: o cliente usa a mesma
 * função para prever e reconciliar contra o servidor.
 */
export function stepMovement(
  b: MoveBody,
  ix: number,
  iy: number,
  p: MoveParams,
  dt: number,
  arenaW: number,
  arenaH: number,
): void {
  if (b.dashT > 0) {
    b.vx = b.dashDx * b.dashSpeed;
    b.vy = b.dashDy * b.dashSpeed;
    b.dashT = Math.max(0, b.dashT - dt);
    if (b.dashT === 0) {
      // sai da investida mantendo a velocidade máxima normal na mesma direção
      const s = Math.hypot(b.vx, b.vy);
      if (s > p.maxSpeed && s > 0) {
        b.vx = (b.vx / s) * p.maxSpeed;
        b.vy = (b.vy / s) * p.maxSpeed;
      }
    }
  } else {
    const mag = Math.hypot(ix, iy);
    const tx = ix * p.maxSpeed;
    const ty = iy * p.maxSpeed;
    const dvx = tx - b.vx;
    const dvy = ty - b.vy;
    const dl = Math.hypot(dvx, dvy);
    const rate = (mag > 0.05 ? p.accel : p.decel) * dt;
    if (dl <= rate || dl === 0) {
      b.vx = tx;
      b.vy = ty;
    } else {
      b.vx += (dvx / dl) * rate;
      b.vy += (dvy / dl) * rate;
    }
  }

  b.x += b.vx * dt;
  b.y += b.vy * dt;

  const r = p.radius;
  if (b.x < r) {
    b.x = r;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > arenaW - r) {
    b.x = arenaW - r;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < r) {
    b.y = r;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > arenaH - r) {
    b.y = arenaH - r;
    if (b.vy > 0) b.vy = 0;
  }
}
