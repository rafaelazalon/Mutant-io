import * as THREE from 'three';
import { FLAG, HYBRIDS, MUTATIONS, type GameEvent, type HybridId, type MutationId } from '@mutant/shared';
import type { ClientGame } from '../net/game.js';
import type { Renderer } from '../render/renderer.js';
import { paletteFor } from '../render/look.js';
import { viewport } from '../ui/viewport.js';

/**
 * Modo 3D do MUTANT.IO (Three.js). Desenha o mesmo estado do jogo que o modo 2D — mesmas salas,
 * mesmo servidor — com câmera inclinada, mutantes modelados em 3D, biomassa, zonas e efeitos.
 * O canvas 2D continua por cima como camada de interface (minimapa, setas, avisos, vinheta).
 *
 * Eixos: x do jogo → X; y do jogo → Z; altura → Y. "Para cima" na tela continua sendo y menor.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = any;

const ARENA = 3200;

/** Converte qualquer cor CSS (hsl com espaços, nomes…) para #rrggbb, que o Three.js entende. */
const cssCtx = document.createElement('canvas').getContext('2d')!;
const cssCache = new Map<string, string>();
function css(c: string): string {
  let v = cssCache.get(c);
  if (!v) {
    cssCtx.fillStyle = '#000000';
    cssCtx.fillStyle = c;
    v = String(cssCtx.fillStyle);
    if (!v.startsWith('#')) {
      cssCtx.fillRect(0, 0, 1, 1);
      const d = cssCtx.getImageData(0, 0, 1, 1).data;
      v = '#' + [d[0], d[1], d[2]].map((n) => n!.toString(16).padStart(2, '0')).join('');
    }
    cssCache.set(c, v);
  }
  return v;
}
const tmpColor = new THREE.Color();

/* ------------------------------------------------------------------ */
/* Recursos compartilhados                                             */
/* ------------------------------------------------------------------ */

