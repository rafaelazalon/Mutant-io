import { HYBRIDS, MUTATIONS, QUICK_CHAT, type ChatMsg, type GameEvent, type Phase } from '@mutant/shared';
import type { BotDifficulty } from './bots.js';
import type { Player } from './entities.js';
import type { World } from './world.js';

/**
 * Personagens de IA: bots com personalidade que conversam no chat reagindo ao que acontece na partida.
 * Continuam sendo bots (marcados como BOT/🤖) e jogam pelas mesmas regras; só ganham nome, cor e falas.
 * As falas são roteiros escolhidos por evento (sem modelo de linguagem), então não custam nada e não saem do tom.
 */
export type PersonaId = 'bolado' | 'zoeiro' | 'tagarela' | 'narrador';

export const PERSONAS: Record<PersonaId, { name: string; hue: number; difficulty: BotDifficulty; gap: number }> = {
  bolado: { name: 'PISTOLA', hue: 0, difficulty: 'dificil', gap: 5 },
  zoeiro: { name: 'Zé Gosminha', hue: 95, difficulty: 'normal', gap: 6 },
  tagarela: { name: 'Lulu Fofoca', hue: 300, difficulty: 'normal', gap: 4 },
  narrador: { name: 'Narrador Azalon', hue: 45, difficulty: 'dificil', gap: 4 },
};
export const PERSONA_ORDER: PersonaId[] = ['narrador', 'bolado', 'zoeiro', 'tagarela'];

type Trigger =
  | 'start'
  | 'end_win'
  | 'end_lose'
  | 'kill'
  | 'died'
  | 'died_acid'
  | 'backstab'
  | 'streak'
  | 'evo'
  | 'hybrid'
  | 'rain'
  | 'golden'
  | 'idle'
  | 'leader'
  | 'gg'
  | 'help'
  | 'x1'
  | 'laugh'
  | 'other_kill'
  | 'reply'
  | 'reply_bolado'
  | 'reply_zoeiro'
  | 'reply_tagarela'
  | 'reply_narrador'
  | 'other_hybrid';

