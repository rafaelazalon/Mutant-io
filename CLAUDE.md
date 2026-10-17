# CLAUDE.md — guia para trabalhar no MUTANT.IO

## Comandos
- `npm run typecheck` · `npm test` (unit + integração + desempenho) · `npm run build` · `npm start`
- E2E: com o servidor rodando, `BASE_URL=http://localhost:2567 npm run test:e2e`

## Regras do projeto
- O servidor é autoritativo. O cliente só envia intenções (`C2S` em `packages/shared/src/protocol.ts`).
  Nunca aceite do cliente posição final, dano, biomassa, pontuação ou resultado.
- Toda nova mensagem passa por `parseC2S` (validação e reconstrução do objeto).
- Números de jogo ficam em `packages/shared/src/config.ts` e `balance.ts` — não espalhe constantes.
- `computeStats` é pura: atributos são recalculados do zero a partir de nível + mutações (sem acúmulo).
- Efeitos temporários ficam em `PlayerStatus` e expiram em `World.tickTimers`; ao perder um híbrido,
  `World.recompute` remove seus efeitos.
- `stepMovement` é compartilhada por servidor e cliente: mudanças nela afetam a previsão; mantenha determinística.
- Bots usam apenas `World.canSee` e as mesmas portas de um jogador (entrada, `useAbility`, `choose`, `equip`).
  Sempre marcados como bot no placar e nunca contabilizados nas estatísticas.
- Nova mutação: id em `MUTATION_IDS`, definição em `MUTATIONS`, parâmetros em `MUTATION_PARAMS`,
  efeito em `computeStats`/`World`, visual em `render/creature.ts`, teste em `tests/unit/mutations.test.ts`.

## Mapa
- `packages/sim/src/world.ts` — regras (movimento, combate, habilidades, biomassa, zonas, evolução)
- `packages/sim/src/room.ts` — ciclo da partida, clientes, bots, snapshots com área de interesse
- `apps/server/src/` — HTTP/WebSocket, matchmaking (`matchmaking/roomManager.ts`), segurança, persistência
- `apps/client/src/` — `net/game.ts` (previsão/interpolação), `render/`, `ui/`, `input/`, `audio/`
