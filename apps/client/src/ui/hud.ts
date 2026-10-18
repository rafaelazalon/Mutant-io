import { ABILITY_LABEL, HYBRIDS, MUTATIONS, QUICK_CHAT, hybridsCompletedBy, type AbilityId, type ChatMsg, type MutationId } from '@mutant/shared';
import type { ClientGame } from '../net/game.js';
import { viewport } from './viewport.js';

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export const ABILITY_ICON: Record<AbilityId, string> = {
  dash: MUTATIONS.cauda_propulsora.icon,
  blink: MUTATIONS.salto_dimensional.icon,
  shield: MUTATIONS.escudo_organico.icon,
  pulse: MUTATIONS.pulso_bioeletrico.icon,
  decoy: MUTATIONS.isca_biologica.icon,
  cloak: MUTATIONS.camuflagem.icon,
};

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Posições dos botões de poder (centro, em px a partir do canto inferior direito do contêiner). */
const POWER_SLOTS: [number, number][] = [
  [0, 0],
  [-104, 4],
  [-86, -74],
  [-14, -104],
  [-170, -10],
  [-150, -96],
];

interface PowerBtn {
  el: HTMLButtonElement;
  cd: HTMLElement;
  ct: HTMLElement;
  ic: HTMLElement;
  lb: HTMLElement;
  ab: AbilityId | null;
  state: string;
}

/**
 * Interface da arena. O DOM só é tocado quando algo muda, e no máximo ~15 vezes por segundo,
 * para não competir com o desenho do jogo.
 */
export class Hud {
  readonly root: HTMLElement;
  private hpBar: HTMLElement;
  private hpFill: HTMLElement;
  private hpTxt: HTMLElement;
  private evoFill: HTMLElement;
  private evoTxt: HTMLElement;
  private lvl: HTMLElement;
  private lvlN: HTMLElement;
  private muts: HTMLElement;
  private timer: HTMLElement;
  private phase: HTMLElement;
  private board: HTMLElement;
  private net: HTMLElement;
  private killfeed: HTMLElement;
  /** abates seguidos do jogador local (zera ao morrer) */
  streak = 0;
  private powers: HTMLElement;
  private pbtns: PowerBtn[] = [];
  private evoPanel: HTMLElement;
  private evoPill: HTMLButtonElement;
  private toasts: HTMLElement;
  private banner: HTMLElement;
  private death: HTMLElement;
  readonly roomChip: HTMLButtonElement;
  readonly menuBtn: HTMLButtonElement;
  private chatBox: HTMLElement;
  private qcPop: HTMLElement;
  onQuickChat: (i: number) => void = () => {};
  readonly modeTag: HTMLElement;
  private cache = new Map<string, string>();
  private offerShown = -1;
  private evoMinimized = false;
  private lastLevel = -1;
  private acc = 1;
  boardCollapsed = viewport.size.w < 700 || viewport.size.h < 520;
  showStats = false;
  killerName = '';

  onPick: (m: MutationId) => void = () => {};
  onPower: (slot: number) => void = () => {};