/** {k} abatedor · {v} vítima · {n} número · {m} mutação/híbrido · {a} quem falou antes */
const LINES: Record<PersonaId, Partial<Record<Trigger, string[]>>> = {
  bolado: {
    reply_zoeiro: ['Zé, sua piada é pior que seu jogo.', 'Para de gracinha, Zé!', 'Zé, vou te comer só pra você parar de falar.'],
    reply_tagarela: ['Lulu, menos fofoca e mais mordida!', 'Lulu, eu NÃO tô bravo! ...Tô sim.', 'Fala menos, Lulu!'],
    reply_narrador: ['Narra direito, Narrador! Eu tô ganhando!', 'Ô Narrador, fala do MEU lance!', 'Para de narrar e vem pro X1, Narrador!'],
    start: ['Bora. Hoje ninguém me segura. NINGUÉM.', 'Quem encostar em mim vai virar sopa.', 'Tô focado. Não fala comigo.', 'Essa partida é minha, já aviso.'],
    kill: ['ENGOLE ESSA, {v}!', 'Sai da minha arena, {v}!', 'Fácil demais. FÁCIL DEMAIS.', '{v}, volta pro tutorial.', 'Isso é skill, não é sorte!'],
    died: ['QUE ISSO?! FOI LAG! LAG!', '{k}, isso foi pura sorte e você sabe!', 'NÃO ACREDITO. Eu tava de costas!', 'Ah não. Ah não não não. Revanche AGORA, {k}!', 'Meu controle travou, certeza.', 'Tá de brincadeira comigo, {k}?!'],
    died_acid: ['Quem colocou esse ácido aí?! Ontem não tinha!', 'O ÁCIDO ME EMPURROU.'],
    backstab: ['Pelas costas, {v}? Pois é, aprende.', 'Nunca vire as costas pra mim!'],
    streak: ['{n} SEGUIDOS! Alguém me para? NINGUÉM!', 'Tô PISTOLA e imparável. {n}!'],
    evo: ['{m}. Agora sim, agora o bicho pega.', 'Peguei {m}. Corram.'],
    hybrid: ['HÍBRIDO! {m}! Agora vocês tão ferrados!'],
    rain: ['Essa chuva é MINHA, saiam da frente!'],
    golden: ['A dourada é minha. Quem chegar perto apanha.'],
    idle: ['Cadê todo mundo? Tão com medo?', 'Tô esperando alguém corajoso...', 'Alguém aí sabe jogar ou só eu?', 'Esse jogo tá roubado, só pode.'],
    leader: ['Óbvio que eu tô em primeiro.', 'Primeiro lugar. Como sempre.'],
    end_win: ['GANHEI! Chora não, chora não!', 'Eu avisei. Eu AVISEI.'],
    end_lose: ['Essa não valeu. Próxima eu amasso todo mundo.', 'Perdi pro lag, não pra vocês.'],
    gg: ['GG é o caramba, quero revanche!', 'gg... mas próxima é minha.'],
    x1: ['X1? Aceito. Vou te amassar.', 'Vem! Vem que eu tô PISTOLA!'],
    laugh: ['Tá rindo de quê?!', 'Engraçado vai ser quando eu te pegar.'],
    other_kill: ['Hunf. Até eu faria melhor.'],
    reply: ['Fica quieto, {a}!', 'Ninguém te perguntou, {a}!', 'Vou te pegar depois, {a}.', 'Para de falar e vem lutar, {a}!'],
  },
  zoeiro: {
    reply_bolado: ['Calma, PISTOLA, respira na gosminha!', 'PISTOLA bravo de novo kkkk', 'PISTOLA, quer um abraço? Não? Ok.'],
    reply_tagarela: ['Lulu, você fala mais que eu como!', 'Lulu, conta a fofoca toda!', 'Lulu, eu ouvi meu nome?'],
    reply_narrador: ['Narrador, fala que eu sou lindo!', 'Narrador, manda um salve pra minha mãe!', 'Narrador, narra eu comendo também!'],
    start: ['Cheguei! Alguém trouxe lanche?', 'Prometo não morrer nos primeiros 10 segundos. Talvez.', 'Hoje eu viro a maior gosma do Brasil!', 'Bom dia, galera da placa de Petri!'],
    kill: ['Desculpa {v}, foi sem querer. Mentira, foi querendo.', 'Nhac! {v} tava com gostinho de morango.', '{v} virou suco. Suco de {v}.', 'Ops! Comi {v}. Tava na dieta, juro.'],
    died: ['Ai. Doeu na minha autoestima.', 'Fui mordido por {k}. Vou contar pra minha mãe.', 'Morri, mas morri bonito.', 'Era tudo parte do plano. Que plano? Não sei.', 'Volto em 4 segundos. Mais lindo.'],
    died_acid: ['Achei que era piscina de limão.', 'Mergulhei no ácido. Não recomendo.'],
    backstab: ['Ataque surpresa! Surpreeesa, {v}!', 'Te peguei por trás, {v}. Clássico.'],
    streak: ['{n} seguidos! Mãe, tô famoso!', 'Combo de {n}! Alguém filma isso!'],
    evo: ['Ganhei {m}. Não sei o que faz, mas é bonito.', '{m}?! Tô ficando um gato. Um gato gosmento.'],
    hybrid: ['VIREI {m}! Sou um pokémon agora?'],
    rain: ['TÁ CHOVENDO COMIDA! Melhor dia da minha vida!', 'Chuva de biomassa! Abre a boca, galera!'],
    golden: ['Célula dourada! Vou vender e ficar rico!'],
    idle: ['Alguém mais tá com fome ou é só eu?', 'Se eu ficar parado, ninguém me vê. Tipo um ninja.', 'Mutação favorita? A minha é a de tirar soneca.', 'Tô evoluindo mais que meu boletim.'],
    leader: ['EU TÔ EM PRIMEIRO? Alguém tira print!'],
    end_win: ['Ganhei?! Isso é sério? Cadê o troféu?'],
    end_lose: ['Perdi, mas me diverti. E comi bem.', 'Ano que vem eu ganho.'],
    gg: ['GG! Gosmas Gostosas!', 'gg wp, gosma pura!'],
    help: ['Calma! Respira! Fecha o olho e corre!'],
    x1: ['X1? Só se for de dança.'],
    laugh: ['kkkkkkk eu também não sei do que tô rindo'],
    other_kill: ['Uuuuh, essa doeu até em mim.', 'RIP {v}. Era uma boa gosma.'],
    reply: ['Calma, {a}, toma uma água!', '{a}, você fala igual meu tio no churrasco.', 'Concordo com {a}. Não entendi, mas concordo.', 'Anotado, {a}. Anotei na minha gosma.'],
  },
  tagarela: {
    reply_bolado: ['Ai PISTOLA, sorri um pouquinho!', 'PISTOLA, você tá bravo ou com fome?', 'Gente, o PISTOLA tá pistola de novo!'],
    reply_zoeiro: ['Zé, para que eu rio e morro!', 'Kkkkk Zé, você não existe!', 'Zé, essa foi boa! Mentira, foi péssima!'],
    reply_narrador: ['Narrador, fala de mim! Fala de mim!', 'Narrador, sua voz é linda!', 'Narrador, quem tá ganhando? Sou eu, né?'],
    start: ['Oiii gente! Tudo bem com vocês? Comigo tudo ótimo!', 'Ai que saudade dessa arena! Vocês viram a chuva da última partida?', 'Gente, hoje eu tô me sentindo uma célula muito poderosa!', 'Oi oi oi! Quem quer ser meu amigo hoje?'],
    kill: ['Ai {v}, me desculpa! Mas você tava pedindo, né?', 'Gente, eu comi {v}! Contei pra alguém? Tô contando!', 'Foi mal, {v}! Depois a gente conversa!', 'Ai que vergonha, comi {v}! Mentira, nem tenho vergonha.'],
    died: ['GENTE! {k} me comeu! Vocês viram isso?!', 'Ai, {k}, que falta de educação!', 'Morri conversando. Típico.', 'Tava distraída falando, não conta!'],
    died_acid: ['Quem colocou esse ácido no meio do caminho?! Gente!'],
    backstab: ['Pelas costas, {v}! Fofoca e mordida, tudo pelas costas!'],
    streak: ['{n} seguidas! Gente, eu tô ON!'],
    evo: ['Ganhei {m}! Combinou comigo, né? Fala que combinou!', 'Olha a {m}, gente! Tô diva!'],
    hybrid: ['GENTE! Virei {m}! Alguém me grava!'],
    rain: ['Chuvaaa! Corre todo mundo, eu chego primeiro!'],
    golden: ['Uma célula dourada! Parece um brinco! Quero!'],
    idle: ['Vocês sabiam que eu tenho 3 olhos quando evoluo? Charme.', 'Gente, o Zé tá parado faz tempo, será que ele dormiu?', 'Alguém viu o PISTOLA? Ele tá bravo de novo?', 'Ai, adoro essa música da arena!', 'Fofoca: o Narrador fica ensaiando as falas sozinho!'],
    leader: ['Primeiro lugar! Mãe, olha eu na TV!'],
    end_win: ['GANHEI! Obrigada, obrigada, autógrafos depois!'],
    end_lose: ['Perdi mas fiz amigos! Quer dizer, comi alguns...'],
    gg: ['GG, gente! Foi lindo! Beijos!'],
    help: ['Corre pra zona de energia! Não, espera, lá revela você! Corre pra outro lugar!'],
    x1: ['X1? Ai, que emoção! Mas eu vou falar o tempo todo, tá?'],
    laugh: ['Kkkkk gente, que que aconteceu? Me conta!'],
    other_kill: ['Gente, {k} pegou {v}! Que babado!', 'Ai, coitadinho de {v}!'],
    reply: ['Ai, {a}, para que eu rio!', 'Concordo com {a}! Quer dizer, mais ou menos.', '{a}, depois me conta isso direito!', 'Gente, {a} tá impossível hoje!'],
  },
  narrador: {
    reply_bolado: ['PISTOLA está irritadíssimo, torcida! Alguém segura!', 'Olha a provocação de PISTOLA! Clima quente na arena!', 'PISTOLA reclama da arbitragem! Mas não tem juiz!'],
    reply_zoeiro: ['Zé Gosminha fazendo graça em campo! Que figura!', 'A torcida ri com Zé Gosminha!', 'Zé Gosminha, sempre ele, o palhaço da arena!'],
    reply_tagarela: ['Lulu Fofoca não para de falar, torcida! Nem de morder!', 'Lulu Fofoca com mais uma revelação bombástica!', 'E a Lulu Fofoca solta o verbo!'],
    other_hybrid: ['{k} FORMOU UM HÍBRIDO! {m}! Que raridade, torcida!', 'Olha isso! {k} virou {m}! Ninguém segura!'],
    start: ['Boa noite, torcida! Começa mais uma partida na arena dos mutantes!', 'Rolou a bola! Quer dizer, rolou a gosma! Começou!', 'Atenção, Brasil! Os mutantes estão em campo!', 'Abrem-se as cortinas! Quem vai evoluir mais hoje?'],
    kill: ['E EU DEVORO {v}! QUE LANCE, MINHA GENTE!', 'Toma, {v}! Golaço de mordida!', 'O narrador também joga, torcida! {v} fora!'],
    died: ['Eita! O narrador foi comido por {k}! Isso não tava no roteiro!', 'Caí! Mas o show continua, torcida!'],
    backstab: ['PELAS COSTAS! Lance de mestre!'],
    streak: ['{n} SEGUIDOS! O narrador tá em chamas!'],
    evo: ['Evolução no ar: {m}! A torcida vai à loucura!'],
    hybrid: ['HÍBRIDO! {m}! Isso é raríssimo, torcida!'],
    rain: ['CHUVA DE BIOMASSA! Todos correm pro mesmo lugar! Vai dar confusão!', 'Lá vem a chuva! Quem chegar primeiro, come!'],
    golden: ['Apareceu a CÉLULA DOURADA! Corrida pelo ouro, minha gente!'],
    idle: ['A partida segue equilibrada. Muita gosma em campo!', 'Olha a tática, torcida! Ninguém quer arriscar!', 'O placar está apertado! Qualquer mordida muda tudo!', 'Dica do narrador: mordida é de frente, costas são perigosas!'],
    leader: ['Temos novo líder: {k}! E ganhou a coroa!'],
    end_win: ['ACABOOOU! E quem leva é o narrador! Inacreditável!'],
    end_lose: ['ACABOOOU! Vitória de {k}! Que partida, torcida!'],
    gg: ['GG para todos! Foi um espetáculo!'],
    help: ['Alguém pede socorro! Será que alguém vai ajudar? Spoiler: não!'],
    x1: ['Temos um desafio de X1! A torcida se levanta!'],
    laugh: ['Até a torcida está rindo!'],
    other_kill: ['E {k} DEVORA {v}! QUE LANCE!', 'Mordida certeira de {k}! {v} não viu de onde veio!', '{v} foi pro chuveiro mais cedo! Obra de {k}!', 'Olha {k}! Não perdoa! {v} fora!', '{k} come {v} e a torcida vai à loucura!'],
    reply: ['{a} está inspirado hoje, torcida!', 'Temos provocação! {a} não deixa barato!', 'Ih, {a} falou e saiu correndo!', 'Que declaração de {a}! A arena está quente!'],
  },
};