const GEO = {
  sphere: new THREE.SphereGeometry(1, 32, 22),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  cone: new THREE.ConeGeometry(1, 1, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  ico: new THREE.IcosahedronGeometry(1, 1),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  octa: new THREE.OctahedronGeometry(1, 0),
  torus: new THREE.TorusGeometry(1, 0.06, 8, 48),
  disc: new THREE.CircleGeometry(1, 48),
  ring: new THREE.RingGeometry(0.86, 1, 64),
};

function glowTexture(): Obj {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HYBRID_COLORS: Record<HybridId, string> = {
  investida_blindada: '#7ef0d8',
  coletor_furtivo: '#ff8fd0',
  cacador_aproximacao: '#5ce1ff',
  mutante_resistencia: '#7dff6a',
};

/* ------------------------------------------------------------------ */
/* Mutante 3D                                                          */
/* ------------------------------------------------------------------ */

interface Creature {
  key: string;
  root: Obj; // posição no mundo
  body: Obj; // gira para a direção do movimento
  bodyMesh: Obj;
  materials: Obj[];
  tail: Obj[];
  legs: Obj[];
  orbiters: Obj[];
  auras: Obj[];
  shield: Obj;
  crown: Obj;
  shadow: Obj;
  label: Obj;
  labelKey: string;
  hpBg: Obj;
  hpFill: Obj;
  lastSeen: number;
  biteT: number;
  facing: number;
  seed: number;
}

function std(color: string, opts: Record<string, unknown> = {}): Obj {
  return new THREE.MeshStandardMaterial({ color: css(color), roughness: 0.45, metalness: 0.05, ...opts });
}

function buildCreature(muts: ReadonlySet<MutationId>, hyb: ReadonlySet<HybridId>, hue: number, look: unknown, level: number, seed: number): Creature {
  const pal = paletteFor(hue, look as never);
  const mats: Obj[] = [];
  const m = (mat: Obj) => {
    mats.push(mat);
    return mat;
  };
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  // corpo: esfera levemente achatada, brilhante se tiver pele escorregadia
  const glossy = muts.has('pele_escorregadia');
  const bodyMat = m(std(pal.base, { roughness: glossy ? 0.12 : 0.5, metalness: glossy ? 0.25 : 0.05, emissive: new THREE.Color(css(pal.deep)), emissiveIntensity: 0.18 }));
  bodyMat.userData.emissiveBase = css(pal.deep);
  const bodyMesh = new THREE.Mesh(GEO.sphere, bodyMat);
  bodyMesh.scale.set(1, 0.82, 1);
  bodyMesh.position.y = 0.82;
  body.add(bodyMesh);

  // manchas (organelas) no dorso
  const spotMat = m(std(pal.light, { roughness: 0.6, transparent: true, opacity: 0.85 }));
  for (let i = 0; i < 5; i++) {
    const a = seed * 1.7 + i * 2.39;
    const sp = new THREE.Mesh(GEO.sphereLo, spotMat);
    const rr = 0.5 + ((i * 37) % 10) / 40;
    sp.position.set(Math.cos(a) * rr * 0.75 - 0.15, 1.42 + Math.sin(i) * 0.04, Math.sin(a) * rr * 0.75);
    sp.scale.set(0.16 + (i % 3) * 0.04, 0.05, 0.16 + (i % 2) * 0.05);
    body.add(sp);
  }

  // olhos
  const eyeWhite = m(std('#ffffff', { roughness: 0.2 }));
  const pupil = m(std('#140a14', { roughness: 0.3 }));
  const eyes: [number, number, number, number][] =
    level >= 6
      ? [
          [0.62, 1.12, -0.36, 0.22],
          [0.62, 1.12, 0.36, 0.22],
          [0.45, 1.42, 0, 0.17],
        ]
      : [
          [0.62, 1.1, -0.33, 0.25],
          [0.62, 1.1, 0.33, 0.25],
        ];
  for (const [x, y, z, s] of eyes) {
    const e = new THREE.Mesh(GEO.sphereLo, eyeWhite);
    e.position.set(x, y, z);
    e.scale.setScalar(s);
    body.add(e);
    const p = new THREE.Mesh(GEO.sphereLo, pupil);
    p.position.set(x + s * 0.62, y + s * 0.08, z);
    p.scale.setScalar(s * 0.52);
    body.add(p);
  }
  // boca
  const mouth = new THREE.Mesh(GEO.sphereLo, m(std('#1a0510', { roughness: 0.8 })));
  mouth.position.set(0.9, 0.62, 0);
  mouth.scale.set(0.12, 0.08, 0.26);
  body.add(mouth);

  // espinhos externos
  if (muts.has('espinhos_externos')) {
    const spikeMat = m(std('#ffd6e4', { roughness: 0.35, emissive: new THREE.Color('#ff5f8f'), emissiveIntensity: 0.25 }));
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const sp = new THREE.Mesh(GEO.cone, spikeMat);
      sp.position.set(Math.cos(a) * 0.98, 0.82 + (i % 2) * 0.18, Math.sin(a) * 0.98);
      sp.scale.set(0.11, 0.42, 0.11);
      sp.lookAt(Math.cos(a) * 3, 0.9 + (i % 2) * 0.5, Math.sin(a) * 3);
      sp.rotateX(Math.PI / 2);
      body.add(sp);
    }
  }
  // carapaça cristalina: casca facetada translúcida
  if (muts.has('carapaca_cristalina')) {
    const shell = new THREE.Mesh(GEO.ico, m(std('#9ff6ff', { transparent: true, opacity: 0.32, roughness: 0.05, metalness: 0.4, flatShading: true, emissive: new THREE.Color('#2bd0ff'), emissiveIntensity: 0.25 })));
    shell.scale.set(1.12, 0.94, 1.12);
    shell.position.y = 0.86;
    body.add(shell);
  }
  // gel regenerativo: camada de gosma verde
  if (muts.has('gel_regenerativo')) {
    const gel = new THREE.Mesh(GEO.sphere, m(std('#7dff6a', { transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false })));
    gel.scale.set(1.2, 0.98, 1.2);
    gel.position.y = 0.82;
    body.add(gel);
  }
  // cauda propulsora
  const tail: Obj[] = [];
  if (muts.has('cauda_propulsora')) {
    const tm = m(std(pal.deep, { roughness: 0.5 }));
    let prev = body;
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Group();
      seg.position.set(i === 0 ? -0.85 : -0.42, i === 0 ? 0.7 : 0, 0);
      const s = new THREE.Mesh(GEO.sphereLo, tm);
      s.scale.setScalar(0.3 - i * 0.05);
      seg.add(s);
      prev.add(seg);
      tail.push(seg);
      prev = seg;
    }
    const fin = new THREE.Mesh(GEO.cone, m(std('#ffb547', { emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 0.4 })));
    fin.position.set(-0.3, 0, 0);
    fin.rotation.z = Math.PI / 2;
    fin.scale.set(0.22, 0.4, 0.06);
    prev.add(fin);
  }
  // pernas elásticas
  const legs: Obj[] = [];
  if (muts.has('pernas_elasticas')) {
    const lm = m(std(pal.dark, { roughness: 0.6 }));
    const foot = m(std('#ffb547', { roughness: 0.4 }));
    for (const [x, z] of [
      [0.45, 0.8],
      [0.45, -0.8],
      [-0.4, 0.8],
      [-0.4, -0.8],
    ] as const) {
      const leg = new THREE.Group();
      leg.position.set(x, 0.55, z * 0.85);
      const l = new THREE.Mesh(GEO.cyl, lm);
      l.scale.set(0.08, 0.6, 0.08);
      l.position.set(0, -0.25, z * 0.25);
      l.rotation.x = z * 0.6;
      leg.add(l);
      const f = new THREE.Mesh(GEO.sphereLo, foot);
      f.scale.setScalar(0.12);
      f.position.set(0, -0.5, z * 0.45);
      leg.add(f);
      body.add(leg);
      legs.push(leg);
    }
  }
  // pulso bioelétrico: antenas com pontas brilhantes
  if (muts.has('pulso_bioeletrico')) {
    const am = m(std(pal.dark));
    const tip = m(new THREE.MeshBasicMaterial({ color: '#c8f6ff' }));
    for (const z of [-0.35, 0.35]) {
      const a = new THREE.Mesh(GEO.cyl, am);
      a.scale.set(0.04, 0.7, 0.04);
      a.position.set(0.35, 1.75, z);
      a.rotation.z = -0.5;
      a.rotation.x = z * 0.8;
      body.add(a);
      const t = new THREE.Mesh(GEO.sphereLo, tip);
      t.scale.setScalar(0.12);
      t.position.set(0.55, 2.05, z * 1.6);
      body.add(t);
    }
  }
  // isca biológica: bulbo pendurado na frente
  if (muts.has('isca_biologica')) {
    const stalk = new THREE.Mesh(GEO.cyl, m(std(pal.dark)));
    stalk.scale.set(0.035, 0.6, 0.035);
    stalk.position.set(0.7, 1.7, 0);
    stalk.rotation.z = -0.9;
    body.add(stalk);
    const bulb = new THREE.Mesh(GEO.sphereLo, m(new THREE.MeshBasicMaterial({ color: '#ffa3a3' })));
    bulb.scale.setScalar(0.13);
    bulb.position.set(1.0, 1.85, 0);
    body.add(bulb);
  }
  // língua coletora (enrolada na frente)
  if (muts.has('lingua_coletora')) {
    const t = new THREE.Mesh(GEO.torus, m(std('#ff6fbf', { roughness: 0.3 })));
    t.scale.setScalar(0.18);
    t.position.set(0.98, 0.55, 0);
    t.rotation.y = Math.PI / 2;
    body.add(t);
  }
  // salto dimensional: cristais em órbita
  const orbiters: Obj[] = [];
  if (muts.has('salto_dimensional')) {
    const om = m(new THREE.MeshBasicMaterial({ color: '#d4b8ff' }));
    for (let i = 0; i < 3; i++) {
      const o = new THREE.Mesh(GEO.octa, om);
      o.scale.set(0.12, 0.2, 0.12);
      root.add(o);
      orbiters.push(o);
    }
  }
  // auras dos híbridos
  const auras: Obj[] = [];
  let ai = 0;
  for (const h of hyb) {
    const a = new THREE.Mesh(GEO.torus, m(new THREE.MeshBasicMaterial({ color: HYBRID_COLORS[h], transparent: true, opacity: 0.85 })));
    a.scale.setScalar(1.55 + ai * 0.18);
    a.rotation.x = Math.PI / 2;
    a.position.y = 0.3 + ai * 0.15;
    root.add(a);
    auras.push(a);
    ai++;
  }
  // escudo orgânico (aparece quando ativo)
  const shield = new THREE.Mesh(GEO.ico, m(new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.22, wireframe: true })));
  shield.scale.setScalar(1.6);
  shield.position.y = 0.8;
  shield.visible = false;
  root.add(shield);
  // coroa do líder
  const crown = new THREE.Group();
  const gold = m(std('#ffd23f', { metalness: 0.6, roughness: 0.25, emissive: new THREE.Color('#a86400'), emissiveIntensity: 0.4 }));
  const band = new THREE.Mesh(GEO.cyl, gold);
  band.scale.set(0.42, 0.14, 0.42);
  crown.add(band);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const c = new THREE.Mesh(GEO.cone, gold);
    c.scale.set(0.09, 0.28, 0.09);
    c.position.set(Math.cos(a) * 0.36, 0.2, Math.sin(a) * 0.36);
    crown.add(c);
  }
  crown.position.y = 2.15;
  crown.visible = false;
  root.add(crown);
  // sombra suave
  const shadow = new THREE.Mesh(GEO.disc, m(new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.35, depthWrite: false })));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  shadow.scale.setScalar(1.05);
  root.add(shadow);

  return {
    key: '',
    root,
    body,
    bodyMesh,
    materials: mats,
    tail,
    legs,
    orbiters,
    auras,
    shield,
    crown,
    shadow,
    label: null,
    labelKey: '',
    hpBg: null,
    hpFill: null,
    lastSeen: 0,
    biteT: -9,
    facing: 0,
    seed,
  };
}