  constructor() {
    const r = (this.root = document.getElementById('hud')!);
    this.hpBar = $(r, '.bar.hp');
    this.hpFill = $(r, '.bar.hp .fill');
    this.hpTxt = $(r, '.bar.hp .txt');
    this.evoFill = $(r, '.bar.evo .fill');
    this.evoTxt = $(r, '.bar.evo .txt');
    this.lvl = $(r, '.lvl');
    this.lvlN = $(r, '.lvl-n');
    this.muts = $(r, '.muts');
    this.timer = $(r, '.timer');
    this.phase = $(r, '.phase');
    this.board = $(r, '.board');
    this.net = $(r, '.net');
    this.killfeed = $(r, '.killfeed');
    this.powers = $(r, '.powers');
    this.evoPanel = $(r, '.evo-panel');
    this.evoPill = $(r, '.evo-pill');
    this.toasts = $(r, '.toasts');
    this.banner = $(r, '.banner');
    this.death = $(r, '.death');
    this.roomChip = $(r, '.room-chip');
    this.menuBtn = $(r, '.menu-btn');
    this.chatBox = $(r, '.chat');
    this.qcPop = $(r, '.qc-pop');
    this.qcPop.innerHTML = QUICK_CHAT.map((t, i) => `<button type="button" data-i="${i}">${esc(t)}</button>`).join('');
    const qcBtn = $(r, '.qc-btn');
    qcBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.qcPop.classList.toggle('hidden');
    });
    this.qcPop.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const b = (e.target as HTMLElement).closest('button');
      if (!b) return;
      this.onQuickChat(Number(b.dataset.i));
      this.qcPop.classList.add('hidden');
    });
    window.addEventListener('pointerdown', () => this.qcPop.classList.add('hidden'));
    this.modeTag = $(r, '.mode-tag');
    this.buildPowers();

    this.evoPill.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.evoMinimized = false;
      this.offerShown = -1;
      this.acc = 1;
    });
    this.board.addEventListener('click', () => {
      this.boardCollapsed = !this.boardCollapsed;
    });
    // toque nas cartas: delegação com pointerdown (funciona com outro dedo no joystick)
    this.evoPanel.addEventListener('pointerdown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('.min')) {
        e.preventDefault();
        this.evoMinimized = true;
        this.acc = 1;
        return;
      }
      const card = t.closest<HTMLElement>('.card');
      if (!card?.dataset.m) return;
      e.preventDefault();
      card.classList.add('press');
      this.onPick(card.dataset.m as MutationId);
    });
  }

  private buildPowers() {
    this.powers.innerHTML = '';
    this.pbtns = POWER_SLOTS.map(([dx, dy], i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `pw${i === 0 ? ' main' : ''} hidden`;
      el.innerHTML = '<span class="ic"></span><span class="lb"></span><span class="cd"></span><span class="ct"></span><span class="k"></span>';
      const size = i === 0 ? 88 : 64;
      el.dataset.dx = String(-dx + (i === 0 ? 0 : 12));
      el.style.bottom = `${-dy + (i === 0 ? 0 : 12)}px`;
      void size;
      (el.querySelector('.k') as HTMLElement).textContent = String(i + 1);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.classList.add('press');
        this.onPower(i);
      });
      const release = () => el.classList.remove('press');
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', release);
      this.powers.appendChild(el);
      return { el, cd: $(el, '.cd'), ct: $(el, '.ct'), ic: $(el, '.ic'), lb: $(el, '.lb'), ab: null, state: '' };
    });
  }

  /** Espelha os botões de poder para o modo canhoto. */
  setLefty(lefty: boolean) {
    for (const b of this.pbtns) {
      const d = `${b.el.dataset.dx}px`;
      b.el.style.right = lefty ? '' : d;
      b.el.style.left = lefty ? d : '';
    }
  }

  show(v: boolean) {
    this.root.classList.toggle('hidden', !v);
  }

  private set(key: string, el: HTMLElement, html: string) {
    if (this.cache.get(key) === html) return;
    this.cache.set(key, html);
    el.innerHTML = html;
  }

  private text(key: string, el: HTMLElement, t: string) {
    if (this.cache.get(key) === t) return;
    this.cache.set(key, t);
    el.textContent = t;
  }

  /** Mensagem no chat (personagens de IA, chat rápido e avisos). */
  chat(m: ChatMsg) {
    const d = document.createElement('div');
    d.className = `cm${m.k === 2 ? ' sys' : ''}`;
    d.innerHTML = m.k === 2 ? esc(m.s) : `${m.k === 0 ? '<span class="ai">🤖 IA</span>' : ''}<b style="color:hsl(${m.h} 90% 68%)">${esc(m.n)}:</b>${esc(m.s)}`;
    this.chatBox.appendChild(d);
    while (this.chatBox.children.length > 5) this.chatBox.firstChild?.remove();
    setTimeout(() => d.remove(), 11000);
  }

  clearChat() {
    this.chatBox.innerHTML = '';
  }

  /** Registro de abates (canto superior direito). */
  feed(killer: string | undefined, victim: string, back: boolean, cls: '' | 'mine' | 'died') {
    const d = document.createElement('div');
    d.className = `kf ${cls}`;
    d.innerHTML = killer
      ? `<span class="a">${esc(killer)}</span><span class="ic">🦷</span><span class="b">${esc(victim)}</span>${back ? '<span class="back">pelas costas</span>' : ''}`
      : `<span class="b">${esc(victim)}</span><span class="ic">☠️</span><span class="a">ácido</span>`;
    this.killfeed.prepend(d);
    while (this.killfeed.children.length > 4) this.killfeed.lastChild?.remove();
    setTimeout(() => d.remove(), 5200);
  }

  toast(text: string, kind: string) {
    const d = document.createElement('div');
    d.className = `toast ${kind}`;
    d.textContent = text;
    this.toasts.appendChild(d);
    while (this.toasts.children.length > 3) this.toasts.firstChild?.remove();
    setTimeout(() => d.remove(), 3600);
  }

  showBanner(big: string, sub: string) {
    this.banner.innerHTML = `<div class="big">${esc(big)}</div><div class="sub">${esc(sub)}</div>`;
    this.banner.classList.remove('hidden');
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
  }

  resetOffer() {
    this.offerShown = -1;
    this.evoMinimized = false;
    this.evoPanel.classList.add('hidden');
    this.evoPill.classList.add('hidden');
  }

  /** Chamado a cada quadro; o trabalho real roda ~15×/s. */
  update(g: ClientGame, dt = 1 / 60) {
    this.acc += dt;
    if (this.acc < 1 / 15) return;
    this.acc = 0;
    const me = g.me;
    if (!me) return;

    const hpPct = Math.max(0, Math.min(1, me.hp / me.mhp));
    this.hpFill.style.transform = `scaleX(${hpPct.toFixed(3)})`;
    this.hpBar.classList.toggle('low', hpPct < 0.3 && me.alive);
    this.text('hp', this.hpTxt, `${me.hp} / ${me.mhp}`);
    const span = Math.max(1, me.bmNext - me.bmPrev);
    const maxed = me.bmNext <= me.bmPrev;
    const evoPct = maxed ? 1 : Math.max(0, Math.min(1, (me.bm - me.bmPrev) / span));
    this.evoFill.style.transform = `scaleX(${evoPct.toFixed(3)})`;
    this.text('evo', this.evoTxt, maxed ? 'Evolução máxima' : `Evolução ${Math.floor(me.bm)}/${me.bmNext}`);
    if (me.lv !== this.lastLevel) {
      this.lvlN.textContent = String(me.lv);
      if (this.lastLevel >= 0 && me.lv > this.lastLevel) {
        this.lvl.classList.remove('up');
        void this.lvl.offsetWidth;
        this.lvl.classList.add('up');
      }
      this.lastLevel = me.lv;
    }

    this.set(
      'muts',
      this.muts,
      me.muts.map((m) => `<div class="m" title="${esc(MUTATIONS[m].name)}">${MUTATIONS[m].icon}</div>`).join('') +
        me.hyb.map((h) => `<div class="h" title="${esc(HYBRIDS[h].effect)}">${HYBRIDS[h].icon} ${esc(HYBRIDS[h].name)}</div>`).join(''),
    );

    const t = Math.ceil(g.timeLeft);
    const label = g.phase === 'waiting' ? 'Aguardando jogadores' : g.phase === 'preparing' ? `Começa em ${t}s` : g.phase === 'finished' ? 'Partida encerrada' : '';
    this.text('timer', this.timer, g.phase === 'playing' ? `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}` : g.phase === 'preparing' ? String(t) : '--:--');
    this.timer.classList.toggle('warn', g.phase === 'playing' && t <= 30);
    this.text('phase', this.phase, label);

    const rows = g.leaderboard
      .map(([id, name, score, bot], i) => `<div class="r${id === me.id ? ' me' : ''}"><span class="p">${i + 1}</span><span class="n">${esc(name)}${bot ? '<span class="tag-bot">BOT</span>' : ''}</span><span class="s">${score}</span></div>`)
      .join('');
    const inTop = g.leaderboard.some(([id]) => id === me.id);
    const mine = !inTop && g.rank ? `<div class="sep"></div><div class="r me"><span class="p">${g.rank}</span><span class="n">Você</span><span class="s">${me.sc}</span></div>` : '';
    this.set('board', this.board, rows + mine);
    this.board.classList.toggle('collapsed', this.boardCollapsed);
    const chip = this.streak >= 2 ? `<span class="streak-chip">🔥 ${this.streak}</span>` : '';
    this.set('net', this.net, esc(this.showStats ? `${g.conn.kind === 'online' ? `${g.ping} ms` : 'offline'} · ${me.k} abates` : `${me.k} abates · ${me.d} mortes`) + chip);

    this.updatePowers(g);

    if (!me.alive && g.phase !== 'finished') {
      this.death.classList.remove('hidden');
      const why = this.killerName ? `Devorado por ${esc(this.killerName)}` : 'Você foi eliminado';
      this.set('death', this.death, `<div class="big">${why}</div><div class="muted">Você mantém metade da biomassa. As mutações acima do novo nível se perdem.</div><div>Renascendo em</div><div class="count">${Math.ceil(me.respawnIn)}</div>`);
    } else this.death.classList.add('hidden');

    this.updateOffer(g);
  }

  private updatePowers(g: ClientGame) {
    const me = g.me!;
    const list = me.abilities;
    for (let i = 0; i < this.pbtns.length; i++) {
      const b = this.pbtns[i]!;
      const ab = list[i] ?? null;
      if (i === 0 && !ab) {
        const st = 'none';
        if (b.state !== st) {
          b.state = st;
          b.el.classList.remove('hidden', 'ready', 'eq');
          b.el.classList.add('none');
          b.ic.textContent = '🧬';
          b.lb.textContent = 'Evolua';
          b.ct.textContent = '';
          b.cd.style.setProperty('--p', '0%');
        }
        continue;
      }
      if (!ab) {
        if (b.state !== 'off') {
          b.state = 'off';
          b.el.classList.add('hidden');
        }
        continue;
      }
      const cd = me.cds[ab] ?? 0;
      const max = me.cdMax[ab] ?? 1;
      const pct = cd > 0 ? Math.round((cd / max) * 100) : 0;
      const st = `${ab}|${pct}|${Math.ceil(cd)}|${me.equipped === i}`;
      if (b.state === st) continue;
      b.state = st;
      b.el.classList.remove('hidden', 'none');
      b.el.classList.toggle('ready', cd <= 0);
      b.el.classList.toggle('eq', me.equipped === i);
      b.ic.textContent = ABILITY_ICON[ab];
      b.lb.textContent = ABILITY_LABEL[ab];
      b.cd.style.setProperty('--p', `${pct}%`);
      b.ct.textContent = cd > 0 ? String(Math.ceil(cd)) : '';
      b.el.setAttribute('aria-label', `Usar ${ABILITY_LABEL[ab]}`);
    }
  }

  private updateOffer(g: ClientGame) {
    const o = g.offer;
    const me = g.me!;
    if (!o || g.phase === 'finished') {
      if (this.offerShown !== -1) this.resetOffer();
      return;
    }
    const left = Math.max(0, Math.ceil((o.expiresAt - performance.now()) / 1000));
    if (this.evoMinimized) {
      this.evoPanel.classList.add('hidden');
      this.evoPill.classList.remove('hidden');
      this.text('pill', this.evoPill, `🧬 Evoluir! (${left}s)`);
      return;
    }
    this.evoPill.classList.add('hidden');
    this.evoPanel.classList.remove('hidden');
    if (this.offerShown !== o.id) {
      this.offerShown = o.id;
      const cards = o.opts
        .map((id, i) => {
          const m = MUTATIONS[id];
          const hy = hybridsCompletedBy(me.muts, id).map((h) => `⚡ Forma ${HYBRIDS[h].icon} ${HYBRIDS[h].name}`).join('<br>');
          const catColor = m.category === 'mobilidade' ? '#ffb547' : m.category === 'defesa' ? '#7ef0d8' : '#ff8fd0';
          return `<button class="card" type="button" data-m="${id}" style="${hy ? 'border-color:var(--gold)' : ''}">
            <span class="ic">${m.icon}</span><span class="nm">${esc(m.name)}</span>
            <span class="cat" style="color:${catColor}">${m.category}${m.ability ? ' · poder' : ' · passiva'}</span>
            <span class="ef">${esc(m.effect)}</span>${hy ? `<span class="hy">${hy}</span>` : ''}<span class="key">Tecla ${i + 1}</span></button>`;
        })
        .join('');
      this.evoPanel.innerHTML = `<div class="evo-head"><span class="t">🧬 EVOLUÇÃO! Escolha <span class="left"></span></span><button type="button" class="min">ocultar</button></div><div class="evo-cards">${cards}</div>`;
    }
    const leftEl = this.evoPanel.querySelector('.left');
    if (leftEl) leftEl.textContent = `(${left}s)`;
  }
}