const QC_TRIGGER: Partial<Record<number, Trigger>> = { 0: 'gg', 1: 'help', 2: 'x1', 3: 'laugh' };

interface Pending {
  at: number;
  pid: number;
  trigger: Trigger;
  vars: Record<string, string>;
  /** permite que outro personagem responda */
  chain: number;
}

export class ChatDirector {
  private personaOf = new Map<number, PersonaId>();
  private lastSaid = new Map<number, number>();
  private lastAny = -9;
  private queue: Pending[] = [];
  private idleAt = 0;
  private leaderId = -1;
  private rainSeen = false;
  private lastQc = new Map<number, number>();
  private nextMsgId = 1;
  private recent = new Map<number, string[]>();

  constructor(
    private readonly rand: () => number,
    private readonly emit: (m: ChatMsg) => void,
  ) {}

  assign(p: Player, id: PersonaId) {
    this.personaOf.set(p.id, id);
    p.persona = id;
  }

  release(playerId: number) {
    this.personaOf.delete(playerId);
    this.queue = this.queue.filter((q) => q.pid !== playerId);
  }

  personasInUse(): Set<PersonaId> {
    return new Set(this.personaOf.values());
  }

  private pick<T>(a: T[]): T {
    return a[Math.floor(this.rand() * a.length)]!;
  }

