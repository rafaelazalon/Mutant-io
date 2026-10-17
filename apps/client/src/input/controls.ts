import { viewport } from '../ui/viewport.js';
/**
 * Entrada unificada: teclado (WASD/setas) e joystick analógico virtual com multitoque.
 * Ambos produzem o mesmo eixo normalizado — mesmas regras de movimento em todas as plataformas.
 */
export class Controls {
  private keys = new Set<string>();
  private joyId: number | null = null;
  private joyOrigin = { x: 0, y: 0 };
  private joyVec = { x: 0, y: 0 };
  private get joyRadius() {
    return 60 * viewport.size.hud;
  }
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  leftHanded = false;
  enabled = true;
  onAbility: () => void = () => {};
  onSwap: () => void = () => {};
  /** teclas 1–6: escolher carta (se houver oferta) ou usar o poder daquele espaço */
  onDigit: (i: number) => void = () => {};
  onToggleBoard: () => void = () => {};
  usingTouch = false;

  constructor(private readonly surface: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.endJoy();
    });

    surface.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', (e) => this.up(e));
    window.addEventListener('pointercancel', (e) => this.up(e));
    // impede rolagem/zoom acidental durante a partida
    surface.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    const k = e.code;
    if (down) {
      if (k === 'Space' && !e.repeat) {
        e.preventDefault();
        if (this.enabled) this.onAbility();
      }
      if ((k === 'KeyQ' || k === 'KeyE') && !e.repeat && this.enabled) this.onSwap();
      if (/^Digit[1-6]$/.test(k) && !e.repeat) this.onDigit(Number(k.slice(5)) - 1);
      if (k === 'Tab') {
        e.preventDefault();
        this.onToggleBoard();
      }
      if (k.startsWith('Arrow')) e.preventDefault();
      this.keys.add(k);
    } else this.keys.delete(k);
  }

  private inJoyZone(x: number) {
    const half = viewport.size.w / 2;
    return this.leftHanded ? x > half : x < half;
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse' || !this.enabled) return;
    if (!this.usingTouch) document.body.classList.add('touch');
    this.usingTouch = true;
    if (this.joyId !== null || !this.inJoyZone(e.clientX)) return;
    this.joyId = e.pointerId;
    this.joyOrigin = { x: e.clientX, y: e.clientY };
    this.joyVec = { x: 0, y: 0 };
    this.base.style.left = `${e.clientX}px`;
    this.base.style.top = `${e.clientY}px`;
    this.base.classList.add('on');
    this.knob.style.transform = 'translate(-50%, -50%)';
  }

  private move(e: PointerEvent) {
    if (e.pointerId !== this.joyId) return;
    let dx = e.clientX - this.joyOrigin.x;
    let dy = e.clientY - this.joyOrigin.y;
    const d = Math.hypot(dx, dy);
    const R = this.joyRadius;
    if (d > R) {
      // base acompanha o dedo quando passa do limite (joystick "flutuante")
      const ex = (dx / d) * (d - R);
      const ey = (dy / d) * (d - R);
      this.joyOrigin.x += ex;
      this.joyOrigin.y += ey;
      this.base.style.left = `${this.joyOrigin.x}px`;
      this.base.style.top = `${this.joyOrigin.y}px`;
      dx -= ex;
      dy -= ey;
    }
    this.joyVec = { x: dx / R, y: dy / R };
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  private up(e: PointerEvent) {
    if (e.pointerId === this.joyId) this.endJoy();
  }

  private endJoy() {
    this.joyId = null;
    this.joyVec = { x: 0, y: 0 };
    this.base.classList.remove('on');
  }

  reset() {
    this.keys.clear();
    this.endJoy();
  }

  axis(): [number, number] {
    if (!this.enabled) return [0, 0];
    if (this.joyId !== null) {
      const { x, y } = this.joyVec;
      const m = Math.hypot(x, y);
      // zona morta pequena e resposta proporcional (intensidade)
      if (m < 0.12) return [0, 0];
      const s = Math.min(1, (m - 0.12) / 0.78) / m;
      return [x * s, y * s];
    }
    const k = this.keys;
    let x = 0;
    let y = 0;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const m = Math.hypot(x, y);
    return m > 0 ? [x / m, y / m] : [0, 0];
  }
}
