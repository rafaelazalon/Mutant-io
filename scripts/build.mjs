// Build com esbuild: cliente (web), servidor (node) e versão standalone (um único HTML).
// Uso: node scripts/build.mjs [--watch] [--only=client|server|standalone]
import { build, context } from 'esbuild';
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const watch = args.includes('--watch');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const tsconfig = join(root, 'tsconfig.json');

const clientDir = join(root, 'apps/client');
const clientOut = join(clientDir, 'dist');

function copyStatic() {
  mkdirSync(clientOut, { recursive: true });
  cpSync(join(clientDir, 'public'), clientOut, { recursive: true });
  copyFileSync(join(clientDir, 'index.html'), join(clientOut, 'index.html'));
  copyFileSync(join(clientDir, 'styles.css'), join(clientOut, 'styles.css'));
}

const clientOpts = {
  entryPoints: [join(clientDir, 'src/main.ts')],
  outdir: clientOut,
  bundle: true,
  format: 'esm',
  splitting: true,
  target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
  minify: !watch && !process.env.NO_MINIFY,
  sourcemap: watch ? 'inline' : true,
  tsconfig,
  logLevel: 'info',
  plugins: [{ name: 'static', setup: (b) => b.onEnd(copyStatic) }],
  // Three.js vem do arquivo da pasta vendor (sem depender do npm)
  alias: { three: join(clientDir, 'vendor/three.module.min.js') },
};

const serverOpts = {
  entryPoints: [join(root, 'apps/server/src/index.ts')],
  outfile: join(root, 'apps/server/dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: true,
  tsconfig,
  logLevel: 'info',
};

async function standalone() {
  // HTML único com o modo de treino offline embutido (útil para demonstração sem servidor)
  const r = await build({
    entryPoints: [join(clientDir, 'src/main.ts')],
    bundle: true,
    format: 'iife',
    target: ['es2020', 'safari15', 'chrome90', 'firefox90'],
    minify: true,
    write: false,
    tsconfig,
    alias: { three: join(clientDir, 'vendor/three.module.min.js') },
  });
  const js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const css = readFileSync(join(clientDir, 'styles.css'), 'utf8');
  let html = readFileSync(join(clientDir, 'index.html'), 'utf8');
  html = html.replace('<link rel="stylesheet" href="./styles.css" />', `<style>${css}</style>`);
  // a versão de arquivo único não tem manifesto nem ícones separados
  html = html.replace(/\s*<link rel="(manifest|apple-touch-icon)"[^>]*>/g, '');
  html = html.replace('<script type="module" src="./main.js"></script>', () => `<script>${js}</script>`);
  const out = join(root, 'dist-standalone');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'mutant-io.html'), html);
  console.log(`standalone: ${join(out, 'mutant-io.html')} (${Math.round(html.length / 1024)} KB)`);
}

if (watch) {
  const c = await context(clientOpts);
  await c.watch();
  console.log('observando o cliente…');
} else {
  if (!only || only === 'client') {
    rmSync(clientOut, { recursive: true, force: true });
    await build(clientOpts);
  }
  if (!only || only === 'server') await build(serverOpts);
  if (!only || only === 'standalone') await standalone();
}