  private say(w: World, pid: number, trigger: Trigger, vars: Record<string, string>, delay: number, chain = 1) {
    const persona = this.personaOf.get(pid);
    if (!persona || !LINES[persona][trigger]?.length) return;
    // um pedido pendente por personagem: o mais recente substitui o anterior
    this.queue = this.queue.filter((q) => q.pid !== pid);
    this.queue.push({ at: w.t + delay, pid, trigger, vars, chain });
  }

  /** Sistema: mensagens do jogo (sem personagem). */
  system(text: string) {
    this.emit({ id: this.nextMsgId++, n: '', h: 0, s: text, k: 2 });
  }

  /** Chat rápido de um jogador (frases prontas, sem texto livre). */
  quick(w: World, p: Player, index: number): boolean {
    const text = QUICK_CHAT[index];
    if (!text) return false;
    const last = this.lastQc.get(p.id) ?? -99;
    if (w.t - last < 2.5) return false;
    this.lastQc.set(p.id, w.t);
    this.emit({ id: this.nextMsgId++, n: p.name, h: p.hue, s: text, k: 1, pid: p.id });
    const trig = QC_TRIGGER[index];
    if (trig) {
      // um ou dois personagens respondem
      const ids = [...this.personaOf.keys()].filter((id) => id !== p.id);
      const first = ids.length ? this.pick(ids) : -1;
      for (const id of ids) if (id === first || this.rand() < 0.3) this.say(w, id, trig, { a: p.name }, 1 + this.rand() * 2.5, 0);
    }
    return true;
  }