function disposeCreature(c: Creature) {
  for (const m of c.materials) m.dispose();
  if (c.label) {
    c.label.material.map?.dispose();
    c.label.material.dispose();
    c.label.removeFromParent();
  }
  for (const b of [c.hpBg, c.hpFill]) {
    if (!b) continue;
    b.material.dispose();
    b.removeFromParent();
  }
  c.root.removeFromParent();
}

/** Rótulo (nome + nível) como sprite de canvas. */
function makeLabel(text: string, lv: number, color: string): { sprite: Obj; aspect: number } {
  const c = document.createElement('canvas');
  const x = c.getContext('2d')!;
  const fs = 44;
  x.font = `700 ${fs}px 'Fredoka', system-ui, sans-serif`;
  const tw = x.measureText(text).width;
  const badge = lv >= 0 ? fs * 1.15 : 0;
  c.width = Math.ceil(tw + badge + 30);
  c.height = Math.ceil(fs * 1.5);
  x.font = `700 ${fs}px 'Fredoka', system-ui, sans-serif`;
  x.textBaseline = 'middle';
  if (lv >= 0) {
    x.fillStyle = '#7dff6a';
    x.beginPath();
    x.arc(badge / 2 + 6, c.height / 2, badge / 2, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = '#0b1020';
    x.textAlign = 'center';
    x.fillText(String(lv), badge / 2 + 6, c.height / 2 + 2);
  }
  x.textAlign = 'left';
  x.lineWidth = 8;
  x.strokeStyle = 'rgba(0,0,0,0.8)';
  x.strokeText(text, badge + 16, c.height / 2 + 2);
  x.fillStyle = color;
  x.fillText(text, badge + 16, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sprite.renderOrder = 10;
  return { sprite, aspect: c.width / c.height };
}

/* ------------------------------------------------------------------ */
/* Partículas simples (brilhos e anéis)                                 */
/* ------------------------------------------------------------------ */

interface Spark {
  s: Obj;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  grav: number;
  /** meteoro: cai de cima até o chão */
  meteor?: { tx: number; tz: number; delay: number };
}
interface RingFx {
  m: Obj;
  life: number;
  max: number;
  from: number;
  to: number;
}

/* ------------------------------------------------------------------ */
/* Cena                                                                */
/* ------------------------------------------------------------------ */

export class Scene3D {
  private renderer: Obj;
  private scene: Obj;
  private camera: Obj;
  private creatures = new Map<number, Creature>();
  private decoys = new Map<number, Creature>();
  private pellets: Obj;
  private golden: Obj;
  private goldenRays: Obj;
  private zoneObjs = new Map<number, Obj>();
  private hazardGroup: Obj;
  private hazardKey = '';
  private ground: Obj;
  private groundSrc: HTMLCanvasElement | null = null;
  private sparks: Spark[] = [];
  private rings: RingFx[] = [];
  private glow: Obj;
  private camPos = new THREE.Vector3(1600, 900, 2300);
  private camLook = new THREE.Vector3(1600, 0, 1600);
  private time = 0;
  private dummy = new THREE.Object3D();
  private maxPellets = 600;
  private pixelRatio = 1;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly r2d: Renderer,
  ) {
    const coarse = viewport.size.coarse;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !coarse, alpha: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor('#04060d');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#04060d', 1400, 3600);
    this.camera = new THREE.PerspectiveCamera(42, 1, 10, 8000);

    this.scene.add(new THREE.HemisphereLight('#bfe6ff', '#1a0a26', 1.25));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-0.5, 1, 0.35);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#ff5fd2', 0.45);
    rim.position.set(0.6, 0.4, -1);
    this.scene.add(rim);

    // chão: a mesma arte procedural do modo 2D, como textura
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.set(ARENA / 2, 0, ARENA / 2);
    this.scene.add(this.ground);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 4, ARENA * 4), new THREE.MeshBasicMaterial({ color: '#05030c' }));
    outside.rotation.x = -Math.PI / 2;
    outside.position.set(ARENA / 2, -2, ARENA / 2);
    this.scene.add(outside);
    // borda da arena: membrana rosa brilhante
    const wallMat = new THREE.MeshBasicMaterial({ color: '#ff4fa0', transparent: true, opacity: 0.75 });
    for (const [x, z, w, d] of [
      [ARENA / 2, 0, ARENA, 8],
      [ARENA / 2, ARENA, ARENA, 8],
      [0, ARENA / 2, 8, ARENA],
      [ARENA, ARENA / 2, 8, ARENA],
    ] as const) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(w, 26, d), wallMat);
      wall.position.set(x, 13, z);
      this.scene.add(wall);
    }

    // biomassa: uma malha instanciada (barata) + a célula dourada separada
    this.pellets = new THREE.InstancedMesh(GEO.ico0, new THREE.MeshBasicMaterial({ color: '#ffffff' }), this.maxPellets);
    this.pellets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.pellets.count = 0;
    this.scene.add(this.pellets);
    this.golden = new THREE.Mesh(GEO.sphere, std('#ffd23f', { metalness: 0.7, roughness: 0.2, emissive: new THREE.Color('#ffb000'), emissiveIntensity: 0.8 }));
    this.golden.visible = false;
    this.scene.add(this.golden);
    this.goldenRays = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    this.goldenRays.rotation.x = -Math.PI / 2;
    this.goldenRays.visible = false;
    this.scene.add(this.goldenRays);

    this.hazardGroup = new THREE.Group();
    this.scene.add(this.hazardGroup);
    this.glow = glowTexture();

    this.resize();
    viewport.onChange(() => this.resize());
    r2d.onEventBatch = (evs) => this.onEvents(evs);
  }

  resize() {
    const { w, h } = viewport.size;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, viewport.size.coarse ? 1.5 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------ eventos ------------------------------ */

  private posOf(g: ClientGame, id: number): { x: number; y: number } | null {
    if (id === g.myId && g.me) return g.myRenderPos();
    const v = g.remoteViews().find((r) => r.id === id);
    return v ? { x: v.x, y: v.y } : null;
  }

  private game: ClientGame | null = null;

  private onEvents(evs: GameEvent[]) {
    const g = this.game;
    if (!g) return;
    for (const e of evs) {
      switch (e.k) {
        case 'bite': {
          const c = this.creatures.get(e.a);
          if (c) c.biteT = this.time;
          this.burst(e.x, e.y, 20, e.back ? '#ff9f1c' : '#fff2c0', 10, 260, 0.35, 10);
          break;
        }
        case 'kill': {
          const col = css(`hsl(${g.meta.get(e.b)?.hue ?? 120} 85% 58%)`);
          this.burst(e.x, e.y, 25, col, 34, 420, 0.9, 16);
          this.ring(e.x, e.y, 20, 180, col, 0.6);
          break;
        }
        case 'evo':
        case 'hybrid': {
          const p = this.posOf(g, e.a);
          const col = css(e.k === 'evo' ? MUTATIONS[e.m].color : HYBRIDS[e.h].color);
          if (p) {
            this.ring(p.x, p.y, 20, e.k === 'evo' ? 170 : 280, col, 0.8);
            for (let i = 0; i < (e.k === 'evo' ? 18 : 34); i++) this.spark(p.x + (Math.random() - 0.5) * 60, 10, p.y + (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 200 + Math.random() * 260, (Math.random() - 0.5) * 60, col, 1, 14, -60);
          }
          break;
        }
        case 'pulse':
          this.ring(e.x, e.y, 10, e.r, '#5ce1ff', 0.5);
          this.ring(e.x, e.y, 5, e.r * 0.7, '#ffffff', 0.3);
          this.burst(e.x, e.y, 30, '#9af4ff', 16, e.r * 1.6, 0.45, 10);
          break;
        case 'dash': {
          const p = this.posOf(g, e.a);
          if (p) this.burst(p.x, p.y, 15, '#ffb547', 12, 200, 0.4, 10);
          break;
        }
        case 'blink':
          this.ring(e.fx, e.fy, 10, 70, '#b07cff', 0.5);
          this.ring(e.tx, e.ty, 70, 10, '#e2d0ff', 0.5);
          this.burst(e.tx, e.ty, 25, '#d4b8ff', 14, 200, 0.5, 12);
          break;
        case 'shield':
        case 'blocked': {
          const p = this.posOf(g, e.k === 'shield' ? e.a : e.b);
          if (p) this.ring(p.x, p.y, 80, 30, '#ffe066', 0.4);
          break;
        }
        case 'pop':
          this.burst(e.x, e.y, 20, '#ffa3a3', 14, 220, 0.5, 12);
          break;
        case 'rain':
          for (let i = 0; i < 22; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * e.r;
            this.meteor(e.x + Math.cos(a) * d, e.y + Math.sin(a) * d, Math.random() * 0.6, i % 3 ? '#ffd23f' : '#9dff7a');
          }
          this.ring(e.x, e.y, 20, e.r * 1.2, '#ffd23f', 0.9);
          break;
        case 'superSpawn':
          this.ring(e.x, e.y, 10, 140, '#ffe066', 0.7);
          for (let i = 0; i < 20; i++) this.spark(e.x, 10, e.y, (Math.random() - 0.5) * 40, 300 + Math.random() * 300, (Math.random() - 0.5) * 40, '#ffd23f', 1.1, 16, -80);
          break;
        case 'eat': {
          const p = this.posOf(g, e.a);
          if (p && Math.random() < 0.5) this.spark(e.x, 8, e.y, (p.x - e.x) * 3, 80, (p.y - e.y) * 3, '#9dff7a', 0.25, 8, 0);
          break;
        }
        default:
          break;
      }
    }
  }

  private spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, life: number, size: number, grav = 600) {
    if (this.sparks.length > 360) {
      const old = this.sparks.shift()!;
      old.s.removeFromParent();
      old.s.material.dispose();
    }
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: css(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.set(x, y, z);
    s.scale.setScalar(size);
    this.scene.add(s);
    this.sparks.push({ s, vx, vy, vz, life, max: life, size, grav });
  }

  private burst(x: number, z: number, h: number, color: string, n: number, speed: number, life: number, size: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.3 + Math.random() * 0.7);
      this.spark(x, h, z, Math.cos(a) * sp, 120 + Math.random() * 220, Math.sin(a) * sp, color, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8));
    }
  }

  private meteor(x: number, z: number, delay: number, color: string) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: css(color), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.setScalar(34);
    s.visible = false;
    this.scene.add(s);
    this.sparks.push({ s, vx: 0, vy: 0, vz: 0, life: 0.55, max: 0.55, size: 34, grav: 0, meteor: { tx: x, tz: z, delay } });
  }

  private ring(x: number, z: number, from: number, to: number, color: string, life: number) {
    const m = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: css(color), transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 4, z);
    m.scale.setScalar(from);
    this.scene.add(m);
    this.rings.push({ m, life, max: life, from, to });
  }

  private updateFx(dt: number) {
    const keep: Spark[] = [];
    for (const p of this.sparks) {
      if (p.meteor && p.meteor.delay > 0) {
        p.meteor.delay -= dt;
        keep.push(p);
        continue;
      }
      p.life -= dt;
      if (p.life <= 0) {
        if (p.meteor) {
          this.burst(p.meteor.tx, p.meteor.tz, 10, '#ffd23f', 5, 160, 0.4, 10);
          this.ring(p.meteor.tx, p.meteor.tz, 6, 46, '#ffd23f', 0.35);
        }
        p.s.removeFromParent();
        p.s.material.dispose();
        continue;
      }
      const k = p.life / p.max;
      if (p.meteor) {
        const f = 1 - k;
        p.s.visible = true;
        p.s.position.set(p.meteor.tx - 260 * (1 - f), 700 * (1 - f) + 10, p.meteor.tz - 200 * (1 - f));
      } else {
        p.vy -= p.grav * dt;
        p.s.position.x += p.vx * dt;
        p.s.position.y = Math.max(2, p.s.position.y + p.vy * dt);
        p.s.position.z += p.vz * dt;
        const drag = Math.pow(0.08, dt);
        p.vx *= drag;
        p.vz *= drag;
        p.s.scale.setScalar(p.size * (0.4 + 0.6 * k));
      }
      p.s.material.opacity = Math.min(1, k * 1.5);
      keep.push(p);
    }
    this.sparks = keep;
    const rk: RingFx[] = [];
    for (const r of this.rings) {
      r.life -= dt;
      if (r.life <= 0) {
        r.m.removeFromParent();
        r.m.material.dispose();
        continue;
      }
      const k = r.life / r.max;
      r.m.scale.setScalar(r.from + (r.to - r.from) * (1 - Math.pow(k, 1.6)));
      r.m.material.opacity = k;
      rk.push(r);
    }
    this.rings = rk;
  }

  /* ------------------------------ quadro ------------------------------ */

  render(g: ClientGame, dt: number) {
    this.game = g;
    this.time += dt;
    const t = this.time;
    const me = g.me;
    const mp = g.myRenderPos();

    // chão (refeito quando o mapa muda)
    const src = this.r2d.groundCanvas;
    if (src && src !== this.groundSrc) {
      this.groundSrc = src;
      const tex = new THREE.CanvasTexture(src);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      this.ground.material.map?.dispose();
      this.ground.material.map = tex;
      this.ground.material.needsUpdate = true;
    }

    // câmera: inclinada, segue o jogador; a distância acompanha o zoom do 2D (cresce com o mutante)
    const cam2d = this.r2d.cam;
    const short = Math.min(viewport.size.w, viewport.size.h);
    const viewWorld = short / Math.max(0.05, cam2d.scale);
    const dist = (viewWorld * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360) * (this.camera.aspect < 1 ? 1.25 : 0.95);
    const tilt = 0.95; // ~54°
    const tx = cam2d.x;
    const tz = cam2d.y;
    const shake = this.r2d.shakeAmount;
    const want = new THREE.Vector3(tx + (Math.random() - 0.5) * shake, Math.sin(tilt) * dist, tz + Math.cos(tilt) * dist + (Math.random() - 0.5) * shake);
    this.camPos.lerp(want, Math.min(1, dt * 6));
    this.camLook.lerp(new THREE.Vector3(tx, 0, tz - viewWorld * 0.04), Math.min(1, dt * 6));
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    // perigos (ácido): refeitos quando a lista muda
    const hk = g.hazards.map((h) => h.join(',')).join('|');
    if (hk !== this.hazardKey) {
      this.hazardKey = hk;
      for (const c of [...this.hazardGroup.children]) {
        c.removeFromParent();
        c.material?.dispose?.();
      }
      for (const [x, y, r] of g.hazards) {
        const pool = new THREE.Mesh(GEO.disc, new THREE.MeshStandardMaterial({ color: '#8dff2a', emissive: new THREE.Color('#5fd000'), emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.85 }));
        pool.rotation.x = -Math.PI / 2;
        pool.position.set(x, 1.5, y);
        pool.scale.setScalar(r);
        this.hazardGroup.add(pool);
        const edge = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({ color: '#ffd23f', side: THREE.DoubleSide }));
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(x, 2, y);
        edge.scale.setScalar(r * 1.04);
        this.hazardGroup.add(edge);
      }
    }
    // bolhas do ácido
    if (Math.random() < dt * 6 && g.hazards.length) {
      const [x, y, r] = g.hazards[Math.floor(Math.random() * g.hazards.length)]!;
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.8;
      this.spark(x + Math.cos(a) * d, 4, y + Math.sin(a) * d, 0, 60 + Math.random() * 40, 0, '#c6ff6a', 1.2, 14, 0);
    }

    // zonas de energia
    const seenZ = new Set<number>();
    for (const [id, x, y, r, life] of g.zones) {
      seenZ.add(id);
      let z = this.zoneObjs.get(id);
      if (!z) {
        z = new THREE.Group();
        const col = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), new THREE.MeshBasicMaterial({ color: '#5ce1ff', transparent: true, opacity: 0.12, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
        col.name = 'col';
        z.add(col);
        const base = new THREE.Mesh(GEO.disc, new THREE.MeshBasicMaterial({ color: '#1fa8d8', transparent: true, opacity: 0.22, depthWrite: false }));
        base.rotation.x = -Math.PI / 2;
        base.position.y = 1;
        base.name = 'base';
        z.add(base);
        for (let i = 0; i < 2; i++) {
          const ringM = new THREE.Mesh(GEO.torus, new THREE.MeshBasicMaterial({ color: i ? '#ffffff' : '#7ff0ff' }));
          ringM.rotation.x = Math.PI / 2;
          ringM.name = `ring${i}`;
          z.add(ringM);
        }
        const core = new THREE.Mesh(GEO.octa, new THREE.MeshBasicMaterial({ color: '#c8f8ff' }));
        core.name = 'core';
        z.add(core);
        this.scene.add(z);
        this.zoneObjs.set(id, z);
      }
      const fade = Math.min(1, life / 3);
      z.position.set(x, 0, y);
      const col = z.getObjectByName('col');
      col.scale.set(r, 140, r);
      col.position.y = 70;
      col.material.opacity = 0.1 * fade;
      z.getObjectByName('base').scale.setScalar(r);
      const r0 = z.getObjectByName('ring0');
      r0.scale.setScalar(r);
      r0.position.y = 6;
      const r1 = z.getObjectByName('ring1');
      r1.scale.setScalar(r * 0.55);
      r1.position.y = 40 + Math.sin(t * 2 + id) * 20;
      r1.rotation.z = t;
      const core = z.getObjectByName('core');
      core.scale.set(16, 26, 16);
      core.position.y = 60 + Math.sin(t * 3) * 8;
      core.rotation.y = t * 2;
      if (Math.random() < dt * 8) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * r;
        this.spark(x + Math.cos(a) * d, 4, y + Math.sin(a) * d, 0, 80 + Math.random() * 60, 0, '#7ff0ff', 1.4, 12, 0);
      }
    }
    for (const [id, z] of this.zoneObjs) {
      if (seenZ.has(id)) continue;
      z.removeFromParent();
      z.traverse((o: Obj) => o.material?.dispose?.());
      this.zoneObjs.delete(id);
    }

    // biomassa
    let n = 0;
    let gold: { x: number; y: number } | null = null;
    const viewR = viewWorld * 1.6;
    for (const p of g.pellets.values()) {
      if (p.kind === 3) {
        gold = p;
        continue;
      }
      if (Math.abs(p.x - tx) > viewR || Math.abs(p.y - tz) > viewR) continue;
      if (n >= this.maxPellets) break;
      const size = p.kind === 1 ? 10 : p.kind === 2 ? 7 + Math.min(6, p.v) : 6.5;
      this.dummy.position.set(p.x, 10 + Math.sin(t * 3 + p.id) * 3, p.y);
      this.dummy.rotation.set(t + p.id, t * 0.7 + p.id, 0);
      this.dummy.scale.setScalar(size);
      this.dummy.updateMatrix();
      this.pellets.setMatrixAt(n, this.dummy.matrix);
      this.pellets.setColorAt(n, tmpColor.set(p.kind === 1 ? '#ffd23f' : p.kind === 2 ? '#ff7a4d' : '#7dff5a'));
      n++;
    }
    this.pellets.count = n;
    this.pellets.instanceMatrix.needsUpdate = true;
    if (this.pellets.instanceColor) this.pellets.instanceColor.needsUpdate = true;
    this.golden.visible = this.goldenRays.visible = !!gold;
    if (gold) {
      const s = 18 * (1 + Math.sin(t * 5) * 0.08);
      this.golden.position.set(gold.x, 24 + Math.sin(t * 2) * 5, gold.y);
      this.golden.scale.setScalar(s);
      this.goldenRays.position.set(gold.x, 3, gold.y);
      this.goldenRays.scale.setScalar(60 + Math.sin(t * 3) * 8);
      if (Math.random() < dt * 10) this.spark(gold.x + (Math.random() - 0.5) * 30, 20, gold.y + (Math.random() - 0.5) * 30, 0, 90, 0, '#ffe066', 1, 10, 0);
    }

    // mutantes
    const views = g.remoteViews();
    const list = views.map((v) => ({ ...v, self: false }));
    if (me?.alive) {
      const f = this.r2d.selfFacing;
      list.push({ id: me.id, x: mp.x, y: mp.y, r: me.r, flags: me.flags, fx: f.x, fy: f.y, vx: g.body.vx, vy: g.body.vy, hp: Math.round((me.hp / me.mhp) * 100), lv: me.lv, self: true });
    }
    const leaderId = g.phase === 'playing' && (g.leaderboard[0]?.[2] ?? 0) > 0 ? g.leaderboard[0]![0] : -99;
    const labelH = viewWorld * 0.032;
    for (const p of list) {
      const meta = g.meta.get(p.id);
      const muts = new Set(meta?.muts ?? []);
      const hyb = new Set(meta?.hyb ?? []);
      const key = `${[...muts].sort().join(',')}|${[...hyb].sort().join(',')}|${meta?.hue ?? 0}|${JSON.stringify(meta?.look ?? {})}|${p.lv >= 6 ? 1 : 0}`;
      let c = this.creatures.get(p.id);
      if (!c || c.key !== key) {
        if (c) disposeCreature(c);
        c = buildCreature(muts, hyb, meta?.hue ?? 200, meta?.look, p.lv, p.id);
        c.key = key;
        this.scene.add(c.root);
        this.creatures.set(p.id, c);
      }
      c.lastSeen = t;
      this.poseCreature(c, p, t, dt, p.id === leaderId);
      // nome e vida
      const cloaked = (p.flags & FLAG.cloak) !== 0;
      const name = `${meta?.name ?? ''}${meta?.bot ? ' · BOT' : ''}`;
      const lk = `${name}|${p.lv}|${p.self ? 1 : 0}`;
      if (c.labelKey !== lk) {
        if (c.label) {
          c.label.material.map?.dispose();
          c.label.material.dispose();
          c.label.removeFromParent();
        }
        const { sprite, aspect } = makeLabel(name, p.lv, p.self ? '#ffe066' : meta?.bot ? '#c9d6f2' : '#ffffff');
        sprite.userData.aspect = aspect;
        this.scene.add(sprite);
        c.label = sprite;
        c.labelKey = lk;
      }
      c.label.visible = !(cloaked && !p.self);
      c.label.scale.set(labelH * c.label.userData.aspect, labelH, 1);
      c.label.position.set(p.x, p.r * 2.25 + labelH * 0.9 + (p.id === leaderId ? p.r * 0.5 : 0), p.y);
      if (!c.hpBg) {
        c.hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#000000', transparent: true, opacity: 0.6, depthTest: false }));
        c.hpFill = new THREE.Sprite(new THREE.SpriteMaterial({ color: '#7dff6a', depthTest: false }));
        c.hpFill.center.set(0, 0.5);
        c.hpBg.renderOrder = c.hpFill.renderOrder = 11;
        this.scene.add(c.hpBg, c.hpFill);
      }
      const showHp = !p.self && p.hp < 100 && !(cloaked && !p.self);
      c.hpBg.visible = c.hpFill.visible = showHp;
      if (showHp) {
        const bw = Math.max(p.r * 1.8, labelH * 2.4);
        const bh = labelH * 0.22;
        const by = p.r * 2.25 + labelH * 0.2;
        c.hpBg.position.set(p.x, by, p.y);
        c.hpBg.scale.set(bw, bh, 1);
        // a barra preenche da esquerda para a direita na tela (eixo X do mundo)
        c.hpFill.position.set(p.x - bw / 2, by, p.y);
        c.hpFill.scale.set(Math.max(0.001, (bw * p.hp) / 100), bh * 0.7, 1);
        c.hpFill.material.color.set(p.hp > 50 ? '#7dff6a' : p.hp > 25 ? '#ffd23f' : '#ff4d6d');
      }
    }
    for (const [id, c] of this.creatures) {
      if (c.lastSeen === t) continue;
      disposeCreature(c);
      this.creatures.delete(id);
    }

    // iscas (cópia translúcida do dono)
    const seenD = new Set<number>();
    for (const d of g.decoys.values()) {
      seenD.add(d.id);
      const meta = g.meta.get(d.owner);
      let c = this.decoys.get(d.id);
      if (!c) {
        c = buildCreature(new Set(meta?.muts ?? []), new Set(meta?.hyb ?? []), meta?.hue ?? 0, meta?.look, 0, d.owner);
        for (const m of c.materials) {
          m.transparent = true;
          m.opacity = Math.min(m.opacity ?? 1, 0.85);
        }
        this.scene.add(c.root);
        this.decoys.set(d.id, c);
      }
      const r = (d.owner === g.myId ? me?.r : views.find((v) => v.id === d.owner)?.r) ?? 26;
      this.poseCreature(c, { x: d.x, y: d.y, r, flags: 0, fx: d.fx, fy: d.fy, vx: d.fx * 200, vy: d.fy * 200, id: d.owner }, t, dt, false);
    }
    for (const [id, c] of this.decoys) {
      if (seenD.has(id)) continue;
      disposeCreature(c);
      this.decoys.delete(id);
    }

    this.updateFx(dt);
    this.renderer.render(this.scene, this.camera);
  }

  private poseCreature(c: Creature, p: { x: number; y: number; r: number; flags: number; fx: number; fy: number; vx: number; vy: number; id: number; self?: boolean }, t: number, dt: number, leader: boolean) {
    const r = p.r;
    c.root.position.set(p.x, 0, p.y);
    c.root.scale.setScalar(r);
    // direção suave
    const want = Math.atan2(p.fy, p.fx);
    let d = want - c.facing;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    c.facing += d * Math.min(1, dt * 12);
    c.body.rotation.y = -c.facing;
    // respiração, esticar com a velocidade e bote da mordida
    const speed = Math.hypot(p.vx, p.vy);
    const dashing = (p.flags & FLAG.dashing) !== 0;
    const stretch = 1 + Math.min(0.18, speed / 1500) + (dashing ? 0.15 : 0);
    const breathe = 1 + Math.sin(t * 2.4 + c.seed) * 0.03;
    const bt = t - c.biteT;
    const lunge = bt < 0.25 ? Math.sin((bt / 0.25) * Math.PI) * 0.25 : 0;
    c.bodyMesh.scale.set(stretch * breathe, 0.82 * (2 - breathe), (1 / Math.sqrt(stretch)) * breathe);
    c.body.position.set(Math.cos(c.facing) * lunge, Math.abs(Math.sin(t * 6 + c.seed)) * Math.min(0.12, speed / 2500), Math.sin(c.facing) * lunge);
    // cauda balançando, pernas andando
    c.tail.forEach((s, i) => (s.rotation.y = Math.sin(t * (6 + speed / 60) - i * 0.9) * 0.35));
    c.legs.forEach((l, i) => (l.rotation.z = Math.sin(t * (4 + speed / 40) + (i % 2) * Math.PI) * 0.5));
    c.orbiters.forEach((o, i) => {
      const a = t * 1.8 + (i * Math.PI * 2) / 3;
      o.position.set(Math.cos(a) * 1.45, 1 + Math.sin(a * 2) * 0.15, Math.sin(a) * 1.45);
      o.rotation.y = t * 3;
    });
    c.auras.forEach((a, i) => (a.rotation.z = t * (i % 2 ? -0.9 : 0.9)));
    c.shield.visible = (p.flags & FLAG.shield) !== 0;
    if (c.shield.visible) c.shield.rotation.y = t;
    c.crown.visible = leader;
    if (leader) {
      c.crown.position.y = 2.15 + Math.sin(t * 3) * 0.08;
      c.crown.rotation.y = t * 0.8;
    }
    // transparência (camuflagem, proteção, desconectado) e brilho de dano
    let alpha = 1;
    if (p.flags & FLAG.cloak) alpha = p.self ? 0.45 : 0.15;
    if (p.flags & FLAG.protected) alpha *= 0.6 + 0.4 * Math.abs(Math.sin(t * 10));
    if (p.flags & FLAG.disconnected) alpha *= 0.5;
    const hurt = (p.flags & FLAG.hurt) !== 0;
    for (const m of c.materials) {
      if (m.userData.baseOpacity === undefined) m.userData.baseOpacity = m.opacity ?? 1;
      const want2 = m.userData.baseOpacity * alpha;
      if (alpha < 1 && !m.transparent) {
        m.transparent = true;
        m.needsUpdate = true;
      }
      m.opacity = want2;
    }
    const bm = c.bodyMesh.material;
    if (hurt) {
      bm.emissive.set('#ff2040');
      bm.emissiveIntensity = 0.9;
    } else if (bm.emissiveIntensity > 0.2) {
      bm.emissive.set(bm.userData.emissiveBase ?? '#000000');
      bm.emissiveIntensity = 0.18;
    }
    c.shadow.material.opacity = 0.35 * alpha;
  }
}
