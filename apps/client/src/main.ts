import { HYBRID_IDS, HYBRIDS, MUTATION_IDS, MUTATIONS, sanitizeRoomCode, type GameEvent, type HybridId, type JoinMode, type MutationId, type ResultRow } from '@mutant/shared';
import { viewport, tryFullscreen } from './ui/viewport.js';
import { Audio } from './audio/sfx.js';
import { addDiscoveries, loadDiscoveries, loadSettings, saveSettings, type Settings } from './config/settings.js';
import { Controls } from './input/controls.js';
import { LocalConnection, WsConnection, defaultServerUrl, type Connection } from './net/connection.js';
import { ClientGame } from './net/game.js';
import { drawCreature } from './render/creature.js';
import { Renderer } from './render/renderer.js';
import { Hud } from './ui/hud.js';
import { AccountClient } from './net/account.js';
import { Shop } from './ui/shop.js';
import { copyText, downloadBlob, drawShareCard, mutantName, shareCard } from './ui/sharecard.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

type Screen = 'title' | 'matching' | 'game' | 'results' | 'shop';

class App {
  settings: Settings = loadSettings();
  audio = new Audio();
  renderer = new Renderer($('game') as HTMLCanvasElement, $('minimap') as HTMLCanvasElement);
  controls = new Controls($('game'));
  hud = new Hud();
  game: ClientGame | null = null;
  screen: Screen = 'title';
  lastJoin: { mode: JoinMode; code?: string; offline: boolean } = { mode: 'public', offline: false };
  token = '';
  reconnectTries = 0;
  welcomeTimer = 0;
  lastFrame = performance.now();
  lastResults: { row: ResultRow; placement: number; total: number } | null = null;
  serverUp = false;
  account = new AccountClient();
  shop = new Shop(this.account);
  private qualityApplied = false;