  onPhase(w: World, ph: Phase, winner?: Player) {
    if (ph === 'playing') {
      this.queue = [];
      for (const id of this.personaOf.keys()) if (this.rand() < 0.6) this.say(w, id, 'start', {}, 0.6 + this.rand() * 4, 0);
      this.idleAt = w.t + 14 + this.rand() * 10;
      this.leaderId = -1;
    } else if (ph === 'finished') {
      this.queue = [];
      for (const id of this.personaOf.keys()) {
        const won = winner?.id === id;
        if (won || this.rand() < 0.55) this.say(w, id, won ? 'end_win' : 'end_lose', { k: winner?.name ?? '?' }, 0.5 + this.rand() * 2.5, 0);
      }
    }
  }

  onEvents(w: World, events: { ev: GameEvent }[]) {
    for (const { ev } of events) {
      switch (ev.k) {
        case 'kill': {
          const killer = ev.a >= 0 ? w.players.get(ev.a) : undefined;
          const victim = w.players.get(ev.b);
          const vars = { k: killer?.name ?? ev.an ?? '?', v: victim?.name ?? ev.bn ?? '?' };
          if (killer && this.personaOf.has(killer.id) && killer !== victim) this.say(w, killer.id, ev.back && this.rand() < 0.6 ? 'backstab' : 'kill', vars, 0.4 + this.rand() * 0.8);
          if (victim && this.personaOf.has(victim.id)) this.say(w, victim.id, killer ? 'died' : 'died_acid', vars, 0.9 + this.rand() * 1.2);
          // o narrador comenta abates dos outros
          for (const [id, pe] of this.personaOf) {
            if (id === ev.a || id === ev.b || !killer || !victim) continue;
            const chance = pe === 'narrador' ? 0.7 : 0.15;
            if (this.rand() < chance) this.say(w, id, 'other_kill', vars, 1.2 + this.rand() * 1.5);
          }
          break;
        }
        case 'streak':
          if (this.personaOf.has(ev.a) && ev.n >= 2) this.say(w, ev.a, 'streak', { n: String(ev.n) }, 1.6);
          break;
        case 'evo':
          if (this.personaOf.has(ev.a) && this.rand() < 0.35) this.say(w, ev.a, 'evo', { m: MUTATIONS[ev.m].name }, 0.8 + this.rand());
          break;
        case 'hybrid':
          if (this.personaOf.has(ev.a)) this.say(w, ev.a, 'hybrid', { m: HYBRIDS[ev.h].name }, 0.8);
          else for (const [id, pe] of this.personaOf) if (pe === 'narrador') this.say(w, id, 'other_hybrid', { k: w.players.get(ev.a)?.name ?? '?', m: HYBRIDS[ev.h].name }, 1.5);
          break;
        case 'superSpawn':
          for (const id of this.personaOf.keys()) if (this.rand() < 0.4) this.say(w, id, 'golden', {}, 0.8 + this.rand() * 2);
          break;
        default:
          break;
      }
    }
  }

