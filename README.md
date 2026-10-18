# MUTANT.IO

Jogo 2D multiplayer de sobrevivência e evolução biológica, para navegador (computador, celular e tablet).
Cada jogador começa como um organismo simples, coleta biomassa, escolhe mutações (1 de 3 a cada nível)
e pode formar híbridos raros. Partidas de 6 minutos, até 20 jogadores por sala, bots identificados.

## Rodando

Requer Node.js 20+.

```bash
npm install
npm run build        # cliente + servidor + versão standalone
npm start            # http://localhost:2567  (servidor + cliente na mesma porta)
```

Desenvolvimento: `npm run dev` (compila o cliente e roda o servidor com recarga automática).
Para alterar o cliente em tempo real, rode também `npm run dev:client` em outro terminal.

| Script | O que faz |
| --- | --- |
| `npm run build` | Gera `apps/client/dist`, `apps/server/dist` e `dist-standalone/mutant-io.html` |
| `npm start` | Sobe o servidor compilado (serve o cliente e o WebSocket em `/ws`) |
| `npm test` | Testes unitários, de integração (servidor real + 2 clientes WebSocket) e de desempenho |
| `npm run test:e2e` | Dois navegadores reais (desktop + celular com toque) na mesma sala; exige servidor rodando e `npx playwright install chromium` (use `BASE_URL=...`) |
| `npm run typecheck` | Checagem de tipos TypeScript |

Convite: `http://seu-host/?sala=CODIGO`. Treino offline curto: `?duracao=60` (só no modo offline).

## Arquitetura

```
packages/shared   tipos, protocolo, configuração, balanceamento, mutações, movimento determinístico
packages/sim      simulação autoritativa: mundo, combate, evolução, biomassa, zonas, bots, sala (MatchRoom)
apps/server       Node + ws: HTTP estático, /health, matchmaking, salas, segurança, persistência
apps/client       Canvas 2D: render procedural, câmera, joystick/teclado, HUD, rede, áudio, compartilhamento
tests/            unit · integration · performance · e2e (Playwright)
```

- **Servidor autoritativo** a 30 ticks/s com passo fixo. O cliente envia só intenções (eixo de movimento,
  usar habilidade, trocar habilidade, escolher mutação). Posição, dano, biomassa, pontos e vitória são do servidor.
- **Previsão + reconciliação** do jogador local com a mesma função `stepMovement` do servidor;
  **interpolação** (~110 ms) dos jogadores remotos.
- **Snapshots a 15/s com área de interesse**: só entidades próximas; biomassa enviada como diferenças
  (adições/remoções/movimentos); nomes e mutações só quando mudam. ~0,8 KB por snapshot (~96 kbps).
- **Camuflados** só são enviados a quem está perto (≤ 260 px), então um cliente modificado não os vê de longe.
- A mesma `MatchRoom` roda no servidor e no **treino offline** (no navegador, contra bots), identificado na interface.

### Por que não Phaser/Colyseus/Vite/Vitest (ainda)

O ambiente em que este código foi escrito não tinha acesso ao registro do npm, então essas dependências não
puderam ser instaladas nem testadas. Para entregar algo **funcional e verificado**, foi usado o que estava disponível
(TypeScript, esbuild, `ws`, runner `node:test`, Playwright). A separação de camadas foi pensada para a migração:

- **Colyseus**: `MatchRoom` não conhece transporte (`join`, `reconnect`, `leave`, `handle`, `tick`, `setSender`).
  Um `Room` do Colyseus pode delegar: `onJoin → join/reconnect`, `onMessage → handle`, `setSimulationInterval → tick`,
  e `client.send` no `setSender`. `allowReconnection` substitui o token próprio.
- **Phaser**: só `apps/client/src/render` desenha. `drawCreature` usa Canvas 2D e pode virar textura gerada
  (`scene.textures.createCanvas`) ou ser trocado por spritesheets; HUD é DOM e continua igual.
- **Vitest**: os testes usam `describe/it` + `assert`; trocar `node:test` por `vitest` é mecânico.

## Regras principais

- Mordida automática ao encostar, só em quem está à frente (cone de ±80°); pelas costas causa +35% de dano.
  Recarga 0,75 s; proteção de 2,5 s ao nascer e no início da partida.
- Sequência de abates: cada abate seguido sem morrer dá +6 pontos extras (até +30).
- Eventos do mapa: chuva de biomassa a cada 70–100 s (aviso de 6 s, seta e marcador para todos) e uma célula
  dourada rara (15 de biomassa) a cada ~45 s, visível no minimapa de todos. O líder do placar usa uma coroa.
- Níveis por biomassa acumulada (10, 25, 45, 75, 115, 165, 230, 310, 400). Cada nível: escolha entre 3 mutações;
  15 s para escolher, depois escolha automática. O jogo não pausa.
- Ao morrer: renasce em 4 s com 50% da biomassa (40% cai no chão); mutações acima do novo nível se perdem.
- Zonas de energia: biomassa e pontos, mas revelam no minimapa de todos e cancelam camuflagem. Ácido: dano contínuo.
- Fim da partida: maior pontuação vence; desempate por abates, depois menos mortes, depois ordem de entrada.
- Quem entra tarde ganha até 40 de biomassa de recuperação. Desconexão: 20 s para reconectar com o mesmo jogador.

