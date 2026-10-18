// Coloca as vozes dos personagens no vídeo: lê <video>.voice.json (falas com horário), sintetiza cada fala
// com o Piper (voz neural pt-BR, offline) ou, se não houver, com o espeak-ng; dá um timbre para cada personagem
// e mistura por cima da música (que abaixa um pouco).
// Uso: node tools/video/voices.mjs <video.mp4> [--model=caminho/pt_BR-faber-medium.onnx]
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const video = process.argv[2];
if (!video || !existsSync(video)) {
  console.error('uso: node tools/video/voices.mjs <video.mp4>');
  process.exit(1);
}
const model = (process.argv.find((a) => a.startsWith('--model=')) || '').slice(8) || process.env.PIPER_MODEL || '';
const linesFile = video.replace(/\.mp4$/, '.voice.json');
if (!existsSync(linesFile)) {
  console.log(JSON.stringify({ voices: 0, reason: 'sem falas' }));
  process.exit(0);
}
const lines = JSON.parse(readFileSync(linesFile, 'utf8'));

const has = (cmd, args = ['--help']) => spawnSync(cmd, args, { stdio: 'ignore' }).error === undefined;
const engine = model && existsSync(model) && has('piper') ? 'piper' : has('espeak-ng', ['--version']) ? 'espeak' : null;
if (!engine || !lines.length) {
  console.log(JSON.stringify({ voices: 0, reason: engine ? 'sem falas' : 'nenhum sintetizador de voz disponível' }));
  process.exit(0);
}

/** Timbre de cada personagem: p = tom (1 = normal), tempo = velocidade, extra = efeitos do ffmpeg */
const VOICE = {
  bolado: { p: 0.86, tempo: 1.18, extra: 'acompressor=threshold=-18dB:ratio=6,volume=1.5', espeak: 'pt-br+m3' },
  zoeiro: { p: 1.22, tempo: 1.1, extra: 'volume=1.3', espeak: 'pt-br+m7' },
  tagarela: { p: 1.42, tempo: 1.22, extra: 'volume=1.3', espeak: 'pt-br+f4' },
  narrador: { p: 0.97, tempo: 1.12, extra: 'highpass=f=180,aecho=0.8:0.6:45:0.22,acompressor=threshold=-20dB:ratio=4,volume=1.7', espeak: 'pt-br+m1' },
};

/** Texto mais fácil de pronunciar: sem emoji, risadas e siglas faladas. */
function speakable(s) {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\bk{3,}\b/gi, 'ká ká ká')
    .replace(/\bX1\b/gi, 'xis um')
    .replace(/\bGG\b/gi, 'gê gê')
    .replace(/\bRIP\b/g, 'descanse em paz')
    .replace(/\bIA\b/g, 'i a')
    .replace(/PKirq/g, 'Pê Quirk')
    .replace(/PKirq/g, 'Pê Quirk')
    .replace(/\s+/g, ' ')
    .trim();
}

const tmp = video + '.vozes';
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const dur = (f) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim());
const total = dur(video);
const endLimit = total - 3.2; // não fala por cima da tela final

// agenda sem sobreposição: cada fala começa quando a anterior acaba (ou é descartada se atrasar demais)
const placed = [];
let busyUntil = 0;
for (const [i, l] of lines.entries()) {
  const v = VOICE[l.persona];
  const text = speakable(l.text);
  if (!v || !text) continue;
  const raw = join(tmp, `raw${i}.wav`);
  const out = join(tmp, `v${i}.wav`);
  try {
    if (engine === 'piper') execFileSync('piper', ['--model', model, '--output_file', raw], { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
    else execFileSync('espeak-ng', ['-v', v.espeak, '-s', '165', '-w', raw, text]);
    const sr = 22050;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-af', `aresample=${sr},asetrate=${Math.round(sr * v.p)},aresample=44100,atempo=${(v.tempo / v.p).toFixed(3)},${v.extra}`, '-ac', '2', '-ar', '44100', out]);
  } catch (e) {
    console.error('falha na fala', i, String(e).slice(0, 200));
    continue;
  }
  const d = dur(out);
  const start = Math.max(l.t + 0.15, busyUntil + 0.12);
  if (start - l.t > 1.6 || start + d > endLimit) continue;
  busyUntil = start + d;
  placed.push({ file: out, start, persona: l.persona, text });
}

if (!placed.length) {
  console.log(JSON.stringify({ voices: 0, reason: 'nenhuma fala coube no vídeo' }));
  process.exit(0);
}

// mistura: música mais baixa enquanto há vozes + todas as falas no horário certo
const args = ['-y', '-loglevel', 'error', '-i', video];
for (const p of placed) args.push('-i', p.file);
const parts = placed.map((p, i) => `[${i + 1}:a]adelay=${Math.round(p.start * 1000)}|${Math.round(p.start * 1000)}[d${i}]`);
const voiceMix = `${placed.map((_, i) => `[d${i}]`).join('')}amix=inputs=${placed.length}:duration=longest:normalize=0[vox]`;
const filter = [...parts, voiceMix, '[0:a]volume=0.42[mus]', '[mus][vox]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[aout]'].join(';');
const tmpOut = join(tmp, 'out.mp4');
args.push('-filter_complex', filter, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', tmpOut);
execFileSync('ffmpeg', args);
renameSync(tmpOut, video);
rmSync(tmp, { recursive: true, force: true });
writeFileSync(video.replace(/\.mp4$/, '.voice.json'), JSON.stringify(placed.map(({ start, persona, text }) => ({ start: Math.round(start * 100) / 100, persona, text })), null, 1));
console.log(JSON.stringify({ voices: placed.length, engine }));
