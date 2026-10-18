// Gera um vídeo vertical (1080x1920, ~33 s, com música do jogo) de uma partida jogada por uma IA, para o TikTok.
// Uso: BASE_URL=https://mutant-io.onrender.com node tools/video/make-clip.mjs [saida.mp4] [--dia=N] [--seed=N]
// Precisa de Playwright (Chromium) e ffmpeg. A partida é o treino offline (mesma simulação do servidor, contra bots).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:2567';
const args = process.argv.slice(2);
const OUT = resolve(args.find((a) => !a.startsWith('--')) || 'clip.mp4');
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || d;
const DAY = Number(opt('dia', '1'));
let seed = Number(opt('seed', String(Date.now() % 100000)));
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];

const GAMEPLAY_SEC = 30;
const ENDCARD_SEC = 3;
const FPS = 30;
const TMP = join(OUT + '.frames');
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const NAMES = ['Glorp', 'Zigoto', 'Mutantinho', 'Ameboide', 'Dr. Gosma', 'Bactéria Brava', 'Célula Rebelde', 'Protozilla'];
// sempre deixa claro que quem joga é uma IA
const HOOKS = [
  'Dia {d}: uma IA tentando virar o maior mutante',
  'Dia {d}: a IA consegue ir de célula a predador em 30s?',
  'Dia {d}: qual mutação a IA vai escolher hoje?',
  'Dia {d}: será que a IA forma um híbrido raro?',
  'Dia {d}: IA sobrevivendo na arena dos mutantes',
  'Dia {d}: IA vs bots — chuva de biomassa e muita mordida',
];
const name = pick(NAMES);
const hook = pick(HOOKS).replace('{d}', String(DAY));

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}/?duracao=600`);
await wait(1200);
await page.fill('#name', name);
await page.click('#practice');
await page.waitForFunction(() => window.__mutant.game?.phase === 'playing', null, { timeout: 20000 });
await page.addStyleTag({
  content: `
  .mode-tag, .evo-panel, .evo-pill { display: none !important; }
  #mx-cap { position: fixed; left: 50%; top: 27%; transform: translateX(-50%); width: 88%; z-index: 50; text-align: center;
    font: 800 22px/1.15 system-ui, sans-serif; color: #fff; text-shadow: 0 3px 0 #000, 0 0 12px #000;
    background: rgba(5,10,22,.55); padding: 10px 12px; border-radius: 16px; border: 2px solid rgba(125,255,106,.6); pointer-events: none; }
  #mx-end { position: fixed; inset: 0; z-index: 60; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
    background: radial-gradient(circle at 50% 40%, #12301a, #04060d 70%); color: #fff; font-family: system-ui, sans-serif; text-align: center; }
  #mx-end .l { font: 900 64px/1 system-ui, sans-serif; color: #7dff6a; text-shadow: 0 5px 0 #1d6b12, 0 0 30px rgba(125,255,106,.5); }
  #mx-end .l span { color: #ff5f8f; font-size: 34px; }
  #mx-end .s { font-size: 26px; font-weight: 700; }
  #mx-end .u { font-size: 24px; font-weight: 800; color: #0b1020; background: #7dff6a; padding: 10px 18px; border-radius: 99px; }
  #mx-end .t { font-size: 18px; color: #c9d6f2; }`,
});
await page.evaluate((hook) => {
  const c = document.createElement('div');
  c.id = 'mx-cap';
  c.textContent = hook;
  document.body.appendChild(c);
  const e = document.createElement('div');
  e.id = 'mx-end';
  e.innerHTML = '<div class="l">MUTANT<span>.IO</span></div><div class="s">Evolua. Combine mutações. Sobreviva.</div><div class="u">mutant-io.onrender.com</div><div class="t">Grátis no navegador do celular · multiplayer online</div>';
  document.body.appendChild(e);
}, hook);

