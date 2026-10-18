#!/usr/bin/env bash
# Vídeo diário do TikTok: compila o jogo, sobe um servidor local, a IA joga e grava, e o vídeo vai para o
# branch "videos" do GitHub (só os 5 mais recentes, num branch sem histórico, para o repositório não crescer).
# Uso: tools/video/daily.sh <numero-do-dia>    → imprime a URL pública do vídeo na última linha
set -euo pipefail
DAY="${1:?informe o número do dia}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${TMPDIR:-/tmp}/mutantio-video"
mkdir -p "$WORK"
cd "$ROOT"
[ -e node_modules ] || { [ -d /opt/npm-tools/node_modules ] && ln -s /opt/npm-tools/node_modules node_modules; } || npm install --no-audit --no-fund
node scripts/build.mjs >/dev/null
PORT=2611 node apps/server/dist/index.js >"$WORK/server.log" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null || true' EXIT
for i in $(seq 1 30); do curl -sf localhost:2611/health >/dev/null && break; sleep 0.5; done
FILE="mutantio-dia-$(printf '%03d' "$DAY").mp4"
BASE_URL=http://localhost:2611 node tools/video/make-clip.mjs "$WORK/$FILE" --dia="$DAY" --seed="$((DAY * 7919))" | tee "$WORK/clip.json"
# vozes dos personagens (Piper no GitHub Actions; espeak-ng se houver; sem vozes, o vídeo fica só com a música)
node tools/video/voices.mjs "$WORK/$FILE" | tee "$WORK/voices.json" || echo '{"voices":0,"reason":"erro"}' > "$WORK/voices.json"
node -e 'const fs=require("fs");const a=JSON.parse(fs.readFileSync(process.argv[1]));const b=JSON.parse(fs.readFileSync(process.argv[2]));fs.writeFileSync(process.argv[1],JSON.stringify({...a,...b}))' "$WORK/clip.json" "$WORK/voices.json"

# publica no branch "videos"
REPO_URL="$(git remote get-url origin)"
# no GitHub Actions o push usa o token do próprio workflow
PUSH_URL="${PUSH_URL:-$REPO_URL}"
PUB="$WORK/pub"
rm -rf "$PUB"
if git ls-remote --exit-code "$REPO_URL" videos >/dev/null 2>&1; then
  git clone -q --depth 1 --branch videos "$REPO_URL" "$PUB"
else
  mkdir -p "$PUB" && git -C "$PUB" init -q -b videos && git -C "$PUB" remote add origin "$REPO_URL"
fi
cp "$WORK/$FILE" "$PUB/"
cp "$WORK/clip.json" "$PUB/${FILE%.mp4}.json"
[ -f "$WORK/${FILE%.mp4}.voice.json" ] && cp "$WORK/${FILE%.mp4}.voice.json" "$PUB/"
cd "$PUB"
ls -1 mutantio-dia-*.mp4 | sort | head -n -5 | while read -r old; do rm -f "$old" "${old%.mp4}.json" "${old%.mp4}.voice.json"; done
printf '# Vídeos diários do MUTANT.IO (gerados automaticamente; só os 5 mais recentes)\n' > README.md
rm -rf .git && git init -q -b videos && git remote add origin "$PUSH_URL"
git add -A
git -c user.name="MUTANT.IO bot" -c user.email="bot@mutant-io.local" commit -qm "Vídeo do dia $DAY"
git push -q -f origin videos
OWNER_REPO="$(echo "$REPO_URL" | sed -E 's#.*github.com/##; s#\.git$##')"
echo "https://raw.githubusercontent.com/$OWNER_REPO/videos/$FILE"
