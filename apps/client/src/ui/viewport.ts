/**
 * Tamanho real da área de jogo, atualizado em rotação, barra de endereço que some/aparece,
 * janela redimensionada, tela cheia e quando o jogo roda dentro de um iframe.
 * Publica variáveis CSS (--app-h, --hud) e classes no <body> para a interface se adaptar.
 */
export interface ViewSize {
  w: number;
  h: number;
  short: number;
  long: number;
  portrait: boolean;
  /** escala da interface (1 = celular comum em pé) */
  hud: number;
  coarse: boolean;
}

type Listener = (v: ViewSize) => void;

class ViewportTracker {
  private listeners = new Set<Listener>();
  private pending = false;
  private stage: HTMLElement;
  size: ViewSize = { w: 1, h: 1, short: 1, long: 1, portrait: true, hud: 1, coarse: false };

  constructor() {
    // elemento fixo que ocupa exatamente a área visível; medimos ele em vez de confiar em window.inner*
    let stage = document.getElementById('stage');
    if (!stage) {
      stage = document.createElement('div');
      stage.id = 'stage';
      stage.setAttribute('aria-hidden', 'true');
      document.body.prepend(stage);
    }
    this.stage = stage;
    this.measure();
    const schedule = () => this.schedule();
    window.addEventListener('resize', schedule);
    window.addEventListener('orientationchange', () => {
      schedule();
      // alguns navegadores só atualizam o tamanho um pouco depois de girar
      setTimeout(schedule, 250);
      setTimeout(schedule, 600);
    });
    window.visualViewport?.addEventListener('resize', schedule);
    document.addEventListener('fullscreenchange', schedule);
    if ('ResizeObserver' in window) new ResizeObserver(schedule).observe(stage);
  }

  private schedule() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      const before = this.size;
      this.measure();
      if (before.w !== this.size.w || before.h !== this.size.h) for (const l of this.listeners) l(this.size);
    });
  }

  private measure() {
    const r = this.stage.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width || window.innerWidth));
    const h = Math.max(1, Math.round(r.height || window.innerHeight));
    const short = Math.min(w, h);
    const long = Math.max(w, h);
    const portrait = h >= w;
    const coarse = matchMedia?.('(pointer: coarse)').matches ?? false;
    let hud: number;
    if (!coarse) hud = Math.min(h / 620, w / 1100); // computador: acompanha o monitor
    else if (portrait) hud = Math.min(w / 390, h / 700); // celular/tablet em pé
    else hud = Math.min(h / 430, w / 800); // deitado: a altura é o limite
    hud = Math.max(0.72, Math.min(1.8, hud));
    this.size = { w, h, short, long, portrait, hud, coarse };
    const root = document.documentElement.style;
    root.setProperty('--app-w', `${w}px`);
    root.setProperty('--app-h', `${h}px`);
    root.setProperty('--hud', hud.toFixed(3));
    const b = document.body.classList;
    b.toggle('portrait', portrait);
    b.toggle('landscape', !portrait);
    b.toggle('short', h < 520);
    b.toggle('narrow', w < 380);
    b.toggle('coarse', coarse);
  }

  onChange(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const viewport = new ViewportTracker();

/** Tela cheia no celular ao começar a jogar (some com as barras do navegador). Falha em silêncio onde não é permitido. */
export async function tryFullscreen(): Promise<boolean> {
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  if (document.fullscreenElement) return true;
  try {
    if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else return false;
    return true;
  } catch {
    return false;
  }
}