// a IA assume o jogador: o mesmo "cérebro" dos bots decide para onde ir, quando usar poderes e qual mutação escolher.
// O cliente envia esse eixo como entrada normal, então o servidor (aqui, a simulação local) continua mandando em tudo.
await page.evaluate((s) => {
  const app = window.__mutant;
  const w = app.game.conn.room.world;
  const me = [...w.players.values()].find((p) => !p.isBot);
  const Brain = [...w.players.values()].find((p) => p.bot).bot.constructor;
  let x = s;
  const r = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const brain = new Brain('dificil', r);
  // começo acelerado para o vídeo ter evolução e briga logo nos primeiros segundos, no meio da arena
  me.x = w.W / 2 + (r() - 0.5) * 500;
  me.y = w.H / 2 + (r() - 0.5) * 500;
  w.gainBiomass(me, 70, false);
  w.nextRainAt = w.t + 9;
  w.nextSuperAt = w.t + 3;
  // rivais por perto
  let k = 0;
  for (const o of w.players.values()) {
    if (o === me || k >= 3) continue;
    const a = r() * Math.PI * 2;
    o.x = Math.max(200, Math.min(w.W - 200, me.x + Math.cos(a) * (380 + k * 90)));
    o.y = Math.max(200, Math.min(w.H - 200, me.y + Math.sin(a) * (380 + k * 90)));
    // rivais por perto começam menores: a IA tem chance real de caçar (o resto da arena segue normal)
    o.biomass = Math.min(o.biomass, 12);
    o.level = Math.min(o.level, 1);
    o.mutations = o.mutations.slice(0, o.level);
    w.recompute(o);
    o.hp = o.stats.maxHp;
    k++;
  }
  let axis = [0, 0];
  app.controls.axis = () => axis;
  // câmera mais perto: as criaturas aparecem maiores no celular
  const zf = app.renderer.zoomFor.bind(app.renderer);
  app.renderer.zoomFor = (rad) => zf(rad) * 1.45;
  setInterval(() => {
    brain.update(w, me, 1 / 30);
    axis = [me.lastInput.x, me.lastInput.y];
  }, 1000 / 30);
}, Math.floor(rand() * 1e6) + 1);

// grava a tela com o screencast do Chromium (quadros JPEG com horário), depois o ffmpeg monta 30 fps constantes
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp, data: f.data });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1080, maxHeight: 1920, everyNthFrame: 1 });
await wait(3500);
await page.evaluate(() => (document.getElementById('mx-cap').style.top = '25%'));
await wait(GAMEPLAY_SEC * 1000 - 3500);
await page.evaluate(() => {
  document.getElementById('mx-cap').style.display = 'none';
  document.getElementById('mx-end').style.display = 'flex';
});
await wait(ENDCARD_SEC * 1000);
await cdp.send('Page.stopScreencast');
await wait(300);

// música do jogo renderizada sem tempo real
const wavB64 = await page.evaluate(async (secs) => {
  const Music = window.__mutant.audio.music.constructor;
  const buf = await Music.renderOffline('game', secs, true);
  const n = buf.length;
  const ch = [buf.getChannelData(0), buf.getChannelData(1)];
  const out = new DataView(new ArrayBuffer(44 + n * 4));
  const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); out.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 2, true); out.setUint32(24, 44100, true);
  out.setUint32(28, 44100 * 4, true); out.setUint16(32, 4, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 4, true);
  for (let i = 0; i < n; i++) for (let c = 0; c < 2; c++) out.setInt16(44 + i * 4 + c * 2, Math.max(-1, Math.min(1, ch[c][i])) * 0x7fff, true);
  let s = '';
  const u8 = new Uint8Array(out.buffer);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}, GAMEPLAY_SEC + ENDCARD_SEC);
const stats = await page.evaluate(() => {
  const w = window.__mutant.game.conn.room.world;
  const me = [...w.players.values()].find((p) => !p.isBot);
  return { level: me.level, kills: me.kills, mutations: me.mutations, hybrids: me.hybrids, score: Math.floor(me.score) };
});
await b.close();
writeFileSync(join(TMP, 'music.wav'), Buffer.from(wavB64, 'base64'));

if (frames.length < 30) throw new Error(`poucos quadros gravados: ${frames.length}`);
// lista de quadros com duração real de cada um
let list = '';
frames.forEach((f, i) => {
  const file = `f${String(i).padStart(5, '0')}.jpg`;
  writeFileSync(join(TMP, file), Buffer.from(f.data, 'base64'));
  const next = frames[i + 1];
  const dur = next ? Math.max(0.001, next.t - f.t) : 1 / FPS;
  list += `file '${file}'\nduration ${dur.toFixed(4)}\n`;
});
list += `file 'f${String(frames.length - 1).padStart(5, '0')}.jpg'\n`;
writeFileSync(join(TMP, 'list.txt'), list);
execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error',
  '-f', 'concat', '-safe', '0', '-i', join(TMP, 'list.txt'),
  '-i', join(TMP, 'music.wav'),
  '-vf', `scale=1080:1920:flags=lanczos,fps=${FPS},format=yuv420p`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-profile:v', 'high',
  '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart',
  OUT,
]);
rmSync(TMP, { recursive: true, force: true });
const realFps = (frames.length / (frames.at(-1).t - frames[0].t)).toFixed(1);
console.log(JSON.stringify({ out: OUT, hook, name, frames: frames.length, captureFps: Number(realFps), ...stats, errors }));