  constructor() {
    this.applySettings();
    const nameEl = $<HTMLInputElement>('name');
    nameEl.value = this.settings.name;
    nameEl.addEventListener('change', () => {
      this.settings.name = nameEl.value.slice(0, 16);
      saveSettings(this.settings);
    });
    const invite = sanitizeRoomCode(new URLSearchParams(location.search).get('sala'));
    if (invite) {
      $<HTMLInputElement>('code').value = invite;
      $('join-code').classList.add('primary');
    }

    $('play').onclick = () => this.startOnline('public');
    $('create').onclick = () => this.startOnline('create');
    $('join-code').onclick = () => {
      const c = sanitizeRoomCode($<HTMLInputElement>('code').value);
      if (!c) return this.flashStatus('Código inválido (4–8 letras/números).');
      this.startOnline('code', c);
    };
    $('practice').onclick = () => this.startOffline();
    $('open-shop').onclick = () => this.openShop();
    this.shop.onClose = () => this.setScreen('title');
    this.shop.onToast = (t, k) => this.hud.toast(t, k);
    // volta da página de pagamento: ?pedido=…&pagamento=aprovado|pendente|recusado
    const qs = new URLSearchParams(location.search);
    const pedido = qs.get('pedido');
    if (pedido && /^ord_[a-f0-9]{24}$/.test(pedido)) {
      const hint = qs.get('pagamento') ?? undefined;
      history.replaceState(null, '', location.pathname);
      void this.openShop().then(() => this.shop.watchOrder(pedido, true, hint));
    }
    $('cancel-match').onclick = () => this.toMenu();
    $('open-help').onclick = () => this.openHelp();
    $('open-codex').onclick = () => this.openCodex();
    $('open-settings').onclick = () => this.openSettings();
    $('modal').querySelector('.modal-close')!.addEventListener('click', () => this.closeModal());
    $('modal').addEventListener('click', (e) => {
      if (e.target === $('modal')) this.closeModal();
    });
    $('rematch').onclick = () => this.rematch();
    $('to-menu').onclick = () => this.toMenu();
    $('share').onclick = () => void this.share();
    $('download').onclick = () => this.download();
    $('copy-build').onclick = () => void this.copyBuild();

    this.hud.onPick = (m) => this.pick(m);
    this.hud.onPower = (i) => this.useAbility(i);
    this.hud.menuBtn.onclick = () => this.openGameMenu();
    this.hud.roomChip.onclick = () => void this.invite();
    this.controls.onAbility = () => this.useAbility();
    this.controls.onSwap = () => this.swap();
    this.controls.onDigit = (i) => {
      const o = this.game?.offer;
      if (o && i < 3 && o.opts[i]) this.pick(o.opts[i]!);
      else this.useAbility(i);
    };
    this.controls.onToggleBoard = () => (this.hud.boardCollapsed = !this.hud.boardCollapsed);
    this.renderer.onSelfEvent = (e) => this.onSelfEvent(e);

    // qualquer gesto destrava o áudio
    window.addEventListener('pointerdown', () => this.audio.unlock(), { passive: true });
    window.addEventListener('keydown', () => this.audio.unlock());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.game?.sendIdle();
    });

    this.updateCodexCount();
    void this.checkServer();
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ------------------------------------------------------------ */
  /* telas                                                          */
  /* ------------------------------------------------------------ */

  setScreen(s: Screen) {
    this.screen = s;
    $('title').classList.toggle('hidden', s !== 'title');
    $('matching').classList.toggle('hidden', s !== 'matching');
    $('results').classList.toggle('hidden', s !== 'results');
    if (s !== 'shop' && this.shop?.isOpen) this.shop.close();
    this.hud.show(s === 'game' || s === 'results');
    this.controls.enabled = s === 'game';
    if (s !== 'game') this.controls.reset();
  }

  flashStatus(text: string, ok = false) {
    const st = $('status');
    st.className = `status ${ok ? 'ok' : 'bad'}`;
    st.querySelector('.st-txt')!.textContent = text;
  }

  async checkServer() {
    if (location.protocol === 'file:') {
      this.flashStatus('Sem servidor — jogue o treino offline.');
      return;
    }
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 3000);
      const r = await fetch('/health', { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const j = (await r.json()) as { ok: boolean; players: number };
      this.serverUp = !!j.ok;
      this.flashStatus(`Servidor online · ${j.players} jogando agora`, true);
    } catch {
      this.serverUp = false;
      this.flashStatus('Servidor indisponível — jogue o treino offline.');
    }
  }

  /* ------------------------------------------------------------ */
  /* conexão                                                        */
  /* ------------------------------------------------------------ */

  private playerName() {
    const n = $<HTMLInputElement>('name').value.trim().slice(0, 16);
    this.settings.name = n;
    saveSettings(this.settings);
    return n || 'Mutante';
  }

  async openShop() {
    this.audio.unlock();
    this.setScreen('shop');
    await this.shop.open(location.protocol === 'file:' || location.hostname.endsWith('claudeusercontent.com') || location.hostname.endsWith('claude.ai') ? 'offline' : 'online');
  }

  /** No celular, entrar em tela cheia ao começar (o jogo ocupa a tela inteira, sem barras do navegador). */
  private enterPlayMode() {
    if (viewport.size.coarse && this.settings.autoFullscreen) void tryFullscreen();
  }

  startOnline(mode: JoinMode, code?: string) {
    this.audio.unlock();
    this.enterPlayMode();
    this.lastJoin = { mode, code, offline: false };
    this.token = '';
    this.reconnectTries = 0;
    $('matching-title').textContent = mode === 'create' ? 'Criando sala privada…' : mode === 'code' ? `Entrando na sala ${code}…` : 'Procurando partida…';
    $('matching-sub').textContent = '';
    this.setScreen('matching');
    this.connect(new WsConnection(defaultServerUrl()));
  }

  startOffline() {
    this.audio.unlock();
    this.enterPlayMode();
    this.lastJoin = { mode: 'public', offline: true };
    this.token = '';
    $('matching-title').textContent = 'Preparando treino offline…';
    $('matching-sub').textContent = 'Partida local contra bots. Para jogar com pessoas, use “Jogar online”.';
    this.setScreen('matching');
    this.connect(new LocalConnection());
  }

  private connect(conn: Connection) {
    this.game?.conn.close();
    const g = new ClientGame(conn);
    this.game = g;
    this.renderer.fx.clear();
    this.hud.resetOffer();
    this.hud.modeTag.classList.toggle('hidden', conn.kind !== 'offline');
    conn.onOpen = () => {
      conn.send({ t: 'join', name: this.playerName(), mode: this.lastJoin.mode, code: this.lastJoin.code, token: this.token || undefined, look: this.account.look, acct: this.account.secret ?? undefined });
    };
    conn.onClose = (clean) => {
      if (this.game !== g) return;
      if (clean) return;
      if (this.screen === 'matching' && !g.welcome) {
        this.toMenu();
        this.flashStatus('Não foi possível conectar ao servidor. Tente o treino offline.');
        return;
      }
      this.tryReconnect();
    };
    g.onWelcome = (w) => {
      const wasRetry = this.reconnectTries > 0;
      this.token = w.token;
      this.reconnectTries = 0;
      clearTimeout(this.welcomeTimer);
      this.renderer.seedDecor(w.matchId);
      if (this.screen !== 'results') this.setScreen('game');
      if (w.reconnected) this.hud.toast('Reconectado!', 'good');
      else if (wasRetry) this.hud.toast('Não foi possível retomar a sessão anterior; você entrou numa nova.', 'warn');
      const chip = this.hud.roomChip;
      chip.classList.toggle('hidden', conn.kind !== 'online');
      chip.textContent = `🔗 ${w.room.private ? 'Sala ' + w.room.code : 'Convidar'}`;
      if (conn.kind === 'online') history.replaceState(null, '', `?sala=${w.room.code}`);
    };
    g.onToast = (t, k) => this.hud.toast(t, k);
    g.onError = (_c, msg) => {
      this.toMenu();
      this.flashStatus(msg);
    };
    g.onKicked = (reason) => {
      this.toMenu();
      this.flashStatus(`Desconectado: ${reason}`);
    };
    g.onResults = () => setTimeout(() => this.showResults(), 1200);
    g.onNewMatch = () => {
      this.hud.resetOffer();
      this.hud.killerName = '';
      this.renderer.fx.clear();
      this.renderer.seedDecor(g.results?.matchId ?? Math.random() * 1000);
    };
    clearTimeout(this.welcomeTimer);
    this.welcomeTimer = window.setTimeout(() => {
      if (this.game === g && !g.welcome) {
        this.toMenu();
        this.flashStatus('O servidor não respondeu a tempo.');
      }
    }, 9000);
  }

  private tryReconnect() {
    if (this.lastJoin.offline || !this.token) return this.toMenu();
    if (this.reconnectTries >= 6) {
      this.toMenu();
      this.flashStatus('Conexão perdida. Não foi possível reconectar.');
      return;
    }
    this.reconnectTries++;
    this.hud.toast(`Conexão perdida — reconectando (${this.reconnectTries}/6)…`, 'warn');
    setTimeout(() => {
      if (!this.game) return;
      this.connect(new WsConnection(defaultServerUrl()));
    }, 800 * this.reconnectTries);
  }

  toMenu() {
    const g = this.game;
    this.game = null;
    if (g) {
      g.conn.send({ t: 'leave' });
      g.conn.close();
    }
    clearTimeout(this.welcomeTimer);
    this.hud.resetOffer();
    this.closeModal();
    if (location.search.includes('sala=') && !this.lastJoin.offline) history.replaceState(null, '', location.pathname);
    this.setScreen('title');
    void this.checkServer();
  }

  /* ------------------------------------------------------------ */
  /* ações                                                          */
  /* ------------------------------------------------------------ */

  useAbility(slot?: number) {
    const g = this.game;
    if (!g?.me || this.screen !== 'game') return;
    this.audio.unlock();
    if (!g.me.abilities.length) {
      this.hud.toast('Evolua para ganhar um poder.', 'info');
      return;
    }
    if (slot !== undefined && slot >= g.me.abilities.length) return;
    g.sendAbility(slot);
    if (slot !== undefined) g.me.equipped = slot;
  }

  swap() {
    const g = this.game;
    const me = g?.me;
    if (!g || !me || me.abilities.length < 2) return;
    const next = (me.equipped + 1) % me.abilities.length;
    g.equip(next);
    me.equipped = next;
    this.audio.play('click');
  }

  pick(m: MutationId) {
    this.game?.pick(m);
    this.hud.resetOffer();
    this.audio.play('click');
  }

  private lastHp = -1;
  private lastVibe = 0;
  /** Vibra 0,5 s no celular quando o jogador perde vida (com intervalo mínimo). */
  private checkDamage(g: ClientGame) {
    const me = g.me;
    if (!me) return;
    if (me.alive && this.lastHp >= 0 && me.hp < this.lastHp) {
      const now = performance.now();
      if (this.settings.vibration && now - this.lastVibe > 900) {
        this.lastVibe = now;
        try {
          navigator.vibrate?.(500);
        } catch {
          /* aparelho/navegador sem suporte */
        }
      }
    }
    this.lastHp = me.alive ? me.hp : -1;
  }

  onSelfEvent(e: GameEvent) {
    const g = this.game;
    if (!g) return;
    if (e.k === 'evo') {
      const fresh = addDiscoveries([e.m]);
      this.hud.showBanner(`${MUTATIONS[e.m].icon} ${MUTATIONS[e.m].name}`, fresh.length ? 'Nova mutação descoberta!' : 'Mutação adquirida');
      this.updateCodexCount();
    } else if (e.k === 'hybrid') {
      const fresh = addDiscoveries([e.h]);
      this.hud.showBanner(`${HYBRIDS[e.h].icon} HÍBRIDO: ${HYBRIDS[e.h].name}`, fresh.length ? 'Combinação rara descoberta!' : HYBRIDS[e.h].effect);
      this.updateCodexCount();
    } else if (e.k === 'kill' && e.b === g.myId) {
      this.hud.killerName = e.a >= 0 ? g.meta.get(e.a)?.name ?? 'um mutante' : '';
    }
  }

  /* ------------------------------------------------------------ */
  /* resultados e compartilhamento                                  */
  /* ------------------------------------------------------------ */

  showResults() {
    const g = this.game;
    const res = g?.results;
    if (!g || !res) return;
    const idx = res.rows.findIndex((r) => r.id === res.you);
    const row = res.rows[idx];
    if (!row) return;
    this.lastResults = { row, placement: idx + 1, total: res.rows.length };
    addDiscoveries([...row.muts, ...row.hyb] as (MutationId | HybridId)[]);
    this.updateCodexCount();
    const winner = res.rows[0]!;
    $('results').querySelector('.res-title')!.textContent = idx === 0 ? '🏆 Vitória!' : `Fim da partida — vencedor: ${winner.name}`;
    $('results').querySelector('.placement')!.innerHTML = `<b>#${idx + 1}</b> de ${res.rows.length} · ${row.score} pontos`;
    const show = res.rows.slice(0, 10);
    if (idx >= 10) show.push(row);
    $('results').querySelector('.res-table')!.innerHTML = `<table><tr><th>#</th><th>Mutante</th><th>Pts</th><th>Abates</th><th class="col-opt">Nível</th><th class="col-opt">Build</th></tr>${show
      .map(
        (r) =>
          `<tr class="${r.id === res.you ? 'me' : ''}"><td>${res.rows.indexOf(r) + 1}</td><td class="nm">${esc(r.name)}${r.bot ? '<span class="tag-bot">BOT</span>' : ''} ${r.hyb.map((h) => HYBRIDS[h].icon).join('')}</td><td>${r.score}</td><td>${r.kills}</td><td class="col-opt">${r.maxLevel}</td><td class="col-opt">${r.build}</td></tr>`,
      )
      .join('')}</table>`;
    drawShareCard($('card') as HTMLCanvasElement, row, idx + 1, res.rows.length, mutantName(row));
    $('results').querySelector('.share-status')!.textContent = '';
    $('rematch').textContent = g.conn.kind === 'offline' ? 'Jogar de novo' : 'Revanche';
    this.setScreen('results');
  }

  private shareText() {
    const r = this.lastResults;
    if (!r) return 'MUTANT.IO';
    const hy = r.row.hyb.map((h) => HYBRIDS[h].name).join(', ');
    return `Meu mutante "${mutantName(r.row)}" ficou em #${r.placement} de ${r.total} com ${r.row.score} pontos no MUTANT.IO!${hy ? ` Híbridos: ${hy}.` : ''} Build ${r.row.build}`;
  }

  private shareUrl() {
    const code = this.game?.welcome?.room.code;
    const base = location.origin + location.pathname;
    return this.game?.conn.kind === 'online' && code ? `${base}?sala=${code}` : base;
  }

  private setShareStatus(t: string) {
    $('results').querySelector('.share-status')!.textContent = t;
  }

  async share() {
    const out = await shareCard($('card') as HTMLCanvasElement, this.shareText(), this.shareUrl());
    this.setShareStatus(
      out === 'shared'
        ? 'Enviado para o compartilhamento do sistema.'
        : out === 'cancelled'
          ? 'Compartilhamento cancelado.'
          : out === 'downloaded'
            ? 'Compartilhamento não suportado aqui: download da imagem solicitado ao navegador.'
            : out === 'copied'
              ? 'Texto copiado para a área de transferência.'
              : 'Não foi possível compartilhar neste navegador.',
    );
  }

  download() {
    ($('card') as HTMLCanvasElement).toBlob((b) => {
      const ok = b ? downloadBlob(b) : false;
      this.setShareStatus(ok ? 'Download solicitado ao navegador. Se nada aparecer, ele foi bloqueado nesta página.' : 'Não foi possível gerar a imagem.');
    }, 'image/png');
  }

  async copyBuild() {
    const r = this.lastResults;
    if (!r) return;
    const ok = await copyText(`${r.row.build} — ${r.row.muts.map((m) => MUTATIONS[m].name).join(' → ')}`);
    this.setShareStatus(ok ? `Build ${r.row.build} copiada.` : `Copie manualmente: ${r.row.build}`);
  }

  async invite() {
    const url = this.shareUrl();
    const nav = navigator as Navigator;
    try {
      if (nav.share) {
        await nav.share({ title: 'MUTANT.IO', text: 'Entra na minha sala do MUTANT.IO!', url });
        this.hud.toast('Convite enviado ao compartilhamento do sistema.', 'good');
        return;
      }
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return;
    }
    const ok = await copyText(url);
    this.hud.toast(ok ? 'Link de convite copiado!' : `Convite: ${url}`, ok ? 'good' : 'info');
  }

  rematch() {
    this.setScreen('game');
    this.hud.resetOffer();
    if (this.game?.phase === 'finished') this.hud.toast('A próxima partida começa em instantes.', 'info');
  }

  /* ------------------------------------------------------------ */
  /* modais                                                         */
  /* ------------------------------------------------------------ */

  openModal(html: string) {
    $('modal').querySelector('.modal-body')!.innerHTML = html;
    $('modal').classList.remove('hidden');
  }
  closeModal() {
    $('modal').classList.add('hidden');
  }

  openHelp() {
    this.openModal(`<h2>Como jogar</h2>
      <p>Você começa como um organismo simples. <b>Colete biomassa</b> (bolinhas verdes; douradas valem mais) para evoluir. A cada nível, <b>escolha 1 de 3 mutações</b>. Algumas combinações formam <b>híbridos</b> com efeitos especiais.</p>
      <h3>Controles</h3>
      <div class="keys">
        <span><kbd>WASD</kbd>/<kbd>Setas</kbd></span><span>Mover</span>
        <span><kbd>Espaço</kbd></span><span>Usar o poder selecionado</span>
        <span><kbd>1</kbd>…<kbd>6</kbd></span><span>Usar o poder daquele botão (com cartas abertas: <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> escolhem a mutação)</span>
        <span><kbd>Q</kbd>/<kbd>E</kbd></span><span>Trocar o poder selecionado</span>
        <span><kbd>Tab</kbd></span><span>Expandir placar</span>
        <span>📱 Toque</span><span>Arraste no lado esquerdo para mover. Cada poder tem seu botão à direita. As cartas de evolução podem ser tocadas com o outro dedo sem soltar o joystick.</span>
      </div>
      <h3>Regras</h3>
      <ul>
        <li><b>Mordida automática</b>: encostar num rival morde. Quem tem mais nível e as mutações certas vence.</li>
        <li><b>Zonas de energia</b> ⚡ dão biomassa e pontos, mas revelam você no minimapa de todos e cancelam a camuflagem.</li>
        <li><b>Ácido</b> ☣ causa dano contínuo.</li>
        <li>Ao ser eliminado, você renasce em 4s com <b>metade da biomassa</b>; mutações acima do novo nível se perdem.</li>
        <li>A partida dura 6 minutos. Vence quem tiver mais pontos (desempate: abates, depois menos mortes).</li>
        <li>Quem entra no meio da partida recebe um pequeno bônus de biomassa para não ficar para trás.</li>
        <li>Bots são marcados com <b>BOT</b> e seguem as mesmas regras.</li>
      </ul>`);
  }

  openCodex() {
    const d = loadDiscoveries();
    const item = (id: string, icon: string, name: string, sub: string, txt: string) =>
      `<div class="item ${d.has(id) ? '' : 'locked'}"><b>${icon} ${esc(name)} ${d.has(id) ? '✓' : ''}</b><div class="muted">${esc(sub)}</div><div>${esc(txt)}</div></div>`;
    const muts = MUTATION_IDS.map((id) => {
      const m = MUTATIONS[id];
      return item(id, m.icon, m.name, `${m.category}${m.ability ? ' · ativa' : ' · passiva'}`, `${m.effect} Contra: ${m.counterplay}`);
    }).join('');
    const hy = HYBRID_IDS.map((id) => {
      const h = HYBRIDS[id];
      return item(id, h.icon, h.name, `${MUTATIONS[h.requires[0]].name} + ${MUTATIONS[h.requires[1]].name}`, h.effect);
    }).join('');
    this.openModal(`<h2>Registro de mutações (${d.size}/16)</h2><p class="muted">Itens com ✓ já foram descobertos neste dispositivo.</p><h3>Mutações</h3><div class="codex">${muts}</div><h3>Híbridos</h3><div class="codex">${hy}</div>`);
  }

  updateCodexCount() {
    $('codex-count').textContent = `(${loadDiscoveries().size}/16)`;
  }

  openSettings() {
    const s = this.settings;
    this.openModal(`<h2>Configurações</h2>
      <label class="setting"><span>Efeitos sonoros</span><input id="s-vol" type="range" min="0" max="1" step="0.05" value="${s.volume}"></label>
      <label class="setting"><span>Música</span><input id="s-mus" type="range" min="0" max="1" step="0.05" value="${s.music}"></label>
      <label class="setting"><span>Qualidade gráfica</span><select id="s-q"><option value="auto" ${s.quality === 'auto' ? 'selected' : ''}>Automática (recomendado)</option><option value="alta" ${s.quality === 'alta' ? 'selected' : ''}>Alta</option><option value="baixa" ${s.quality === 'baixa' ? 'selected' : ''}>Baixa (celulares modestos)</option></select></label>
      <label class="setting"><span>Tela cheia automática no celular</span><input id="s-afs" type="checkbox" ${s.autoFullscreen ? 'checked' : ''}></label>
      <label class="setting"><span>Vibrar ao sofrer dano</span><input id="s-vib" type="checkbox" ${s.vibration ? 'checked' : ''}></label>
      <label class="setting"><span>Controles de toque</span><select id="s-hand"><option value="0" ${!s.leftHanded ? 'selected' : ''}>Joystick à esquerda</option><option value="1" ${s.leftHanded ? 'selected' : ''}>Joystick à direita (canhoto)</option></select></label>
      <label class="setting"><span>Mostrar ping</span><input id="s-stats" type="checkbox" ${s.showStats ? 'checked' : ''}></label>
      <div class="setting"><span>Tela cheia</span><button class="btn small" id="s-fs" type="button">Alternar</button></div>`);
    const save = () => {
      saveSettings(this.settings);
      this.applySettings();
    };
    $<HTMLInputElement>('s-vol').oninput = (e) => {
      s.volume = Number((e.target as HTMLInputElement).value);
      save();
      this.audio.play('click');
    };
    $<HTMLInputElement>('s-mus').oninput = (e) => {
      s.music = Number((e.target as HTMLInputElement).value);
      save();
    };
    $<HTMLSelectElement>('s-q').onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      s.quality = v === 'baixa' ? 'baixa' : v === 'alta' ? 'alta' : 'auto';
      save();
    };
    $<HTMLInputElement>('s-afs').onchange = (e) => {
      s.autoFullscreen = (e.target as HTMLInputElement).checked;
      save();
    };
    $<HTMLInputElement>('s-vib').onchange = (e) => {
      s.vibration = (e.target as HTMLInputElement).checked;
      save();
      if (s.vibration) {
        try {
          navigator.vibrate?.(150);
        } catch {
          /* sem suporte */
        }
      }
    };
    $<HTMLSelectElement>('s-hand').onchange = (e) => {
      s.leftHanded = (e.target as HTMLSelectElement).value === '1';
      save();
    };
    $<HTMLInputElement>('s-stats').onchange = (e) => {
      s.showStats = (e.target as HTMLInputElement).checked;
      save();
    };
    $('s-fs').onclick = () => {
      if (document.fullscreenElement) void document.exitFullscreen?.();
      else void document.documentElement.requestFullscreen?.().catch(() => this.hud.toast('Tela cheia não suportada aqui.', 'info'));
    };
  }

  openGameMenu() {
    this.openModal(`<h2>Menu</h2><p class="muted">O jogo continua rodando — partidas online não pausam.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button class="btn primary" id="gm-back" type="button">Continuar</button>
        <button class="btn" id="gm-settings" type="button">Configurações</button>
        <button class="btn" id="gm-help" type="button">Como jogar</button>
        <button class="btn" id="gm-quit" type="button">Sair da partida</button>
      </div>`);
    $('gm-back').onclick = () => this.closeModal();
    $('gm-settings').onclick = () => this.openSettings();
    $('gm-help').onclick = () => this.openHelp();
    $('gm-quit').onclick = () => this.toMenu();
  }

  applySettings() {
    const s = this.settings;
    this.audio.setVolume(s.volume);
    this.audio.music.setVolume(s.music);
    if (this.renderer.quality !== s.quality || !this.qualityApplied) {
      this.renderer.setQuality(s.quality);
      this.qualityApplied = true;
    }
    this.controls.leftHanded = s.leftHanded;
    this.hud.setLefty(s.leftHanded);
    document.body.classList.toggle('lefty', s.leftHanded);
    this.hud.showStats = s.showStats;
  }

  /* ------------------------------------------------------------ */
  /* laço principal                                                 */
  /* ------------------------------------------------------------ */

  private previewT = 0;
  private previewMuts = new Set<MutationId>();
  private previewHyb = new Set<HybridId>();

  private drawPreview(dt: number) {
    const c = $('preview') as HTMLCanvasElement;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    this.previewT += dt;
    if (this.previewT > 2.2 || !this.previewMuts.size) {
      this.previewT = 0;
      const pool = [...MUTATION_IDS].sort(() => Math.random() - 0.5).slice(0, 2 + Math.floor(Math.random() * 3));
      this.previewMuts = new Set(pool);
      this.previewHyb = new Set(HYBRID_IDS.filter((h) => HYBRIDS[h].requires.every((r) => this.previewMuts.has(r))));
    }
    ctx.clearRect(0, 0, c.width, c.height);
    const t = performance.now() / 1000;
    drawCreature(ctx, { x: 130, y: 100, r: 42, hue: (t * 20) % 360, fx: Math.cos(t * 0.6), fy: Math.sin(t * 0.6) * 0.4, vx: 80, vy: 0, muts: this.previewMuts, hyb: this.previewHyb, flags: 0, alpha: 1, seed: 7, level: this.previewMuts.size + 2 }, t, true);
  }

  loop(t: number) {
    const dt = Math.min(0.1, (t - this.lastFrame) / 1000);
    this.lastFrame = t;
    const g = this.game;
    if (g && g.welcome) {
      g.update(dt, this.controls.axis(), this.screen !== 'game' || !$('modal').classList.contains('hidden'));
      this.renderer.frame(g, dt, this.audio);
      this.hud.update(g, dt);
      this.checkDamage(g);
      this.audio.music.play('game');
      this.audio.music.intense = g.phase === 'playing' && g.timeLeft <= 30;
      if (this.screen === 'results' && g.phase === 'playing' && !g.results) {
        this.setScreen('game');
        this.hud.toast('Nova partida começou!', 'good');
      }
    } else if (this.screen === 'title' || this.screen === 'matching' || this.screen === 'shop') {
      this.drawPreview(dt);
      this.renderer.backdrop(dt);
      this.audio.music.play('title');
    }
    requestAnimationFrame((tt) => this.loop(tt));
  }
}

const app = new App();
// gancho de diagnóstico usado pelos testes de ponta a ponta
(window as unknown as { __mutant: App }).__mutant = app;