Mutações e híbridos estão em `packages/shared/src/mutations.ts`; números em `packages/shared/src/balance.ts`
e `packages/shared/src/config.ts`.

## Desempenho, áudio e controles

- Corpos das criaturas, nomes, chão, poças de ácido e zonas são pré-renderizados e reutilizados; a qualidade
  "Automática" reduz resolução e efeitos sozinha se os quadros ficarem lentos (medido: ~24 → ~58 fps com CPU 4× mais lenta).
- Músicas procedurais (WebAudio): uma na tela inicial e outra na partida, mais intensa nos 30 s finais.
  Volume de música e de efeitos separados nas configurações.
- Vibração de 0,5 s ao perder vida (celulares Android; o Safari do iPhone não oferece vibração para sites).
- Cada poder tem seu botão translúcido na tela (teclas 1–6); as cartas de evolução respondem ao toque com
  outro dedo sem soltar o joystick.
- Fontes: Lilita One e Fredoka (Google Fonts). Sem internet, o navegador usa a fonte do sistema.

## Telas e aparelhos

- O jogo mede a área visível real (rotação, barra do navegador, janela redimensionada, iframe) e ajusta canvas,
  zoom da câmera e escala da interface. Testado em 9 formatos: iPhone SE, iPhone 13 em pé e deitado, Pixel 7 deitado,
  iPad em pé e deitado, notebook 1366×768, Full HD e ultrawide (`tests/e2e/responsive.mjs`).
- No celular, entra em tela cheia ao tocar em jogar (desligável nas configurações; o iPhone não permite em sites).
- Instalável na tela inicial (manifesto com `display: fullscreen` e ícones em `apps/client/public`).

## Loja de aparências (R$ 1,00 cada)

- 29 aparências pagas e 5 grátis em 5 categorias: cores, padrões, olhos, acessórios e rastros. **Só visual** —
  nenhuma muda atributos, tamanho ou visibilidade.
- Pagamento pelo **Mercado Pago Checkout Pro**: cartão de crédito, débito e Pix na página segura do Mercado Pago
  (o jogo nunca vê dados de cartão). Boleto fica de fora.
- O item só é liberado depois que o **servidor** confirma o pagamento direto na API do Mercado Pago (aviso automático
  + consulta de segurança). Valor e moeda são conferidos; avisos repetidos não duplicam; estorno retira o item.
- Conta anônima: o jogo cria um **código de recuperação** (MX-XXXX-…) para restaurar as compras em outro aparelho.
- O servidor só aceita na partida a aparência que a conta comprou (testado: um visual "forjado" chega como padrão).
- No app Android (Play Store) o botão de comprar fica oculto: lá o Google exige o Google Play Billing.

### Ativar os pagamentos
1. Crie uma conta no Mercado Pago (pode ser com CPF) e em *Suas integrações* crie uma aplicação → copie o
   **Access Token de produção** para `MP_ACCESS_TOKEN`.
2. Defina `PUBLIC_URL` com o endereço do jogo (ex.: `https://mutant-io.onrender.com`).
3. Em *Webhooks*, cadastre `PUBLIC_URL/api/webhooks/mercadopago` (evento **Pagamentos**) e copie a assinatura
   secreta para `MP_WEBHOOK_SECRET`.
4. Use PostgreSQL (`DATABASE_URL`) para não perder compras a cada deploy. O `render.yaml` já cria um banco grátis
   (no Render, bancos grátis expiram depois de um tempo — veja o plano antes de vender de verdade).
5. Teste local sem dinheiro: `PAYMENTS_MODE=fake PUBLIC_URL=http://localhost:2567 npm start`.

Política de privacidade: `/privacidade.html` (preencha o e-mail de contato).

## Aviso de jogadores no celular

Com `NOTIFY_URL=https://ntfy.sh/<tópico-secreto>`, o servidor manda uma notificação quando um jogador de verdade
entra (bots e reconexões não contam). Instale o app **ntfy** no celular e assine o mesmo tópico. No máximo um aviso a
cada 2 minutos (`NOTIFY_MIN_GAP_SEC`); quem entrar nesse meio-tempo aparece agrupado no aviso seguinte.
Use um nome de tópico difícil de adivinhar: quem souber o nome também recebe os avisos.

## Segurança

Validação de toda mensagem (`parseC2S`), nomes higienizados, limite de 1 KB por mensagem, token bucket por conexão
com expulsão após abuso, limite de conexões por IP, origem permitida configurável (`ALLOWED_ORIGINS`), uma entrada
de movimento processada por tick (sem speedhack por inundação), ofertas de mutação com id por partida
(escolhas antigas são rejeitadas), token de reconexão de uso único.

## Publicação

`Dockerfile` incluso (porta 2567). Atrás de proxy HTTPS, defina `TRUST_PROXY=1` e `ALLOWED_ORIGINS=https://seu-dominio`.
O WebSocket usa `wss://` automaticamente quando a página é HTTPS. Nada foi publicado ainda.

## Próximas etapas (não implementadas)

- Contas e progressão persistente: esquema PostgreSQL pronto em `apps/server/src/persistence/schema.sql`;
  hoje as estatísticas ficam em memória (`MemoryStatsRepository`) e não incluem bots.
- Mapas alternativos.
- Balanceamento a partir de playtests reais.