  tick(w: World, leader: Player | undefined) {
    // chuva anunciada
    if (w.rain && !this.rainSeen) {
      this.rainSeen = true;
      for (const id of this.personaOf.keys()) if (this.rand() < 0.45) this.say(w, id, 'rain', {}, 0.6 + this.rand() * 2.5);
    } else if (!w.rain) this.rainSeen = false;
    // novo líder
    if (leader && leader.id !== this.leaderId && leader.score > 30) {
      this.leaderId = leader.id;
      if (this.personaOf.has(leader.id) && this.rand() < 0.6) this.say(w, leader.id, 'leader', { k: leader.name }, 1);
      for (const [id, pe] of this.personaOf) if (pe === 'narrador' && id !== leader.id && this.rand() < 0.6) this.say(w, id, 'leader', { k: leader.name }, 1.5);
    }
    // conversa à toa quando a partida está calma
    if (w.t >= this.idleAt && this.personaOf.size) {
      this.idleAt = w.t + 16 + this.rand() * 18;
      const ids = [...this.personaOf.keys()];
      this.say(w, this.pick(ids), 'idle', {}, 0, 1);
    }
    // entrega o que está pronto, com espaço entre as mensagens para dar para ler
    if (w.t - this.lastAny < 1.4) return;
    this.queue.sort((a, b) => a.at - b.at);
    const i = this.queue.findIndex((q) => q.at <= w.t && w.t - (this.lastSaid.get(q.pid) ?? -99) >= PERSONAS[this.personaOf.get(q.pid)!].gap);
    if (i < 0) {
      // descarta pedidos velhos (o momento passou)
      this.queue = this.queue.filter((q) => w.t - q.at < 6);
      return;
    }
    const q = this.queue.splice(i, 1)[0]!;
    const p = w.players.get(q.pid);
    const persona = this.personaOf.get(q.pid);
    if (!p || !persona) return;
    const pool = LINES[persona][q.trigger] ?? [];
    if (!pool.length) return;
    const recent = this.recent.get(q.pid) ?? [];
    const fresh = pool.filter((l) => !recent.includes(l));
    const line = this.pick(fresh.length ? fresh : pool);
    recent.push(line);
    if (recent.length > 8) recent.shift();
    this.recent.set(q.pid, recent);
    const text = line.replace(/\{(\w)\}/g, (_, k: string) => q.vars[k] ?? '');
    this.lastSaid.set(q.pid, w.t);
    this.lastAny = w.t;
    this.emit({ id: this.nextMsgId++, n: p.name, h: p.hue, s: text, k: 0, pid: p.id });
    // outro personagem pode responder (é aqui que eles "conversam" entre si)
    if (q.chain > 0) {
      const others = [...this.personaOf.keys()].filter((id) => id !== q.pid);
      if (others.length && this.rand() < 0.5) {
        const who = this.pick(others);
        const pair = `reply_${persona}` as Trigger;
        const usePair = LINES[this.personaOf.get(who)!][pair]?.length && this.rand() < 0.75;
        this.say(w, who, usePair ? pair : 'reply', { a: p.name }, 1.8 + this.rand() * 2, q.chain - 1);
      }
    }
  }
}
