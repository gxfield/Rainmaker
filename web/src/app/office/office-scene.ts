/**
 * The office: a small isometric pixel-art diorama of Rainmaker's agents at work.
 *
 * Everything is procedural: boxes with vertex colours, merged into a few meshes. The scene
 * renders at a low resolution with soft depth and normal edge outlines, and the canvas is
 * scaled up with nearest-neighbour filtering, so it reads as crisp pixel art.
 *
 * Agents wander between spots in the office (coffee, the sofa, the window, the whiteboard).
 * When work arrives (a running job, or a demo event) a free agent walks to a free desk, sits
 * and types. A one-word status floats over each agent.
 *
 * This file is plain three.js with no React, so the dashboard can lazy load it.
 */
import * as THREE from "three";

/* ------------------------------------------------------------------ types */

export type OfficeTheme = "dark" | "light" | "midnight" | "ember" | "matrix";
export type OfficeMode = "live" | "demo";
export type OfficeJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** One Rainmaker job, as the office needs it. */
export interface OfficeJob {
  id: number;
  status: OfficeJobStatus;
  /** The job's agent is waiting for an answer. */
  question: boolean;
}

export interface OfficeSummary {
  working: number;
  question: number;
  waiting: number;
  /** Active jobs beyond the four agents in the office. */
  overflow: number;
}

export interface OfficeOptions {
  theme: OfficeTheme;
  mode: OfficeMode;
  expanded: boolean;
  /** Called when the counts of working, waiting and questioning agents change. */
  onSummary?: (summary: OfficeSummary) => void;
}

/* ---------------------------------------------------------------- helpers */

type V2 = { x: number; z: number };
const v2 = (x: number, z: number): V2 => ({ x, z });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const damp = (a: number, b: number, rate: number, dt: number) => lerp(a, b, 1 - Math.exp(-rate * dt));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a: number, b: number, rate: number, dt: number) => a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt));
const ease = (t: number) => t * t * (3 - 2 * t);
const dist = (a: V2, b: V2) => Math.hypot(a.x - b.x, a.z - b.z);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** A small seeded random generator, so the office looks the same on every load. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------------------------------------------------------- palette */

const P = {
  plankA: 0xd8b68e, plankB: 0xcba77e, plankC: 0xe0c19a,
  plinth: 0x9c8b78, plinthTop: 0xb8aa96,
  wall: 0xf2ece2, wallLow: 0xc5d4cb, trim: 0xfbf8f2, wallCut: 0x6e6157, baseboard: 0x93a59a,
  deskTop: 0xf3ebde, deskSide: 0xe1d6c4, metal: 0x3d4350, metalLight: 0x8d95a3,
  monitor: 0x272b33, keyboard: 0x3b414c,
  chair: 0x4f5b6e, chairSeat: 0x627089,
  sofa: 0x5c8f84, sofaCushion: 0x6ea495,
  wood: 0xa8774f, woodDark: 0x7d5538, woodLight: 0xcb9c6b,
  potClay: 0xc9714b, potWhite: 0xece8df, potDark: 0x4b505a,
  leafA: 0x5aa35a, leafB: 0x458a4a, leafC: 0x7dbe66,
  counter: 0xf4f0e9, cabinet: 0x9cbdb1, cabinetDark: 0x86a99c, steel: 0xbac1cb, fridge: 0xe9ecf0,
  black: 0x2a2b30, white: 0xf7f7f5, paper: 0xfffcf3,
  grassA: 0x8bc272, grassB: 0x7fb966, grassC: 0x97ca7b, grassD: 0x86be6c,
  stone: 0xd8d0c0, stoneB: 0xc8bfad,
  soilA: 0x8b6547, soilB: 0x6f4f37, soilC: 0x573d2a,
  trunk: 0x7d5a3c, treeA: 0x5f9f52, treeB: 0x4c8a47, treeC: 0x76b660,
  pink: 0xf29bb5, yellow: 0xf6d364, blue: 0x8db8f0, red: 0xe5675a,
  books: [0xd9695c, 0x5f8fd9, 0xe8c25a, 0x6fbf8e, 0x9a7ad6, 0xf0a35e, 0x4fa7b3],
};

/* ---------------------------------------------------------- theme looks */

interface Look {
  sun: number; sunI: number; sunEl: number; sunAz: number;
  fill: number; fillI: number;
  sky: number; ground: number; hemiI: number;
  glassTop: number; glassBottom: number; stars: number;
  lamp: number; lampI: number;
  beam: number; beamI: number;
  motes: number; fireflies: number;
  screenI: number;
  outline: number; highlight: number;
  sat: number; matrix: number;
}

const LOOKS: Record<OfficeTheme, Look> = {
  dark: {
    sun: 0xfff0d8, sunI: 2.1, sunEl: 44, sunAz: -90,
    fill: 0xdfe7ff, fillI: 0.75,
    sky: 0xd5e3ff, ground: 0xb7a58f, hemiI: 1.05,
    glassTop: 0x7fbcf0, glassBottom: 0xc9e6fb, stars: 0,
    lamp: 0xffd9a0, lampI: 0,
    beam: 0xfff3d6, beamI: 0.1,
    motes: 0.45, fireflies: 0,
    screenI: 1,
    outline: 0.42, highlight: 0.22,
    sat: 1, matrix: 0,
  },
  light: {
    sun: 0xfff3dc, sunI: 2.3, sunEl: 48, sunAz: -90,
    fill: 0xe8eeff, fillI: 0.85,
    sky: 0xe0ebff, ground: 0xc4b39c, hemiI: 1.15,
    glassTop: 0x8cc6f4, glassBottom: 0xd3ecfc, stars: 0,
    lamp: 0xffd9a0, lampI: 0,
    beam: 0xfff6e0, beamI: 0.09,
    motes: 0.4, fireflies: 0,
    screenI: 1,
    outline: 0.36, highlight: 0.2,
    sat: 1.02, matrix: 0,
  },
  midnight: {
    sun: 0x9fb0ff, sunI: 0.75, sunEl: 52, sunAz: -90,
    fill: 0x7584ff, fillI: 0.42,
    sky: 0x5465b5, ground: 0x232848, hemiI: 0.7,
    glassTop: 0x141d45, glassBottom: 0x2f3d7c, stars: 1,
    lamp: 0xffc982, lampI: 1,
    beam: 0x9fb2ff, beamI: 0.05,
    motes: 0.15, fireflies: 1,
    screenI: 1.6,
    outline: 0.5, highlight: 0.16,
    sat: 1.05, matrix: 0,
  },
  ember: {
    sun: 0xffa25c, sunI: 2.4, sunEl: 22, sunAz: -84,
    fill: 0xffc9a0, fillI: 0.45,
    sky: 0xffc097, ground: 0x6a4636, hemiI: 0.8,
    glassTop: 0xff9a62, glassBottom: 0xffd79c, stars: 0,
    lamp: 0xffb46a, lampI: 0.45,
    beam: 0xffb070, beamI: 0.16,
    motes: 0.6, fireflies: 0.15,
    screenI: 1.2,
    outline: 0.46, highlight: 0.2,
    sat: 1.06, matrix: 0,
  },
  matrix: {
    sun: 0xffffff, sunI: 2.1, sunEl: 44, sunAz: -90,
    fill: 0xffffff, fillI: 0.75,
    sky: 0xffffff, ground: 0x999999, hemiI: 1.0,
    glassTop: 0x9fcfff, glassBottom: 0xe3f2ff, stars: 0,
    lamp: 0xffffff, lampI: 0,
    beam: 0xffffff, beamI: 0.1,
    motes: 0.6, fireflies: 0,
    screenI: 1.3,
    outline: 0.6, highlight: 0.3,
    sat: 1, matrix: 1,
  },
};

/** Status label colours on the 2D overlay, per theme. */
const TAGS: Record<OfficeTheme, { bg: string; text: string; muted: string; accent: string }> = {
  dark: { bg: "rgba(18,18,22,0.86)", text: "#f4f4f5", muted: "#a1a1aa", accent: "#60a5fa" },
  light: { bg: "rgba(255,255,255,0.94)", text: "#18181b", muted: "#71717a", accent: "#3b82f6" },
  midnight: { bg: "rgba(9,13,32,0.88)", text: "#e3eaf8", muted: "#8494b8", accent: "#a78bfa" },
  ember: { bg: "rgba(23,17,13,0.88)", text: "#fbf7f2", muted: "#ad9479", accent: "#fb923c" },
  matrix: { bg: "rgba(0,0,0,0.9)", text: "#00ff41", muted: "#12862f", accent: "#00ff41" },
};

/* ------------------------------------------------------- geometry builder */

/** Each face: its normal, then four corners as (x, y, z) picks of the min (0) or max (1). */
const FACES: [number[], number[][]][] = [
  [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]]],
  [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]]],
  [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]]],
  [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]]],
  [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]]],
  [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]]],
];

interface BoxStyle {
  /** Colour of the top face. */
  top?: number;
  /** Darken the bottom corners by this much, a cheap ambient occlusion. */
  ao?: number;
  /** Extra per-vertex value (for example how much a vertex sways). */
  extra?: number;
  /** Only the top face, for tiles that sit on a slab (no seams in the edge pass). */
  topOnly?: boolean;
}

/** Collects coloured boxes into one BufferGeometry, with a transform stack. */
class Builder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private ext: number[] = [];
  private idx: number[] = [];
  private m = new THREE.Matrix4();
  private stack: THREE.Matrix4[] = [];
  private v = new THREE.Vector3();
  private n = new THREE.Vector3();
  private c = new THREE.Color();
  private t = new THREE.Color();

  push(x: number, y: number, z: number, rotY = 0): this {
    this.stack.push(this.m.clone());
    this.m.multiply(new THREE.Matrix4().makeRotationY(rotY).setPosition(x, y, z));
    return this;
  }

  pop(): this {
    this.m.copy(this.stack.pop() ?? new THREE.Matrix4());
    return this;
  }

  /** The current transform applied to a local point, in world x/z. */
  world(x: number, z: number, y = 0): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyMatrix4(this.m);
  }

  get matrix(): THREE.Matrix4 {
    return this.m.clone();
  }

  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, style: BoxStyle = {}): this {
    const lo = [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)];
    const hi = [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)];
    this.c.set(color);
    if (style.top !== undefined) this.t.set(style.top);
    for (let f = 0; f < 6; f++) {
      if (style.topOnly && f !== 2) continue;
      const [normal, corners] = FACES[f];
      const base = this.pos.length / 3;
      const fc = f === 2 && style.top !== undefined ? this.t : this.c;
      this.n.set(normal[0], normal[1], normal[2]).transformDirection(this.m);
      for (const k of corners) {
        this.v.set(k[0] ? hi[0] : lo[0], k[1] ? hi[1] : lo[1], k[2] ? hi[2] : lo[2]).applyMatrix4(this.m);
        this.pos.push(this.v.x, this.v.y, this.v.z);
        this.nor.push(this.n.x, this.n.y, this.n.z);
        const s = k[1] === 0 && style.ao ? 1 - style.ao : 1;
        this.col.push(fc.r * s, fc.g * s, fc.b * s);
        this.ext.push((style.extra ?? 0) * (k[1] ? 1 : 0.6));
      }
      this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  get empty(): boolean {
    return this.idx.length === 0;
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("extra", new THREE.Float32BufferAttribute(this.ext, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/* ---------------------------------------------------------------- layout */

const W = 14; // office floor, x
const D = 11; // office floor, z
const WALL_H = 3;
const WT = 0.3; // wall thickness
const SILL = 0.95;
const WIN_TOP = 2.5;
const WINDOWS: [number, number][] = [
  [1.4, 3.2],
  [4.4, 6.2],
  [7.4, 9.2],
];
const BASE = { x0: -8, z0: -7, x1: 22, z1: 18.5 };
const ENTRANCE: [number, number] = [10.4, 11.8];

type Activity = "type" | "coffee" | "water" | "snack" | "read" | "think" | "print" | "window" | "lounge" | "chat" | "plants" | "wait" | "stroll";

const ACTIVITY_WORD: Record<Activity, string> = {
  type: "working",
  coffee: "coffee",
  water: "water",
  snack: "snack",
  read: "reading",
  think: "thinking",
  print: "printing",
  window: "daydream",
  lounge: "break",
  chat: "chatting",
  plants: "watering",
  wait: "waiting",
  stroll: "idle",
};

interface Spot {
  id: string;
  activity: Activity;
  /** Where the agent stands (or walks to before sitting). */
  approach: V2;
  /** Heading while here: 0 faces +z, PI/2 faces +x. */
  face: number;
  /** Sit here; y is the seat top. */
  seat?: { x: number; z: number; y: number };
  desk?: number;
  /** How often idle agents choose it. 0 = never at random. */
  weight: number;
  /** Seconds an idle agent stays. */
  stay: [number, number];
  by: Agent | null;
  group?: string;
}

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

interface Swayer {
  obj: THREE.Object3D;
  amount: number;
  speed: number;
  phase: number;
}

interface ScreenRef {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  state: number;
  until: number;
}

/* ------------------------------------------------------------ navigation */

const CELL = 0.25;

/** A walkable grid over the office floor, with A* and line-of-sight path smoothing. */
class NavGrid {
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(
    private x0: number,
    private z0: number,
    x1: number,
    z1: number,
  ) {
    this.cols = Math.round((x1 - x0) / CELL);
    this.rows = Math.round((z1 - z0) / CELL);
    this.blocked = new Uint8Array(this.cols * this.rows);
  }

  block(r: Rect, pad: number): void {
    const c0 = Math.floor((r.x0 - pad - this.x0) / CELL);
    const c1 = Math.ceil((r.x1 + pad - this.x0) / CELL) - 1;
    const r0 = Math.floor((r.z0 - pad - this.z0) / CELL);
    const r1 = Math.ceil((r.z1 + pad - this.z0) / CELL) - 1;
    for (let r = Math.max(0, r0); r <= Math.min(this.rows - 1, r1); r++)
      for (let c = Math.max(0, c0); c <= Math.min(this.cols - 1, c1); c++) this.blocked[r * this.cols + c] = 1;
  }

  private cell(p: V2): [number, number] {
    return [clamp(Math.floor((p.x - this.x0) / CELL), 0, this.cols - 1), clamp(Math.floor((p.z - this.z0) / CELL), 0, this.rows - 1)];
  }

  private center(i: number): V2 {
    return v2(this.x0 + ((i % this.cols) + 0.5) * CELL, this.z0 + (Math.floor(i / this.cols) + 0.5) * CELL);
  }

  free(p: V2): boolean {
    const [c, r] = this.cell(p);
    return !this.blocked[r * this.cols + c];
  }

  /** The nearest free cell to p (p itself when free). */
  nearestFree(p: V2): V2 {
    if (this.free(p)) return p;
    const [c0, r0] = this.cell(p);
    for (let ring = 1; ring < 12; ring++)
      for (let dr = -ring; dr <= ring; dr++)
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) continue;
          if (!this.blocked[r * this.cols + c]) return this.center(r * this.cols + c);
        }
    return p;
  }

  randomFree(): V2 {
    for (let i = 0; i < 200; i++) {
      const k = Math.floor(Math.random() * this.blocked.length);
      if (!this.blocked[k]) return this.center(k);
    }
    return v2(W / 2, D / 2);
  }

  /** Whether the straight line a→b stays on free cells. */
  los(a: V2, b: V2): boolean {
    const d = dist(a, b);
    const steps = Math.ceil(d / (CELL * 0.4));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (!this.free(v2(lerp(a.x, b.x, t), lerp(a.z, b.z, t)))) return false;
    }
    return true;
  }

  find(from: V2, to: V2): V2[] {
    const start = this.nearestFree(from);
    const goal = this.nearestFree(to);
    const [sc, sr] = this.cell(start);
    const [gc, gr] = this.cell(goal);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const s = sr * this.cols + sc;
    const goalI = gr * this.cols + gc;
    const h = (i: number) => {
      const dx = Math.abs((i % this.cols) - gc);
      const dz = Math.abs(Math.floor(i / this.cols) - gr);
      return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
    };
    const heap: [number, number][] = [[h(s), s]];
    g[s] = 0;
    const push = (f: number, i: number) => {
      heap.push([f, i]);
      let k = heap.length - 1;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heap[p][0] <= heap[k][0]) break;
        [heap[p], heap[k]] = [heap[k], heap[p]];
        k = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let k = 0;
        for (;;) {
          const l = 2 * k + 1;
          const r = l + 1;
          let m = k;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === k) break;
          [heap[m], heap[k]] = [heap[k], heap[m]];
          k = m;
        }
      }
      return top;
    };
    let found = false;
    while (heap.length) {
      const [, i] = pop();
      if (closed[i]) continue;
      closed[i] = 1;
      if (i === goalI) {
        found = true;
        break;
      }
      const c = i % this.cols;
      const r = Math.floor(i / this.cols);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const j = nr * this.cols + nc;
          if (this.blocked[j] || closed[j]) continue;
          // No corner cutting.
          if (dr && dc && (this.blocked[r * this.cols + nc] || this.blocked[nr * this.cols + c])) continue;
          const cost = g[i] + (dr && dc ? 1.414 : 1);
          if (cost < g[j]) {
            g[j] = cost;
            came[j] = i;
            push(cost + h(j), j);
          }
        }
    }
    if (!found) return [to];
    const cells: V2[] = [];
    for (let i = goalI; i !== -1; i = came[i]) cells.push(this.center(i));
    cells.reverse();
    cells[0] = from;
    cells[cells.length - 1] = to;
    // Pull the string: keep only the corners that line of sight needs.
    const out: V2[] = [];
    let a = 0;
    while (a < cells.length - 1) {
      let b = cells.length - 1;
      while (b > a + 1 && !this.los(cells[a], cells[b])) b--;
      out.push(cells[b]);
      a = b;
    }
    return out;
  }
}

/* ----------------------------------------------------------------- agents */

interface AgentLook {
  skin: number;
  hair: number;
  shirt: number;
  pants: number;
  shoes: number;
  hairStyle: "bob" | "short" | "bun" | "beanie";
  extra: "headphones" | "glasses" | "none";
  beanie?: number;
}

const AGENT_LOOKS: AgentLook[] = [
  { skin: 0xf2c6a0, hair: 0x4a2f22, shirt: 0xe9806e, pants: 0x3b4252, shoes: 0x2a2a30, hairStyle: "bob", extra: "headphones" },
  { skin: 0x9c6744, hair: 0x1f1b1a, shirt: 0x3fa39a, pants: 0x46506a, shoes: 0x2a2a30, hairStyle: "short", extra: "glasses" },
  { skin: 0xf6d5bb, hair: 0xd9893f, shirt: 0xf0c04f, pants: 0x5a4a3f, shoes: 0x3a2a24, hairStyle: "bun", extra: "none" },
  { skin: 0xd8a47e, hair: 0x2f2a3a, shirt: 0x8c7bd8, pants: 0x34394a, shoes: 0x2a2a30, hairStyle: "beanie", extra: "none", beanie: 0x3f5c8a },
];

type Step =
  | { kind: "walk"; to: V2; path?: V2[]; hurry: boolean; blockedFor: number }
  | { kind: "turn"; face: number }
  | { kind: "sit"; spot: Spot; t: number; from: V2 }
  | { kind: "stand"; t: number; from: V2; to: V2; seatY: number }
  | { kind: "do" };

type JobState = "queued" | "running" | "question";
type Mood = "shipped" | "issue" | "stopped";

interface Pose {
  walk: number;
  type: number;
  raise: number;
  cheer: number;
  scratch: number;
  hold: number;
  point: number;
  lean: number;
  phone: number;
  shrug: number;
}

class Agent {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly torso = new THREE.Group();
  readonly head = new THREE.Group();
  readonly legL = new THREE.Group();
  readonly legR = new THREE.Group();
  readonly armL = new THREE.Group();
  readonly armR = new THREE.Group();
  eyes!: THREE.Mesh;
  props: Record<"mug" | "book" | "phone" | "can", THREE.Mesh> = {} as never;

  pos: V2;
  heading: number;
  speed = 0;
  phase = Math.random() * 6;
  plan: Step[] = [];
  spot: Spot | null = null;
  seatT = 0;
  seatY = 0.46;
  stayUntil = 0;
  /** Seconds to stay once the agent reaches its spot. */
  stayFor = 0;
  job: { id: number; state: JobState } | null = null;
  mood: { word: Mood; until: number } | null = null;
  pose: Pose = { walk: 0, type: 0, raise: 0, cheer: 0, scratch: 0, hold: 0, point: 0, lean: 0, phone: 0, shrug: 0 };
  blinkAt = rand(1, 4);
  lookYaw = 0;
  lookTarget = 0;
  lookAt = 0;
  hop = 0;
  yielding = false;
  word = "idle";

  constructor(
    readonly index: number,
    readonly look: AgentLook,
    mat: THREE.Material,
    start: V2,
  ) {
    this.pos = { ...start };
    this.heading = Math.random() * Math.PI * 2;
    this.build(mat);
  }

  private part(b: Builder, mat: THREE.Material, parent: THREE.Object3D): THREE.Mesh {
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private build(mat: THREE.Material): void {
    const L = this.look;
    this.root.add(this.body);
    this.body.add(this.legL, this.legR, this.torso);
    this.torso.add(this.armL, this.armR, this.head);

    // Legs hang from the hips (y = 0.4).
    for (const [leg, x] of [
      [this.legL, -0.11],
      [this.legR, 0.11],
    ] as const) {
      leg.position.set(x, 0.4, 0);
      const b = new Builder();
      b.box(-0.075, -0.33, -0.085, 0.075, 0.02, 0.085, L.pants);
      b.box(-0.08, -0.4, -0.09, 0.08, -0.32, 0.13, L.shoes);
      this.part(b, mat, leg);
    }

    // Torso sits on the hips.
    this.torso.position.set(0, 0.4, 0);
    {
      const b = new Builder();
      b.box(-0.22, 0.06, -0.14, 0.22, 0.42, 0.14, L.shirt);
      b.box(-0.225, 0, -0.145, 0.225, 0.08, 0.145, L.pants);
      // A small collar.
      b.box(-0.1, 0.38, 0.1, 0.1, 0.43, 0.15, new THREE.Color(L.shirt).multiplyScalar(0.85).getHex());
      this.part(b, mat, this.torso);
    }

    // Arms hang from the shoulders.
    for (const [arm, x] of [
      [this.armL, -0.28],
      [this.armR, 0.28],
    ] as const) {
      arm.position.set(x, 0.38, 0);
      const b = new Builder();
      b.box(-0.06, -0.22, -0.07, 0.06, 0.03, 0.07, L.shirt);
      b.box(-0.055, -0.35, -0.065, 0.055, -0.22, 0.065, L.skin);
      this.part(b, mat, arm);
    }

    // Props held in the right hand.
    const prop = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: number, extra?: (b: Builder) => void) => {
      const b = new Builder();
      b.box(x0, y0, z0, x1, y1, z1, color);
      extra?.(b);
      const m = this.part(b, mat, this.armR);
      m.visible = false;
      return m;
    };
    this.props.mug = prop(-0.05, -0.42, 0.02, 0.05, -0.3, 0.12, P.white, (b) => b.box(-0.04, -0.33, 0.02, 0.04, -0.31, 0.11, 0x6b4a33));
    this.props.book = prop(-0.1, -0.42, 0.04, 0.1, -0.3, 0.2, P.books[this.index % P.books.length], (b) => b.box(-0.09, -0.3, 0.05, 0.09, -0.29, 0.19, P.paper));
    this.props.phone = prop(-0.05, -0.38, 0.03, 0.05, -0.36, 0.17, P.black);
    this.props.can = prop(-0.06, -0.44, 0.0, 0.06, -0.3, 0.14, 0x5fae7a, (b) => b.box(-0.02, -0.34, 0.14, 0.02, -0.31, 0.3, 0x5fae7a));

    // Head on top of the torso, face toward +z.
    this.head.position.set(0, 0.42, 0);
    {
      const b = new Builder();
      b.box(-0.26, 0, -0.23, 0.26, 0.46, 0.23, L.skin);
      // Cheeks.
      b.box(-0.21, 0.1, 0.225, -0.13, 0.15, 0.235, 0xf08f8f);
      b.box(0.13, 0.1, 0.225, 0.21, 0.15, 0.235, 0xf08f8f);
      const hair = L.hair;
      switch (L.hairStyle) {
        case "bob":
          b.box(-0.285, 0.34, -0.255, 0.285, 0.52, 0.255, hair);
          b.box(-0.285, 0.05, -0.255, 0.285, 0.36, -0.12, hair);
          b.box(-0.285, 0.08, -0.255, -0.22, 0.36, 0.14, hair);
          b.box(0.22, 0.08, -0.255, 0.285, 0.36, 0.14, hair);
          b.box(-0.27, 0.34, 0.2, 0.06, 0.44, 0.255, hair);
          break;
        case "short":
          b.box(-0.275, 0.36, -0.245, 0.275, 0.5, 0.245, hair);
          b.box(-0.275, 0.18, -0.245, 0.275, 0.4, -0.13, hair);
          b.box(-0.275, 0.26, -0.245, -0.235, 0.4, 0.1, hair);
          b.box(0.235, 0.26, -0.245, 0.275, 0.4, 0.1, hair);
          break;
        case "bun":
          b.box(-0.275, 0.35, -0.245, 0.275, 0.5, 0.245, hair);
          b.box(-0.275, 0.12, -0.245, 0.275, 0.4, -0.12, hair);
          b.box(-0.275, 0.2, -0.245, -0.235, 0.4, 0.12, hair);
          b.box(0.235, 0.2, -0.245, 0.275, 0.4, 0.12, hair);
          b.box(-0.1, 0.48, -0.16, 0.1, 0.66, 0.04, hair);
          break;
        case "beanie": {
          const hat = L.beanie ?? 0x3f5c8a;
          b.box(-0.275, 0.2, -0.245, 0.275, 0.36, -0.12, hair);
          b.box(-0.28, 0.34, -0.25, 0.28, 0.56, 0.25, hat);
          b.box(-0.295, 0.3, -0.265, 0.295, 0.39, 0.265, new THREE.Color(hat).multiplyScalar(0.78).getHex());
          b.box(-0.06, 0.56, -0.06, 0.06, 0.65, 0.06, P.white);
          break;
        }
      }
      if (L.extra === "headphones") {
        b.box(-0.3, 0.46, -0.045, 0.3, 0.55, 0.045, 0x30343c);
        b.box(-0.33, 0.12, -0.09, -0.27, 0.34, 0.09, 0x30343c);
        b.box(0.27, 0.12, -0.09, 0.33, 0.34, 0.09, 0x30343c);
      }
      if (L.extra === "glasses") {
        b.box(-0.24, 0.16, 0.235, 0.24, 0.19, 0.255, 0x1e2026);
        b.box(-0.22, 0.16, 0.235, -0.04, 0.3, 0.25, 0x1e2026);
        b.box(0.04, 0.16, 0.235, 0.22, 0.3, 0.25, 0x1e2026);
      }
      this.part(b, mat, this.head);
      const e = new Builder();
      e.box(-0.17, 0.17, 0.23, -0.07, 0.29, 0.245, 0x1d1d22);
      e.box(0.07, 0.17, 0.23, 0.17, 0.29, 0.245, 0x1d1d22);
      this.eyes = this.part(e, mat, this.head);
      this.eyes.castShadow = false;
    }
  }

  /** Seated, standing or in between: the height of the hips above the floor. */
  get seated(): boolean {
    return this.seatT > 0.001;
  }

  /** Where the status label goes, in world space. */
  labelAnchor(out: THREE.Vector3): THREE.Vector3 {
    const y = 1.62 + this.body.position.y;
    return out.set(this.pos.x, y, this.pos.z);
  }
}

/* ------------------------------------------------------------- the font */

const GLYPHS: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "?": ["##.", "..#", ".#.", "...", ".#."],
  "!": ["#", "#", "#", ".", "#"],
  "#": ["#.#", "###", "#.#", "###", "#.#"],
  "0": [".#.", "#.#", "#.#", "#.#", ".#."],
  "1": [".#", "##", ".#", ".#", ".#"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  " ": ["..", "..", "..", "..", ".."],
};

function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += (GLYPHS[ch] ?? GLYPHS[" "])[0].length + 1;
  return Math.max(0, w - 1);
}

function drawText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[" "];
    for (let r = 0; r < g.length; r++) for (let c = 0; c < g[r].length; c++) if (g[r][c] === "#") ctx.fillRect(x + c, y + r, 1, 1);
    x += g[0].length + 1;
  }
}

/* ---------------------------------------------------------------- shaders */

const SCREEN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SCREEN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uState; // 0 idle, 1 typing, 2 question, 3 issue, 4 shipped
uniform float uSeed;
uniform float uPower;
uniform vec3 uAccent;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
// 3x5 glyph bits, row 0 at the top.
float glyph(int id, vec2 cell) {
  int x = int(cell.x), y = int(cell.y);
  if (x < 0 || x > 2 || y < 0 || y > 4) return 0.0;
  int rows[5];
  if (id == 0) { rows[0] = 6; rows[1] = 1; rows[2] = 2; rows[3] = 0; rows[4] = 2; }      // ?
  else if (id == 1) { rows[0] = 2; rows[1] = 2; rows[2] = 2; rows[3] = 0; rows[4] = 2; } // !
  else { rows[0] = 0; rows[1] = 1; rows[2] = 2; rows[3] = 4; rows[4] = 0; }             // tick
  int bits = rows[0];
  if (y == 1) bits = rows[1];
  if (y == 2) bits = rows[2];
  if (y == 3) bits = rows[3];
  if (y == 4) bits = rows[4];
  return mod(floor(float(bits) / pow(2.0, float(2 - x))), 2.0);
}
void main() {
  vec3 bg = vec3(0.025, 0.03, 0.05);
  vec3 c = bg;
  vec2 grid = vec2(14.0, 8.0);
  vec2 cell = floor(vUv * grid);
  float row = grid.y - 1.0 - cell.y;
  if (uState < 0.5) {
    // Screensaver: a slow drifting dot.
    float t = uTime * 0.35 + uSeed * 7.0;
    vec2 p = vec2(0.5 + 0.32 * sin(t), 0.5 + 0.28 * cos(t * 1.31));
    float d = length((vUv - p) * vec2(1.75, 1.0));
    c = mix(bg, uAccent * 0.55, step(d, 0.13));
  } else if (uState < 1.5 || uState > 4.5) {
    // Code being typed: lines scroll up as new ones are written.
    float speed = 1.6;
    float tt = uTime * speed + uSeed * 31.0;
    float line = row + floor(tt);
    float len = 2.0 + floor(hash(vec2(line, uSeed)) * 10.0);
    float indent = floor(hash(vec2(line, uSeed + 3.1)) * 3.0);
    if (row == grid.y - 1.0) len = floor(fract(tt) * len) + 1.0;
    float x = cell.x - 1.0;
    if (x >= indent && x < indent + len) {
      float tok = hash(vec2(line, floor((x - indent) / 3.0) + uSeed));
      c = tok < 0.34 ? uAccent : tok < 0.7 ? vec3(0.78, 0.8, 0.86) : vec3(0.95, 0.68, 0.32);
      c *= 0.9;
    }
    if (row == grid.y - 1.0 && x == indent + len && fract(uTime * 2.5) < 0.6) c = vec3(0.95);
  } else {
    int id = uState < 2.5 ? 0 : uState < 3.5 ? 1 : 2;
    vec3 tint = id == 0 ? vec3(0.98, 0.78, 0.15) : id == 1 ? vec3(0.95, 0.25, 0.32) : vec3(0.45, 0.85, 0.2);
    vec2 g = floor(vec2(vUv.x * 11.0 - 4.0, (1.0 - vUv.y) * 8.0 - 1.5));
    float on = glyph(id, g);
    float pulse = 0.65 + 0.35 * step(0.5, fract(uTime * 1.2));
    c = mix(tint * 0.18, tint * pulse, on);
  }
  gl_FragColor = vec4(c * uPower, 1.0);
}`;

const GLASS_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform float uStars;
uniform float uTime;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 15731.743); }
void main() {
  vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  vec2 cell = floor(vUv * vec2(9.0, 14.0));
  float s = step(0.93, hash(cell)) * uStars;
  s *= 0.6 + 0.4 * sin(uTime * 2.0 + hash(cell + 7.0) * 30.0);
  c += vec3(s);
  gl_FragColor = vec4(c, 1.0);
}`;

const BEAM_VERT = /* glsl */ `
attribute float extra;
uniform vec3 uDir; // the way the light travels
varying float vFade;
void main() {
  vec3 p = position;
  // The floor end of the beam follows the sun.
  if (extra < 0.5) p += uDir * ((p.y - 0.01) / max(0.05, -uDir.y));
  vFade = extra;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying float vFade;
void main() {
  float a = uIntensity * vFade * (0.92 + 0.08 * sin(uTime * 0.7));
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

const POINTS_VERT = /* glsl */ `
attribute vec4 seed;
uniform float uTime;
uniform float uMode; // 0 dust, 1 fireflies, 2 steam
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
varying float vAlpha;
void main() {
  vec3 p;
  float t = uTime;
  if (uMode < 1.5) {
    vec3 drift = uMode < 0.5 ? vec3(0.05, 0.03, 0.04) : vec3(0.22, 0.12, 0.2);
    p = uBoxMin + mod(seed.xyz * uBoxSize + vec3(sin(t * drift.x * 6.0 + seed.w * 20.0), sin(t * drift.y * 5.0 + seed.w * 11.0), cos(t * drift.z * 6.0 + seed.w * 7.0)) * (uMode < 0.5 ? 0.25 : 0.9), uBoxSize);
    float tw = sin(t * (uMode < 0.5 ? 1.3 : 2.4) + seed.w * 40.0);
    vAlpha = uMode < 0.5 ? 0.5 + 0.5 * tw : step(0.35, tw);
  } else {
    float life = fract(t * 0.35 + seed.w);
    p = uBoxMin + vec3((seed.x - 0.5) * 0.12 + sin(life * 6.0 + seed.y * 6.0) * 0.04, life * uBoxSize.y, (seed.z - 0.5) * 0.12);
    vAlpha = (1.0 - life) * smoothstep(0.0, 0.15, life);
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = 1.0;
}`;

const POINTS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * vAlpha * uOpacity, 1.0);
}`;

const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const POST_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormal;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uDepthRange;
uniform float uOutline;
uniform float uHighlight;
uniform float uSat;
uniform float uMatrix;
varying vec2 vUv;

float depthAt(float x, float y) { return texture2D(tDepth, vUv + vec2(x, y) * uTexel).r; }
vec3 normalAt(float x, float y) { return texture2D(tNormal, vUv + vec2(x, y) * uTexel).rgb * 2.0 - 1.0; }

float normalEdge(float x, float y, float depth, vec3 normal) {
  float dd = depthAt(x, y) - depth;
  vec3 n = normalAt(x, y);
  float nd = dot(normal - n, vec3(1.0, 1.0, 1.0));
  float ni = clamp(smoothstep(-0.01, 0.01, nd), 0.0, 1.0);
  float di = clamp(sign(dd * 0.25 + 0.0025), 0.0, 1.0);
  return (1.0 - dot(normal, n)) * di * ni;
}

float bayer(vec2 p) {
  vec2 q = mod(p, 4.0);
  int i = int(q.x) + int(q.y) * 4;
  float m[16];
  m[0] = 0.0; m[1] = 8.0; m[2] = 2.0; m[3] = 10.0;
  m[4] = 12.0; m[5] = 4.0; m[6] = 14.0; m[7] = 6.0;
  m[8] = 3.0; m[9] = 11.0; m[10] = 1.0; m[11] = 9.0;
  m[12] = 15.0; m[13] = 7.0; m[14] = 13.0; m[15] = 5.0;
  for (int k = 0; k < 16; k++) if (k == i) return m[k] / 16.0 - 0.5;
  return 0.0;
}

vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  vec4 texel = texture2D(tColor, vUv);
  float depth = depthAt(0.0, 0.0);
  vec3 normal = normalAt(0.0, 0.0);

  // Depth outline on the near side of a silhouette.
  float dd = 0.0;
  dd += clamp(depthAt(1.0, 0.0) - depth, 0.0, 1.0);
  dd += clamp(depthAt(-1.0, 0.0) - depth, 0.0, 1.0);
  dd += clamp(depthAt(0.0, 1.0) - depth, 0.0, 1.0);
  dd += clamp(depthAt(0.0, -1.0) - depth, 0.0, 1.0);
  float de = floor(smoothstep(0.12, 0.3, dd * uDepthRange) * 2.0) / 2.0;

  // Light rim on convex edges.
  float ne = 0.0;
  ne += normalEdge(0.0, -1.0, depth, normal);
  ne += normalEdge(0.0, 1.0, depth, normal);
  ne += normalEdge(-1.0, 0.0, depth, normal);
  ne += normalEdge(1.0, 0.0, depth, normal);
  ne = step(0.1, ne);

  float k = de > 0.0 ? 1.0 - uOutline * de : 1.0 + uHighlight * ne;
  vec3 c = texel.rgb * k;
  // Soft shoulder instead of a hard clip.
  c = c / (1.0 + max(c - 0.85, 0.0));
  vec3 s = toSRGB(c);

  float l = dot(s, vec3(0.299, 0.587, 0.114));
  s = mix(vec3(l), s, uSat);

  // Matrix: a phosphor-green ramp in a few dithered steps.
  float q = floor(pow(clamp(l, 0.0, 1.0), 1.7) * 6.0 + 0.5 + bayer(gl_FragCoord.xy) * 0.9) / 6.0;
  vec3 green = mix(vec3(0.0, 0.025, 0.008), vec3(0.0, 1.0, 0.255), q);
  green = mix(green, vec3(0.72, 1.0, 0.78), smoothstep(0.84, 1.0, q) * 0.6);
  s = mix(s, green, uMatrix);

  // A light posterise with ordered dither keeps the palette limited.
  s = floor(s * 36.0 + 0.5 + bayer(gl_FragCoord.xy) * 0.8) / 36.0;

  // Additive effects can push alpha past 1 in the float target.
  float alpha = clamp(texel.a, 0.0, 1.0);
  gl_FragColor = vec4(clamp(s, 0.0, 1.0) * alpha, alpha);
}`;

/* ------------------------------------------------------------- the office */

/** Camera angles: about 36° down, 45° around, so the room reads as isometric. */
const ELEVATION = THREE.MathUtils.degToRad(36);
const AZIMUTH = Math.PI / 4;
const STRIP_CSS_HEIGHT = 250;

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 140);
  private camDir = new THREE.Vector3(Math.cos(ELEVATION) * Math.sin(AZIMUTH), Math.sin(ELEVATION), Math.cos(ELEVATION) * Math.cos(AZIMUTH));
  private right = new THREE.Vector3();
  private up = new THREE.Vector3();

  private rtColor: THREE.WebGLRenderTarget;
  private rtNormal: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private post: THREE.ShaderMaterial;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  private stage: HTMLDivElement;
  private overlay: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tagCache = new Map<string, HTMLCanvasElement>();

  private sun = new THREE.DirectionalLight();
  private fill = new THREE.DirectionalLight();
  private hemi = new THREE.HemisphereLight();
  private lamps: THREE.PointLight[] = [];
  private lampGlow = new THREE.MeshBasicMaterial({ vertexColors: true });
  private glassMat: THREE.ShaderMaterial;
  private beamMat: THREE.ShaderMaterial;
  private motes: THREE.ShaderMaterial;
  private fireflies: THREE.ShaderMaterial;
  private steam: THREE.ShaderMaterial[] = [];
  private accentMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private screens: ScreenRef[] = [];
  private swayers: Swayer[] = [];
  private clockHands: { hour: THREE.Object3D; minute: THREE.Object3D } | null = null;
  private disposables: { dispose(): void }[] = [];

  private nav = new NavGrid(0, 0, W, D);
  private spots: Spot[] = [];
  private desks: Spot[] = [];
  private waits: Spot[] = [];
  private agents: Agent[] = [];

  private look: Look;
  private lookFrom: Look;
  private lookTo: Look;
  private lookT = 1;
  private theme: OfficeTheme;
  private mode: OfficeMode;
  private expanded: boolean;
  private onSummary?: (s: OfficeSummary) => void;
  private lastSummary = "";
  private overflow = 0;
  private liveJobs: OfficeJob[] = [];
  private liveSeen = false;

  private demo = { next: 2.5, seq: 1, jobs: [] as { id: number; status: OfficeJobStatus; question: boolean; startAt: number; askAt: number; askFor: number; endAt: number; outcome: OfficeJobStatus }[] };

  // Size and camera framing.
  private cssW = 0;
  private cssH = 0;
  private ps = 3; // CSS pixels per art pixel
  private artW = 0;
  private artH = 0;
  private ppu = 12; // art pixels per world unit
  private officeBox = { r0: 0, r1: 0, u0: 0, u1: 0 };
  private view = { x: 0, y: 0, vx: 0, vy: 0 };
  private hero = { index: 0, until: 0 };

  private raf = 0;
  private running = false;
  private visible = true;
  private last = 0;
  private time = 0;
  private io?: IntersectionObserver;
  private onVisibility = () => this.updateRunning();

  constructor(
    private container: HTMLElement,
    options: OfficeOptions,
  ) {
    this.theme = options.theme;
    this.mode = options.mode;
    this.expanded = options.expanded;
    this.onSummary = options.onSummary;
    this.look = { ...LOOKS[this.theme] };
    this.lookFrom = this.look;
    this.lookTo = LOOKS[this.theme];

    this.stage = document.createElement("div");
    this.stage.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;will-change:transform";
    container.appendChild(this.stage);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "low-power", premultipliedAlpha: true });
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 0);
    const canvas = this.renderer.domElement;
    canvas.style.cssText = "position:absolute;left:0;top:0;image-rendering:pixelated;image-rendering:crisp-edges";
    this.stage.appendChild(canvas);

    this.overlay = document.createElement("canvas");
    this.overlay.style.cssText = "position:absolute;left:0;top:0;image-rendering:pixelated;image-rendering:crisp-edges";
    this.stage.appendChild(this.overlay);
    this.ctx = this.overlay.getContext("2d")!;

    const rtOptions = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false };
    // Half floats keep the lighting smooth before the palette step; plain bytes work too.
    const half = this.renderer.extensions.has("EXT_color_buffer_float") || this.renderer.extensions.has("EXT_color_buffer_half_float");
    this.rtColor = new THREE.WebGLRenderTarget(4, 4, { ...rtOptions, type: half ? THREE.HalfFloatType : THREE.UnsignedByteType });
    this.rtNormal = new THREE.WebGLRenderTarget(4, 4, { ...rtOptions, depthTexture: new THREE.DepthTexture(4, 4) });

    this.post = new THREE.ShaderMaterial({
      vertexShader: POST_VERT,
      fragmentShader: POST_FRAG,
      uniforms: {
        tColor: { value: this.rtColor.texture },
        tNormal: { value: this.rtNormal.texture },
        tDepth: { value: this.rtNormal.depthTexture },
        uTexel: { value: new THREE.Vector2() },
        uDepthRange: { value: 139 },
        uOutline: { value: 0.4 },
        uHighlight: { value: 0.2 },
        uSat: { value: 1 },
        uMatrix: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const tri = new THREE.BufferGeometry();
    tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, this.post);
    quad.frustumCulled = false;
    this.postScene.add(quad);
    this.disposables.push(tri, this.post, this.rtColor, this.rtNormal, this.normalMat, this.lampGlow, this.accentMat);

    this.glassMat = new THREE.ShaderMaterial({
      vertexShader: SCREEN_VERT,
      fragmentShader: GLASS_FRAG,
      uniforms: { uTop: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uStars: { value: 0 }, uTime: { value: 0 } },
    });
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      uniforms: { uColor: { value: new THREE.Color() }, uIntensity: { value: 0 }, uTime: { value: 0 }, uDir: { value: new THREE.Vector3(1, -1, 0) } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const points = (mode: number, color: number) =>
      new THREE.ShaderMaterial({
        vertexShader: POINTS_VERT,
        fragmentShader: POINTS_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uMode: { value: mode },
          uBoxMin: { value: new THREE.Vector3() },
          uBoxSize: { value: new THREE.Vector3(1, 1, 1) },
          uColor: { value: new THREE.Color(color) },
          uOpacity: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    this.motes = points(0, 0xfff1d0);
    this.fireflies = points(1, 0xd9ff7a);
    this.disposables.push(this.glassMat, this.beamMat, this.motes, this.fireflies);

    this.camera.position.copy(this.camDir).multiplyScalar(60);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
    this.right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this.up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.camera.layers.enableAll();

    this.buildLights();
    this.buildWorld();
    this.buildAgents();
    this.measureOffice();
    this.applyLook(this.look);

    this.view.x = (this.officeBox.r0 + this.officeBox.r1) / 2;
    this.view.y = (this.officeBox.u0 + this.officeBox.u1) / 2;

    this.io = new IntersectionObserver((entries) => {
      this.visible = entries.some((e) => e.isIntersecting);
      this.updateRunning();
    });
    this.io.observe(container);
    document.addEventListener("visibilitychange", this.onVisibility);
    this.updateRunning();
  }

  /* ------------------------------------------------------------- public */

  /** The CSS size of the area the office may fill: the full width, and the side of the square. */
  setLayout(width: number, height: number): void {
    if (width === this.cssW && height === this.cssH) return;
    this.cssW = width;
    this.cssH = height;
    const dpr = window.devicePixelRatio || 1;
    const base = width >= 560 ? 2.5 : 2;
    // Whole device pixels per art pixel keep the pixels even.
    this.ps = Math.max(1, Math.round(base * dpr)) / dpr;
    this.artW = Math.ceil(width / this.ps) + 2;
    this.artH = Math.ceil(Math.max(height, STRIP_CSS_HEIGHT) / this.ps) + 2;
    this.renderer.setSize(this.artW, this.artH, false);
    this.rtColor.setSize(this.artW, this.artH);
    this.rtNormal.setSize(this.artW, this.artH);
    this.overlay.width = this.artW;
    this.overlay.height = this.artH;
    this.ctx.imageSmoothingEnabled = false;
    const cw = `${this.artW * this.ps}px`;
    const ch = `${this.artH * this.ps}px`;
    for (const el of [this.stage, this.renderer.domElement, this.overlay]) {
      el.style.width = cw;
      el.style.height = ch;
    }
    (this.post.uniforms.uTexel.value as THREE.Vector2).set(1 / this.artW, 1 / this.artH);
    // Fit the whole office into the square, with a little room around it.
    const side = Math.min(this.artW, this.artH) - 2;
    const ow = this.officeBox.r1 - this.officeBox.r0;
    const oh = this.officeBox.u1 - this.officeBox.u0;
    this.ppu = clamp(Math.min(side / (ow * 1.03), side / (oh * 1.05)), 5, 20);
    this.camera.left = -this.artW / 2 / this.ppu;
    this.camera.right = this.artW / 2 / this.ppu;
    this.camera.top = this.artH / 2 / this.ppu;
    this.camera.bottom = -this.artH / 2 / this.ppu;
    this.camera.updateProjectionMatrix();
    this.tagCache.clear();
    if (!this.running) this.renderOnce();
  }

  setTheme(theme: OfficeTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.lookFrom = { ...this.look };
    this.lookTo = LOOKS[theme];
    this.lookT = 0;
    this.tagCache.clear();
    const accent = new THREE.Color(TAGS[theme].accent);
    for (const s of this.screens) (s.mat.uniforms.uAccent.value as THREE.Color).copy(accent);
    this.accentMat.color.copy(decorAccent(theme));
    if (!this.running) this.renderOnce();
  }

  setMode(mode: OfficeMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.demo.jobs = [];
    this.demo.next = this.time + 2;
    // Work from the other mode just ends, quietly.
    for (const a of this.agents) {
      if (a.job) {
        a.job = null;
        this.goIdle(a);
      }
    }
    if (mode === "live") this.applyJobs(this.liveJobs, false);
  }

  setExpanded(expanded: boolean): void {
    this.expanded = expanded;
  }

  /** Live job data from the dashboard. */
  setJobs(jobs: OfficeJob[]): void {
    this.liveJobs = jobs;
    if (this.mode !== "live") return;
    this.applyJobs(jobs, !this.liveSeen);
    this.liveSeen = true;
  }

  /** Demo mode: send work to the office now. */
  workArrives(): void {
    if (this.mode !== "demo") return;
    this.spawnDemoJobs(1 + (Math.random() < 0.3 ? 1 : 0));
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose();
    for (const s of this.screens) s.mat.dispose();
    for (const s of this.steam) s.dispose();
    this.renderer.dispose();
    this.stage.remove();
  }

  /* ------------------------------------------------------------- loop */

  private updateRunning(): void {
    const should = this.visible && document.visibilityState !== "hidden";
    if (should && !this.running) {
      this.running = true;
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    } else if (!should && this.running) {
      this.running = false;
      cancelAnimationFrame(this.raf);
    }
  }

  private frame = (now: number) => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.frame);
    // 60 fps is plenty; high refresh screens skip every other frame.
    if (now - this.last < 1000 / 64) return;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.step(dt);
    this.render();
  };

  private renderOnce(): void {
    if (!this.artW) return;
    this.step(0);
    this.render();
  }

  private step(dt: number): void {
    this.time += dt;
    const t = this.time;
    if (this.lookT < 1) {
      this.lookT = Math.min(1, this.lookT + dt / 1.2);
      this.applyLook(blendLook(this.lookFrom, this.lookTo, ease(this.lookT)));
    }
    if (this.mode === "demo") this.tickDemo();
    for (const a of this.agents) this.think(a);
    for (const a of this.agents) this.move(a, dt);
    for (const a of this.agents) this.animate(a, dt);
    for (const s of this.swayers) {
      s.obj.rotation.z = Math.sin(t * s.speed + s.phase) * s.amount;
      s.obj.rotation.x = Math.cos(t * s.speed * 0.8 + s.phase * 1.7) * s.amount * 0.7;
    }
    for (const s of this.screens) {
      if (s.state >= 3 && t > s.until) s.state = 0;
      s.mat.uniforms.uTime.value = t;
      s.mat.uniforms.uState.value = s.state;
    }
    this.glassMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uTime.value = t;
    this.motes.uniforms.uTime.value = t;
    this.fireflies.uniforms.uTime.value = t;
    for (const s of this.steam) s.uniforms.uTime.value = t;
    if (this.clockHands) {
      const d = new Date();
      const min = d.getMinutes() + d.getSeconds() / 60;
      const hr = (d.getHours() % 12) + min / 60;
      this.clockHands.minute.rotation.z = -(min / 60) * Math.PI * 2;
      this.clockHands.hour.rotation.z = -(hr / 12) * Math.PI * 2;
    }
    this.updateView(dt);
    this.summarise();
  }

  /* ------------------------------------------------------------- camera */

  private measureOffice(): void {
    const r: number[] = [];
    const u: number[] = [];
    const p = new THREE.Vector3();
    for (const x of [-WT, W + WT])
      for (const z of [-WT, D + WT])
        for (const y of [-0.3, WALL_H]) {
          p.set(x, y, z);
          r.push(p.dot(this.right));
          u.push(p.dot(this.up));
        }
    this.officeBox = { r0: Math.min(...r), r1: Math.max(...r), u0: Math.min(...u), u1: Math.max(...u) };
  }

  private updateView(dt: number): void {
    const box = this.officeBox;
    let tx = (box.r0 + box.r1) / 2;
    let ty = (box.u0 + box.u1) / 2;
    if (!this.expanded) {
      // The strip follows the action: working agents, or one agent at a time.
      const busy = this.agents.filter((a) => a.job);
      if (this.time > this.hero.until) {
        this.hero.index = Math.floor(Math.random() * this.agents.length);
        this.hero.until = this.time + rand(14, 24);
      }
      const follow = busy.length ? busy : [this.agents[this.hero.index]];
      const p = new THREE.Vector3();
      let fy = 0;
      let fx = 0;
      for (const a of follow) {
        p.set(a.pos.x, 0.7, a.pos.z);
        fx += p.dot(this.right);
        fy += p.dot(this.up);
      }
      fx /= follow.length;
      fy /= follow.length;
      const halfW = this.cssW / this.ps / 2 / this.ppu;
      const halfH = STRIP_CSS_HEIGHT / this.ps / 2 / this.ppu;
      const ow = (box.r1 - box.r0) / 2;
      tx = halfW >= ow ? tx : clamp(lerp(tx, fx, 0.6), box.r0 + halfW, box.r1 - halfW);
      ty = clamp(lerp(ty, fy, 0.75), box.u0 + halfH - 0.4, box.u1 - halfH);
    }
    if (dt === 0) {
      this.view.x = tx;
      this.view.y = ty;
    } else {
      // A critically damped spring: calm, no overshoot.
      const w = this.expanded ? 4 : 0.9;
      for (const [k, v, target] of [
        ["x", "vx", tx],
        ["y", "vy", ty],
      ] as const) {
        const x = this.view[k];
        const vel = this.view[v];
        const acc = w * w * (target - x) - 2 * w * vel;
        this.view[v] = vel + acc * dt;
        this.view[k] = x + this.view[v] * dt;
      }
    }
  }

  /* -------------------------------------------------------------- lights */

  private buildLights(): void {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 90;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 2.5;
    this.sun.target.position.set(W / 2, 0, D / 2);
    this.fill.target.position.set(W / 2, 0, D / 2);
    this.fill.position.set(W / 2 + 6, 12, D / 2 + 10);
    this.scene.add(this.sun, this.sun.target, this.fill, this.fill.target, this.hemi);
  }

  private applyLook(look: Look): void {
    this.look = look;
    this.sun.color.set(look.sun);
    this.sun.intensity = look.sunI;
    const el = THREE.MathUtils.degToRad(look.sunEl);
    const az = THREE.MathUtils.degToRad(look.sunAz);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.sun.position.copy(this.sun.target.position).addScaledVector(dir, 40);
    (this.beamMat.uniforms.uDir.value as THREE.Vector3).copy(dir).negate();
    this.fill.color.set(look.fill);
    this.fill.intensity = look.fillI;
    this.hemi.color.set(look.sky);
    this.hemi.groundColor.set(look.ground);
    this.hemi.intensity = look.hemiI;
    (this.glassMat.uniforms.uTop.value as THREE.Color).set(look.glassTop);
    (this.glassMat.uniforms.uBottom.value as THREE.Color).set(look.glassBottom);
    this.glassMat.uniforms.uStars.value = look.stars;
    for (const l of this.lamps) {
      l.color.set(look.lamp);
      l.intensity = look.lampI * (l.userData.power as number);
    }
    // Lamp shades glow at night and look like plain shades by day.
    this.lampGlow.color.setRGB(1, 1, 1).lerp(new THREE.Color(look.lamp).multiplyScalar(2.2), clamp(look.lampI, 0, 1));
    (this.beamMat.uniforms.uColor.value as THREE.Color).set(look.beam);
    this.beamMat.uniforms.uIntensity.value = look.beamI;
    this.motes.uniforms.uOpacity.value = look.motes;
    (this.motes.uniforms.uColor.value as THREE.Color).set(look.beam);
    this.fireflies.uniforms.uOpacity.value = look.fireflies;
    for (const s of this.screens) s.mat.uniforms.uPower.value = look.screenI;
    this.post.uniforms.uOutline.value = look.outline;
    this.post.uniforms.uHighlight.value = look.highlight;
    this.post.uniforms.uSat.value = look.sat;
    this.post.uniforms.uMatrix.value = look.matrix;
    this.accentMat.color.copy(decorAccent(this.theme));
    this.renderer.shadowMap.needsUpdate = true;
  }

  /* --------------------------------------------------------------- world */

  private addMesh(b: Builder, mat: THREE.Material, opts: { cast?: boolean; receive?: boolean; layer?: number } = {}): THREE.Mesh {
    const mesh = new THREE.Mesh(b.geometry(), mat);
    mesh.castShadow = opts.cast ?? true;
    mesh.receiveShadow = opts.receive ?? true;
    if (opts.layer !== undefined) mesh.layers.set(opts.layer);
    this.scene.add(mesh);
    return mesh;
  }

  private block(x0: number, z0: number, x1: number, z1: number, pad = 0.2): void {
    this.nav.block({ x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1) }, pad);
  }

  private spot(s: Omit<Spot, "by">): Spot {
    const spot: Spot = { ...s, by: null };
    this.spots.push(spot);
    return spot;
  }

  private buildWorld(): void {
    const R = seeded(7);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(mat);
    const s = new Builder(); // static, solid
    const accent = new Builder(); // follows the theme accent
    const glow = new Builder(); // lamp shades
    const glass = new THREE.Group();

    /* -- ground: the diorama base, grass and a stone path -- */
    {
      const { x0, z0, x1, z1 } = BASE;
      s.box(x0, -1.25, z0, x1, -0.85, z1, P.soilC);
      s.box(x0, -0.85, z0, x1, -0.45, z1, P.soilB);
      s.box(x0, -0.45, z0, x1, -0.1, z1, P.soilA, { top: P.grassB });
      const grass = [P.grassA, P.grassB, P.grassC, P.grassD];
      for (let x = x0; x < x1; x += 1)
        for (let z = z0; z < z1; z += 1) {
          const inside = x >= -WT - 0.5 && x < W + WT && z >= -WT - 0.5 && z < D + WT;
          if (inside) continue;
          s.box(x, -0.2, z, x + 1, -0.095, z + 1, grass[Math.floor(R() * grass.length)], { topOnly: true });
        }
      // Stepping stones from the entrance.
      for (let i = 0; i < 6; i++) {
        const z = D + 0.9 + i * 1.15;
        const x = (ENTRANCE[0] + ENTRANCE[1]) / 2 + Math.sin(i * 1.3) * 0.35;
        s.box(x - 0.42, -0.12, z - 0.36, x + 0.42, -0.06, z + 0.36, i % 2 ? P.stone : P.stoneB);
      }
    }

    /* -- office floor -- */
    s.box(-WT, -0.26, -WT, W + WT, -0.0, D + WT, P.plinth, { top: P.plinthTop });
    {
      const planks = [P.plankA, P.plankB, P.plankC];
      let k = 0;
      for (let z = 0, row = 0; z < D - 1e-6; z += 0.5, row++) {
        let x = -(row % 3) * 0.7;
        while (x < W - 1e-6) {
          const len = 1.6 + Math.floor(R() * 4) * 0.5;
          const a = Math.max(0, x);
          const b = Math.min(W, x + len);
          if (b > a) s.box(a, 0, z, b, 0.004, z + 0.5, planks[k++ % 3], { topOnly: true });
          x += len;
        }
      }
    }

    /* -- walls: two tall back walls with windows, two low cut walls in front -- */
    {
      const wallStyle = { top: P.wallCut };
      // Left wall (x = 0 inside face), with three windows.
      s.box(-WT, 0, 0, 0, SILL, D, P.wallLow, { top: P.trim, ao: 0.15 });
      s.box(-WT, WIN_TOP, 0, 0, WALL_H, D, P.wall, wallStyle);
      let z = 0;
      for (const [a, b] of WINDOWS) {
        s.box(-WT, SILL, z, 0, WIN_TOP, a, P.wall);
        z = b;
      }
      s.box(-WT, SILL, z, 0, WIN_TOP, D, P.wall);
      // Right wall (z = 0 inside face), two-tone with a trim line.
      s.box(-WT, 0, -WT, W, SILL, 0, P.wallLow, { ao: 0.15 });
      s.box(-WT, SILL, -WT, W, WALL_H, 0, P.wall, wallStyle);
      s.box(0, SILL - 0.03, 0, W, SILL + 0.03, 0.03, P.trim);
      // Baseboards.
      s.box(0, 0, 0, W, 0.1, 0.04, P.baseboard);
      s.box(0, 0, 0, 0.04, 0.1, D, P.baseboard);
      // Front walls, cut low like a diorama, with a gap for the door.
      const low = 0.38;
      s.box(W, 0, 0, W + WT, low, D + WT, P.wallLow, wallStyle);
      s.box(-WT, 0, D, ENTRANCE[0], low, D + WT, P.wallLow, wallStyle);
      s.box(ENTRANCE[1], 0, D, W, low, D + WT, P.wallLow, wallStyle);
      // Windows: frames, sills, and glass that shows the sky.
      for (const [a, b] of WINDOWS) {
        s.box(-0.06, SILL - 0.05, a - 0.04, 0.12, SILL + 0.02, b + 0.04, P.trim);
        s.box(-0.04, WIN_TOP - 0.06, a - 0.04, 0.04, WIN_TOP + 0.02, b + 0.04, P.trim);
        s.box(-0.04, SILL, a - 0.04, 0.04, WIN_TOP, a + 0.04, P.trim);
        s.box(-0.04, SILL, b - 0.04, 0.04, WIN_TOP, b + 0.04, P.trim);
        s.box(-0.03, SILL, (a + b) / 2 - 0.03, 0.03, WIN_TOP, (a + b) / 2 + 0.03, P.trim);
        s.box(-0.03, 1.72, a, 0.03, 1.77, b, P.trim);
        const pane = new THREE.Mesh(new THREE.PlaneGeometry(b - a, WIN_TOP - SILL), this.glassMat);
        pane.position.set(-0.16, (SILL + WIN_TOP) / 2, (a + b) / 2);
        pane.rotation.y = Math.PI / 2;
        glass.add(pane);
      }
      this.nav.block({ x0: -1, z0: -1, x1: W + 1, z1: 0 }, 0.25);
      this.nav.block({ x0: -1, z0: -1, x1: 0, z1: D + 1 }, 0.25);
      this.nav.block({ x0: W, z0: -1, x1: W + 1, z1: D + 1 }, 0.25);
      this.nav.block({ x0: -1, z0: D, x1: W + 1, z1: D + 1 }, 0.25);
    }
    this.scene.add(glass);

    /* -- light beams through the windows (drawn only in the colour pass) -- */
    this.buildBeams();

    /* -- the desks -- */
    const deskSpots: Spot[] = [];
    const workstation = (x: number, z: number, rot: number, index: number, lamp: boolean) => {
      s.push(x, 0, z, rot);
      // Desk: top, side panels and a modesty panel. The sitter is at local +z.
      s.box(-0.76, 0.69, -0.38, 0.76, 0.75, 0.38, P.deskTop, { top: P.deskTop });
      s.box(-0.73, 0, -0.34, -0.67, 0.69, 0.34, P.deskSide);
      s.box(0.67, 0, -0.34, 0.73, 0.69, 0.34, P.deskSide);
      s.box(-0.67, 0.36, -0.36, 0.67, 0.66, -0.33, P.deskSide);
      // Monitor, keyboard, mouse.
      s.box(-0.13, 0.75, -0.3, 0.13, 0.77, -0.14, P.monitor);
      s.box(-0.03, 0.77, -0.27, 0.03, 0.92, -0.22, P.monitor);
      s.box(-0.34, 0.84, -0.27, 0.34, 1.27, -0.2, P.monitor);
      s.box(-0.25, 0.75, 0.0, 0.21, 0.775, 0.17, P.keyboard);
      s.box(0.29, 0.75, 0.06, 0.36, 0.77, 0.15, 0xdcdfe5);
      // Desk things.
      const things = index % 4;
      if (things === 0) {
        s.box(-0.62, 0.75, -0.2, -0.5, 0.86, -0.08, P.white);
        s.box(-0.6, 0.86, -0.18, -0.52, 0.87, -0.1, 0x6b4a33);
      } else if (things === 1) {
        s.box(0.42, 0.75, -0.28, 0.66, 0.79, -0.04, P.paper);
        s.box(0.44, 0.79, -0.26, 0.64, 0.82, -0.06, P.books[1]);
      } else if (things === 2) {
        s.box(-0.64, 0.75, -0.26, -0.5, 0.86, -0.12, P.potClay);
        s.box(-0.62, 0.86, -0.24, -0.52, 0.96, -0.14, P.leafA);
      } else {
        s.box(0.45, 0.75, -0.24, 0.57, 0.86, -0.12, 0x3a7bd5);
        s.box(-0.63, 0.75, -0.08, -0.43, 0.76, 0.12, P.yellow);
      }
      if (lamp) {
        // A desk lamp that glows at night.
        const lx = index % 2 ? 0.58 : -0.58;
        s.box(lx - 0.07, 0.75, -0.26, lx + 0.07, 0.77, -0.12, P.metal);
        s.box(lx - 0.02, 0.77, -0.21, lx + 0.02, 1.05, -0.17, P.metal);
        glow.push(x, 0, z, rot);
        glow.box(lx - 0.09, 1.0, -0.24, lx + 0.09, 1.1, -0.06, 0xfff2d6);
        glow.pop();
        const p = s.world(lx, -0.1, 0.95);
        this.addLamp(p.x, p.y, p.z, 1.2, 3.2);
      }
      // Chair, facing the desk.
      s.push(0, 0, 0.8, 0);
      s.box(-0.28, 0.03, -0.04, 0.28, 0.07, 0.04, P.black);
      s.box(-0.04, 0.03, -0.28, 0.04, 0.07, 0.28, P.black);
      s.box(-0.035, 0.07, -0.035, 0.035, 0.38, 0.035, P.metalLight);
      s.box(-0.25, 0.38, -0.25, 0.25, 0.46, 0.25, P.chairSeat);
      s.box(-0.03, 0.4, 0.2, 0.03, 0.56, 0.25, P.metal);
      s.box(-0.23, 0.54, 0.19, 0.23, 1.0, 0.26, P.chair);
      s.pop();
      const seat = s.world(0, 0.8);
      const approach = s.world(0, 1.45);
      const face = wrapAngle(rot + Math.PI);
      const screenMatrix = s.matrix.multiply(new THREE.Matrix4().makeTranslation(0, 1.055, -0.195));
      s.pop();
      // The desk block and the chair are obstacles; the agent reaches the chair from behind.
      this.block(seat.x - 0.26, seat.z - 0.26, seat.x + 0.26, seat.z + 0.26, 0.16);
      const mat2 = new THREE.ShaderMaterial({
        vertexShader: SCREEN_VERT,
        fragmentShader: SCREEN_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uState: { value: 0 },
          uSeed: { value: index * 1.37 + 0.2 },
          uPower: { value: 1 },
          uAccent: { value: new THREE.Color(TAGS[this.theme].accent) },
        },
      });
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.36), mat2);
      screen.applyMatrix4(screenMatrix);
      screen.castShadow = false;
      this.scene.add(screen);
      this.screens.push({ mesh: screen, mat: mat2, state: 0, until: 0 });
      const spot = this.spot({
        id: `desk${index}`,
        activity: "type",
        approach: v2(approach.x, approach.z),
        face,
        seat: { x: seat.x, z: seat.z, y: 0.46 },
        desk: index,
        weight: 0,
        stay: [0, 0],
      });
      deskSpots[index] = spot;
    };
    // Two rows of two, back to back. The back row faces the camera; the front row shows its screens.
    const dx = [6.82, 8.38];
    const zBack = 5.225;
    const zFront = 5.975;
    workstation(dx[0], zBack, Math.PI, 0, true);
    workstation(dx[1], zBack, Math.PI, 1, false);
    workstation(dx[0], zFront, 0, 2, false);
    workstation(dx[1], zFront, 0, 3, true);
    this.block(6.05, 4.84, 9.15, 6.36, 0.18);
    this.desks = deskSpots;
    // A low divider between the rows, in the theme accent.
    accent.box(6.08, 0.75, 5.575, 9.12, 1.12, 5.625, 0xffffff);
    accent.box(6.06, 1.12, 5.565, 9.14, 1.15, 5.635, 0xd0d0d0);

    /* -- lounge: rug, sofa, coffee table, armchair, floor lamp -- */
    accent.box(1.0, 0, 6.7, 4.7, 0.012, 10.2, 0xffffff);
    s.box(1.2, 0, 6.9, 4.5, 0.016, 10.0, 0xf1ece4);
    accent.box(1.35, 0, 7.05, 4.35, 0.02, 9.85, 0xdadada);
    {
      // Sofa against the left wall, facing +x.
      s.push(0.72, 0, 8.4, Math.PI / 2);
      s.box(-1.35, 0.06, -0.44, 1.35, 0.34, 0.44, P.sofa, { ao: 0.12 });
      s.box(-1.25, 0.34, -0.26, -0.02, 0.43, 0.4, P.sofaCushion);
      s.box(0.02, 0.34, -0.26, 1.25, 0.43, 0.4, P.sofaCushion);
      s.box(-1.35, 0.34, -0.44, 1.35, 0.88, -0.24, P.sofa);
      s.box(-1.35, 0.34, -0.44, -1.13, 0.62, 0.44, P.sofa);
      s.box(1.13, 0.34, -0.44, 1.35, 0.62, 0.44, P.sofa);
      s.box(-1.3, 0, -0.4, -1.2, 0.06, -0.3, P.woodDark);
      s.box(1.2, 0, -0.4, 1.3, 0.06, -0.3, P.woodDark);
      s.box(-1.3, 0, 0.3, -1.2, 0.06, 0.4, P.woodDark);
      s.box(1.2, 0, 0.3, 1.3, 0.06, 0.4, P.woodDark);
      // Throw pillows.
      s.box(-1.08, 0.42, -0.24, -0.7, 0.72, -0.12, P.yellow);
      accent.push(0.72, 0, 8.4, Math.PI / 2);
      accent.box(0.72, 0.42, -0.24, 1.08, 0.7, -0.12, 0xffffff);
      accent.pop();
      const seats = [-0.62, 0.62].map((lx) => ({ seat: s.world(lx, 0.06), approach: s.world(lx, 0.95) }));
      s.pop();
      this.block(0.28, 7.05, 1.16, 9.75, 0.15);
      seats.forEach((p, i) =>
        this.spot({ id: `sofa${i}`, activity: "lounge", approach: v2(p.approach.x, p.approach.z), face: Math.PI / 2, seat: { x: p.seat.x, z: p.seat.z, y: 0.43 }, weight: 1.4, stay: [12, 24] }),
      );
    }
    {
      // Coffee table.
      s.box(2.05, 0.3, 7.75, 2.95, 0.36, 9.05, P.woodLight);
      s.box(2.1, 0, 7.8, 2.18, 0.3, 7.88, P.woodDark);
      s.box(2.82, 0, 7.8, 2.9, 0.3, 7.88, P.woodDark);
      s.box(2.1, 0, 8.92, 2.18, 0.3, 9.0, P.woodDark);
      s.box(2.82, 0, 8.92, 2.9, 0.3, 9.0, P.woodDark);
      s.box(2.3, 0.36, 8.0, 2.62, 0.4, 8.42, P.books[4]);
      s.box(2.32, 0.4, 8.04, 2.58, 0.43, 8.36, P.books[2]);
      s.box(2.55, 0.36, 8.65, 2.67, 0.46, 8.77, P.white);
      this.block(2.05, 7.75, 2.95, 9.05, 0.15);
      this.steam.push(this.addSteam(2.61, 0.47, 8.71, 0.5));
    }
    {
      // Armchair across the table, facing -x.
      s.push(4.25, 0, 8.4, -Math.PI / 2);
      s.box(-0.55, 0.06, -0.44, 0.55, 0.34, 0.44, P.sofa, { ao: 0.12 });
      s.box(-0.36, 0.34, -0.26, 0.36, 0.43, 0.4, P.sofaCushion);
      s.box(-0.55, 0.34, -0.44, 0.55, 0.86, -0.24, P.sofa);
      s.box(-0.55, 0.34, -0.44, -0.36, 0.6, 0.44, P.sofa);
      s.box(0.36, 0.34, -0.44, 0.55, 0.6, 0.44, P.sofa);
      const seat = s.world(0, 0.08);
      const approach = s.world(0, 0.95);
      s.pop();
      this.block(3.8, 7.85, 4.7, 8.95, 0.15);
      this.spot({ id: "armchair", activity: "lounge", approach: v2(approach.x, approach.z), face: -Math.PI / 2, seat: { x: seat.x, z: seat.z, y: 0.43 }, weight: 1, stay: [12, 22] });
    }
    {
      // Floor lamp in the corner.
      s.box(0.38, 0, 10.18, 0.72, 0.05, 10.52, P.metal);
      s.box(0.52, 0.05, 10.32, 0.58, 1.75, 10.38, P.metal);
      glow.box(0.33, 1.65, 10.13, 0.77, 2.0, 10.57, 0xfff2d6);
      this.block(0.38, 10.18, 0.72, 10.52, 0.15);
      this.addLamp(0.55, 1.62, 10.35, 2.2, 6);
    }

    /* -- plants -- */
    const plant = (x: number, z: number, size: number, pot: number, sway = 0.035) => {
      const h = 0.32 * size;
      s.box(x - 0.2 * size, 0, z - 0.2 * size, x + 0.2 * size, h, z + 0.2 * size, pot, { top: P.soilB });
      s.box(x - 0.22 * size, h - 0.05, z - 0.22 * size, x + 0.22 * size, h, z + 0.22 * size, pot);
      const leaves = new Builder();
      const top = h;
      const cols = [P.leafA, P.leafB, P.leafC];
      const k = Math.max(3, Math.round(4 * size));
      leaves.box(-0.04, 0, -0.04, 0.04, 0.5 * size, 0.04, P.leafB);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2 + R() * 0.6;
        const r = (0.12 + R() * 0.16) * size;
        const y = (0.2 + R() * 0.75) * size * 0.75;
        const w = (0.14 + R() * 0.1) * size;
        leaves.box(Math.cos(a) * r - w, y, Math.sin(a) * r - w, Math.cos(a) * r + w, y + w * 1.2, Math.sin(a) * r + w, cols[i % 3]);
      }
      leaves.box(-0.13 * size, 0.62 * size, -0.13 * size, 0.13 * size, 0.86 * size, 0.13 * size, P.leafC);
      const mesh = this.addMesh(leaves, mat);
      mesh.position.set(x, top, z);
      this.swayers.push({ obj: mesh, amount: sway, speed: 0.9 + R() * 0.5, phase: R() * 6 });
      this.block(x - 0.22 * size, z - 0.22 * size, x + 0.22 * size, z + 0.22 * size, 0.15);
    };
    plant(0.5, 0.5, 1.7, P.potWhite);
    plant(0.55, 6.25, 1.2, P.potClay);
    plant(5.45, 4.35, 1.5, P.potDark);
    plant(13.35, 4.3, 1.3, P.potClay);
    plant(13.3, 10.35, 1.9, P.potWhite);
    plant(9.6, 10.45, 1.1, P.potClay);
    plant(4.95, 10.45, 1.0, P.potDark);
    this.spot({ id: "plant", activity: "plants", approach: v2(5.45, 3.6), face: 0, weight: 0.6, stay: [5, 9] });
    this.spot({ id: "plant2", activity: "plants", approach: v2(12.3, 9.55), face: Math.atan2(1.0, 0.8), weight: 0.5, stay: [5, 9] });

    /* -- bookshelf -- */
    {
      s.box(1.0, 0, 0.02, 2.8, 2.15, 0.46, P.wood, { ao: 0.1 });
      for (let i = 0; i < 4; i++) {
        const y0 = 0.12 + i * 0.5;
        s.box(1.06, y0, 0.36, 2.74, y0 + 0.42, 0.47, P.woodDark);
        let x = 1.1;
        while (x < 2.62) {
          const w = 0.07 + R() * 0.07;
          const h = 0.24 + R() * 0.13;
          if (R() < 0.12) {
            x += w;
            continue;
          }
          s.box(x, y0, 0.12, Math.min(2.7, x + w), y0 + h, 0.46, P.books[Math.floor(R() * P.books.length)]);
          x += w + 0.008;
        }
      }
      s.box(2.1, 2.15, 0.12, 2.36, 2.4, 0.38, P.potClay);
      s.box(2.06, 2.36, 0.08, 2.4, 2.56, 0.42, P.leafA);
      s.box(1.2, 2.15, 0.15, 1.45, 2.25, 0.4, P.books[3]);
      this.block(1.0, 0, 2.8, 0.46, 0.15);
      this.spot({ id: "books", activity: "read", approach: v2(1.9, 1.05), face: Math.PI, weight: 1, stay: [8, 14] });
    }

    /* -- whiteboard, sign and clock -- */
    {
      s.box(3.5, 1.0, 0, 6.1, 2.25, 0.05, P.metalLight);
      s.box(3.56, 1.06, 0.05, 6.04, 2.19, 0.06, P.white);
      s.box(3.6, 1.0, 0.0, 6.0, 1.04, 0.12, P.metalLight);
      const ink = [0x3a7bd5, 0xe5675a, 0x36a46b];
      for (let i = 0; i < 6; i++) {
        const y = 1.9 - i * 0.12;
        const x0 = 3.75 + (i % 3 === 1 ? 0.2 : 0);
        s.box(x0, y, 0.06, x0 + 0.5 + R() * 0.9, y + 0.03, 0.065, ink[i % 3]);
      }
      s.box(5.3, 1.35, 0.06, 5.95, 1.9, 0.065, 0x3a7bd5);
      s.box(5.34, 1.39, 0.065, 5.91, 1.86, 0.07, P.white);
      s.box(5.5, 1.55, 0.07, 5.75, 1.7, 0.075, 0xe5675a);
      for (const [x, y, c] of [
        [3.7, 1.15, P.yellow],
        [3.95, 1.18, P.pink],
        [4.2, 1.13, P.yellow],
      ] as const)
        s.box(x, y, 0.06, x + 0.16, y + 0.16, 0.07, c);
      this.spot({ id: "board", activity: "think", approach: v2(4.6, 1.0), face: Math.PI, weight: 0.9, stay: [6, 11] });
      this.spot({ id: "wait0", activity: "wait", approach: v2(3.9, 1.35), face: Math.PI - 0.3, weight: 0, stay: [0, 0] });
      this.spot({ id: "wait1", activity: "wait", approach: v2(5.3, 1.35), face: Math.PI + 0.3, weight: 0, stay: [0, 0] });
      this.spot({ id: "wait2", activity: "wait", approach: v2(4.6, 1.9), face: Math.PI, weight: 0, stay: [0, 0] });
      this.spot({ id: "wait3", activity: "wait", approach: v2(3.4, 2.0), face: Math.PI - 0.6, weight: 0, stay: [0, 0] });
      this.waits = this.spots.filter((p) => p.activity === "wait");

      // The Rainmaker sign: a cloud with rain, on an accent panel.
      accent.box(6.45, 2.0, 0, 7.95, 2.7, 0.05, 0xffffff);
      s.box(6.75, 2.32, 0.05, 7.62, 2.5, 0.08, P.white);
      s.box(6.9, 2.45, 0.05, 7.35, 2.6, 0.08, P.white);
      for (let i = 0; i < 3; i++) s.box(6.9 + i * 0.25, 2.1, 0.05, 6.95 + i * 0.25, 2.24, 0.08, P.white);

      // A wall clock with real hands.
      s.box(8.12, 2.18, 0, 8.58, 2.64, 0.05, P.metal);
      s.box(8.16, 2.22, 0.05, 8.54, 2.6, 0.06, P.white);
      const pivot = new THREE.Vector3(8.35, 2.41, 0.07);
      const hand = (len: number, w: number, color: number) => {
        const g = new THREE.Group();
        g.position.copy(pivot);
        const b = new Builder();
        b.box(-w / 2, -0.02, 0, w / 2, len, 0.01, color);
        const m = new THREE.Mesh(b.geometry(), mat);
        g.add(m);
        this.scene.add(g);
        return g;
      };
      this.clockHands = { hour: hand(0.1, 0.035, P.black), minute: hand(0.16, 0.025, P.black) };
    }

    /* -- printer -- */
    {
      s.box(6.65, 0, 0.04, 7.45, 0.62, 0.6, P.potDark, { ao: 0.1 });
      s.box(6.7, 0.62, 0.08, 7.4, 0.9, 0.56, P.fridge);
      s.box(6.76, 0.9, 0.12, 7.34, 0.93, 0.5, P.metalLight);
      s.box(6.8, 0.74, 0.56, 7.3, 0.77, 0.7, P.paper);
      this.block(6.65, 0, 7.45, 0.7, 0.15);
      this.spot({ id: "printer", activity: "print", approach: v2(7.05, 1.3), face: Math.PI, weight: 0.5, stay: [4, 7] });
    }

    /* -- water cooler -- */
    {
      s.box(8.72, 0, 0.1, 9.18, 0.95, 0.56, P.white, { ao: 0.1 });
      s.box(8.8, 0.62, 0.56, 9.1, 0.66, 0.6, P.metalLight);
      s.box(8.82, 0.95, 0.16, 9.08, 1.35, 0.5, 0x8ec9f5, { top: 0xb5dcf7 });
      s.box(9.2, 0.3, 0.2, 9.32, 0.62, 0.34, P.white);
      this.block(8.72, 0, 9.32, 0.6, 0.15);
      this.spot({ id: "water", activity: "water", approach: v2(8.95, 1.15), face: Math.PI, weight: 0.9, stay: [5, 9] });
    }

    /* -- kitchen: counter, sink, coffee machine, cabinets, fridge -- */
    {
      s.box(9.55, 0, 0, 12.95, 0.86, 0.7, P.cabinet, { ao: 0.12 });
      s.box(9.5, 0.86, 0, 13.0, 0.94, 0.76, P.counter);
      for (let x = 9.55; x < 12.9; x += 0.85) s.box(x + 0.04, 0.12, 0.7, x + 0.81, 0.8, 0.72, P.cabinetDark);
      for (let x = 9.55; x < 12.9; x += 0.85) s.box(x + 0.36, 0.7, 0.72, x + 0.5, 0.73, 0.75, P.metalLight);
      // Sink and tap.
      s.box(10.0, 0.9, 0.18, 10.65, 0.945, 0.6, P.steel);
      s.box(10.28, 0.94, 0.1, 10.36, 1.18, 0.18, P.steel);
      s.box(10.28, 1.12, 0.1, 10.36, 1.18, 0.34, P.steel);
      // Coffee machine with a little red light.
      s.box(11.15, 0.94, 0.08, 11.6, 1.42, 0.5, P.black);
      s.box(11.2, 1.0, 0.5, 11.55, 1.08, 0.56, P.metal);
      s.box(11.28, 1.08, 0.36, 11.4, 1.18, 0.48, P.white);
      s.box(11.48, 1.3, 0.5, 11.53, 1.35, 0.52, P.red);
      this.steam.push(this.addSteam(11.34, 1.2, 0.42, 0.55));
      // Fruit bowl and mugs.
      s.box(12.1, 0.94, 0.2, 12.5, 1.02, 0.55, P.potWhite);
      s.box(12.16, 1.0, 0.28, 12.28, 1.1, 0.4, P.red);
      s.box(12.3, 1.0, 0.3, 12.42, 1.1, 0.42, P.yellow);
      s.box(11.8, 0.94, 0.25, 11.9, 1.06, 0.35, P.white);
      // Upper cabinets and an open shelf.
      s.box(9.55, 1.7, 0, 11.85, 2.42, 0.38, P.cabinet, { top: P.cabinet });
      for (let x = 9.55; x < 11.8; x += 0.765) s.box(x + 0.04, 1.75, 0.38, x + 0.725, 2.37, 0.4, P.cabinetDark);
      s.box(12.0, 1.85, 0, 12.95, 1.9, 0.32, P.woodLight);
      s.box(12.1, 1.9, 0.06, 12.3, 2.1, 0.26, P.potClay);
      s.box(12.06, 2.08, 0.04, 12.34, 2.25, 0.28, P.leafA);
      s.box(12.5, 1.9, 0.1, 12.6, 2.02, 0.2, P.white);
      s.box(12.66, 1.9, 0.1, 12.76, 2.02, 0.2, P.books[1]);
      // Fridge.
      s.box(13.05, 0, 0.02, 13.95, 2.05, 0.8, P.fridge, { ao: 0.1 });
      s.box(13.08, 1.28, 0.8, 13.92, 1.31, 0.81, P.metalLight);
      s.box(13.12, 1.4, 0.8, 13.18, 1.8, 0.86, P.metalLight);
      s.box(13.12, 0.7, 0.8, 13.18, 1.15, 0.86, P.metalLight);
      s.box(13.4, 1.55, 0.8, 13.55, 1.7, 0.82, P.yellow);
      this.block(9.5, 0, 14, 0.86, 0.15);
      this.spot({ id: "coffee", activity: "coffee", approach: v2(11.38, 1.35), face: Math.PI, weight: 1.6, stay: [6, 10] });
      this.spot({ id: "sink", activity: "water", approach: v2(10.3, 1.3), face: Math.PI, weight: 0.4, stay: [4, 7] });
      this.spot({ id: "fridge", activity: "snack", approach: v2(13.3, 1.5), face: Math.PI, weight: 0.7, stay: [4, 8] });
    }

    /* -- bistro table with two stools -- */
    {
      const cx = 11.3;
      const cz = 2.75;
      s.box(cx - 0.42, 0.74, cz - 0.42, cx + 0.42, 0.8, cz + 0.42, P.woodLight);
      s.box(cx - 0.05, 0.05, cz - 0.05, cx + 0.05, 0.74, cz + 0.05, P.metal);
      s.box(cx - 0.25, 0, cz - 0.25, cx + 0.25, 0.05, cz + 0.25, P.metal);
      s.box(cx - 0.12, 0.8, cz - 0.1, cx, 0.9, cz + 0.02, P.white);
      this.steam.push(this.addSteam(cx - 0.06, 0.9, cz - 0.04, 0.4));
      this.block(cx - 0.42, cz - 0.42, cx + 0.42, cz + 0.42, 0.12);
      for (const side of [-1, 1]) {
        const sx = cx + side * 0.78;
        s.box(sx - 0.2, 0.55, cz - 0.2, sx + 0.2, 0.62, cz + 0.2, P.yellow);
        s.box(sx - 0.03, 0.05, cz - 0.03, sx + 0.03, 0.55, cz + 0.03, P.metal);
        s.box(sx - 0.16, 0, cz - 0.16, sx + 0.16, 0.05, cz + 0.16, P.metal);
        s.box(sx - 0.17, 0.22, cz - 0.17, sx + 0.17, 0.25, cz + 0.17, P.metal);
        this.block(sx - 0.2, cz - 0.2, sx + 0.2, cz + 0.2, 0.12);
        this.spot({
          id: `stool${side}`,
          activity: "chat",
          approach: v2(sx + side * 0.55, cz + 0.25),
          face: side < 0 ? Math.PI / 2 : -Math.PI / 2,
          seat: { x: sx, z: cz, y: 0.62 },
          weight: 0.9,
          stay: [10, 18],
          group: "bistro",
        });
      }
    }

    /* -- beanbags in the front corner -- */
    {
      const bags: [number, number, number, number][] = [
        [11.7, 7.3, P.red, -Math.PI * 0.75],
        [12.9, 8.3, 0x4fa7b3, -Math.PI * 0.6],
      ];
      for (const [x, z, color, face] of bags) {
        s.box(x - 0.38, 0, z - 0.38, x + 0.38, 0.24, z + 0.38, color, { ao: 0.15 });
        s.box(x - 0.3, 0.24, z - 0.3, x + 0.3, 0.32, z + 0.3, color);
        const bx = x - Math.sin(face) * 0.3;
        const bz = z - Math.cos(face) * 0.3;
        s.box(bx - 0.26, 0.24, bz - 0.26, bx + 0.26, 0.58, bz + 0.26, color);
        this.block(x - 0.38, z - 0.38, x + 0.38, z + 0.38, 0.12);
        this.spot({
          id: `bag${x}`,
          activity: "lounge",
          approach: v2(x + Math.sin(face) * 0.85, z + Math.cos(face) * 0.85),
          face,
          seat: { x: x + Math.sin(face) * 0.05, z: z + Math.cos(face) * 0.05, y: 0.3 },
          weight: 1,
          stay: [12, 22],
        });
      }
      // A small round rug under them.
      s.box(11.0, 0, 6.6, 13.6, 0.01, 9.0, 0xe9e2d6);
    }

    /* -- windows: places to stand and look out -- */
    this.spot({ id: "window0", activity: "window", approach: v2(0.75, 2.3), face: -Math.PI / 2, weight: 0.8, stay: [6, 11] });
    this.spot({ id: "window1", activity: "window", approach: v2(0.75, 5.3), face: -Math.PI / 2, weight: 0.8, stay: [6, 11] });

    /* -- the garden outside -- */
    this.buildGarden(s, R, mat);

    // Merge and add.
    this.addMesh(s, mat);
    const accentMesh = this.addMesh(accent, this.accentMat);
    accentMesh.castShadow = false;
    this.addMesh(glow, this.lampGlow, { cast: false });
    this.accentMat.color.copy(decorAccent(this.theme));

    // Motes drift in the window light.
    {
      const n = 46;
      const seed = new Float32Array(n * 4);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 4));
      const pts = new THREE.Points(g, this.motes);
      pts.frustumCulled = false;
      pts.layers.set(1);
      (this.motes.uniforms.uBoxMin.value as THREE.Vector3).set(0.1, 0.4, 1.2);
      (this.motes.uniforms.uBoxSize.value as THREE.Vector3).set(4.5, 2.2, 8.2);
      this.scene.add(pts);
    }
    // Fireflies in the garden at night.
    {
      const n = 40;
      const seed = new Float32Array(n * 4);
      for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
      g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 4));
      const pts = new THREE.Points(g, this.fireflies);
      pts.frustumCulled = false;
      pts.layers.set(1);
      (this.fireflies.uniforms.uBoxMin.value as THREE.Vector3).set(W + 0.8, 0.2, -2);
      (this.fireflies.uniforms.uBoxSize.value as THREE.Vector3).set(7, 1.6, 20);
      this.scene.add(pts);
    }
  }

  private addLamp(x: number, y: number, z: number, power: number, distance: number): void {
    const l = new THREE.PointLight(0xffd9a0, 0, distance, 1.4);
    l.position.set(x, y, z);
    l.userData.power = power;
    this.lamps.push(l);
    this.scene.add(l);
  }

  private addSteam(x: number, y: number, z: number, height: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      vertexShader: POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uMode: { value: 2 },
        uBoxMin: { value: new THREE.Vector3(x, y, z) },
        uBoxSize: { value: new THREE.Vector3(1, height, 1) },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const n = 6;
    const seed = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = i / n;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("seed", new THREE.Float32BufferAttribute(seed, 4));
    const pts = new THREE.Points(g, mat);
    pts.frustumCulled = false;
    pts.layers.set(1);
    this.scene.add(pts);
    return mat;
  }

  /** Soft additive prisms from each window down to the floor, along the sun. */
  private buildBeams(): void {
    const pos: number[] = [];
    const fade: number[] = [];
    const idx: number[] = [];
    for (const [a, b] of WINDOWS) {
      const top = [
        [0.02, WIN_TOP - 0.05, a + 0.05],
        [0.02, WIN_TOP - 0.05, b - 0.05],
        [0.02, SILL + 0.05, b - 0.05],
        [0.02, SILL + 0.05, a + 0.05],
      ];
      const base = pos.length / 3;
      // The same corners twice: once at the window, once extruded to the floor in the shader.
      for (const k of [1, 0])
        for (const p of top) {
          pos.push(p[0], p[1], p[2]);
          fade.push(k);
        }
      const quads = [
        [0, 1, 5, 4],
        [3, 2, 6, 7],
        [0, 3, 7, 4],
        [1, 2, 6, 5],
      ];
      for (const [q0, q1, q2, q3] of quads) idx.push(base + q0, base + q1, base + q2, base + q0, base + q2, base + q3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("extra", new THREE.Float32BufferAttribute(fade, 1));
    g.setIndex(idx);
    this.beamMat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(g, this.beamMat);
    mesh.layers.set(1);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    this.scene.add(mesh);
  }

  private buildGarden(s: Builder, R: () => number, mat: THREE.Material): void {
    const tree = (x: number, z: number, size: number) => {
      s.box(x - 0.16 * size, -0.1, z - 0.16 * size, x + 0.16 * size, 1.5 * size, z + 0.16 * size, P.trunk);
      const c = new Builder();
      const cols = [P.treeA, P.treeB, P.treeC];
      const k = R() < 0.5 ? 0 : 1;
      c.box(-0.95 * size, 0, -0.95 * size, 0.95 * size, 1.15 * size, 0.95 * size, cols[k]);
      c.box(-0.7 * size, 1.15 * size, -0.7 * size, 0.7 * size, 1.85 * size, 0.7 * size, cols[(k + 2) % 3]);
      c.box(-0.4 * size, 1.85 * size, -0.4 * size, 0.4 * size, 2.3 * size, 0.4 * size, cols[(k + 1) % 3]);
      c.box(0.5 * size, 0.3 * size, 0.5 * size, 1.15 * size, 0.95 * size, 1.1 * size, cols[(k + 1) % 3]);
      const mesh = this.addMesh(c, mat);
      mesh.position.set(x, 1.15 * size, z);
      this.swayers.push({ obj: mesh, amount: 0.012, speed: 0.6 + R() * 0.3, phase: R() * 6 });
    };
    // Behind the walls: canopies peek over the top.
    tree(-2.6, -2.2, 1.25);
    tree(-3.4, 4.2, 1.1);
    tree(-2.8, 9.4, 1.3);
    tree(3.6, -3.1, 1.15);
    tree(9.4, -3.0, 1.3);
    tree(15.6, -2.4, 1.05);
    // In front.
    tree(17.6, 3.2, 1.2);
    tree(18.6, 12.4, 1.35);
    tree(5.2, 15.2, 1.2);
    tree(-3.5, 15.0, 1.1);
    tree(14.6, 16.0, 1.0);

    const bush = (x: number, z: number, w: number, d: number, h: number) => {
      s.box(x - w / 2, -0.1, z - d / 2, x + w / 2, h, z + d / 2, P.leafB, { ao: 0.2 });
      s.box(x - w / 2 + 0.1, h, z - d / 2 + 0.1, x + w / 2 - 0.1, h + 0.16, z + d / 2 - 0.1, P.leafA);
    };
    for (let z = 0.6; z < D - 0.4; z += 1.5 + R() * 0.6) bush(W + 1.0, z, 0.9, 1.0 + R() * 0.3, 0.45 + R() * 0.2);
    for (let x = 0.6; x < ENTRANCE[0] - 0.8; x += 1.4 + R() * 0.7) bush(x, D + 1.0, 1.0 + R() * 0.3, 0.9, 0.4 + R() * 0.2);
    bush(13.0, D + 1.0, 1.3, 0.9, 0.5);

    // Flowers.
    const flowers = [P.pink, P.yellow, P.white, P.blue];
    for (let i = 0; i < 90; i++) {
      const x = BASE.x0 + 0.5 + R() * (BASE.x1 - BASE.x0 - 1);
      const z = BASE.z0 + 0.5 + R() * (BASE.z1 - BASE.z0 - 1);
      if (x > -WT - 0.6 && x < W + 1.7 && z > -WT - 0.6 && z < D + 1.7) continue;
      const c = flowers[Math.floor(R() * flowers.length)];
      s.box(x, -0.1, z, x + 0.1, 0.02, z + 0.1, c);
    }

    // A bench and a street lamp by the path.
    {
      const bx = 16.4;
      const bz = 7.6;
      s.box(bx - 0.25, 0.32, bz - 0.8, bx + 0.25, 0.38, bz + 0.8, P.woodLight);
      s.box(bx + 0.2, 0.38, bz - 0.8, bx + 0.28, 0.75, bz + 0.8, P.woodLight);
      s.box(bx - 0.2, -0.1, bz - 0.7, bx + 0.2, 0.32, bz - 0.62, P.metal);
      s.box(bx - 0.2, -0.1, bz + 0.62, bx + 0.2, 0.32, bz + 0.7, P.metal);
    }
    {
      const lx = ENTRANCE[1] + 1.3;
      const lz = D + 2.4;
      s.box(lx - 0.16, -0.1, lz - 0.16, lx + 0.16, 0.1, lz + 0.16, P.metal);
      s.box(lx - 0.05, 0.1, lz - 0.05, lx + 0.05, 2.3, lz + 0.05, P.metal);
      s.box(lx - 0.18, 2.3, lz - 0.18, lx + 0.18, 2.36, lz + 0.18, P.metal);
      const g = new Builder();
      g.box(lx - 0.14, 2.0, lz - 0.14, lx + 0.14, 2.3, lz + 0.14, 0xfff2d6);
      this.addMesh(g, this.lampGlow, { cast: false });
      this.addLamp(lx, 1.9, lz, 3, 7);
    }
    // A mailbox.
    s.box(ENTRANCE[0] - 0.8, -0.1, D + 1.9, ENTRANCE[0] - 0.72, 0.75, D + 1.98, P.woodDark);
    s.box(ENTRANCE[0] - 0.98, 0.75, D + 1.8, ENTRANCE[0] - 0.54, 1.0, D + 2.1, 0x3a7bd5);
  }

  /* ------------------------------------------------------------- agents */

  private buildAgents(): void {
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.disposables.push(mat);
    const starts = [v2(3.0, 3.0), v2(10.0, 4.0), v2(7.5, 8.3), v2(4.0, 6.0)];
    AGENT_LOOKS.forEach((look, i) => {
      const a = new Agent(i, look, mat, this.nav.nearestFree(starts[i]));
      a.root.position.set(a.pos.x, 0, a.pos.z);
      this.scene.add(a.root);
      this.agents.push(a);
      a.stayUntil = rand(0.5, 4);
    });
  }

  /** What an agent should be doing now; sets a new goal when that changes. */
  private think(a: Agent): void {
    const t = this.time;
    if (a.job) {
      if (a.job.state === "queued") {
        const wait = a.spot?.activity === "wait" ? undefined : this.freeSpot(this.waits, a);
        if (wait) this.goTo(a, wait, true);
        return;
      }
      if (a.spot?.activity !== "type") {
        const desk = this.freeSpot(this.desks, a, a.index);
        const wait = desk || a.spot?.activity === "wait" ? undefined : this.freeSpot(this.waits, a);
        if (desk || wait) this.goTo(a, desk ?? wait!, true);
      }
      return;
    }
    if (a.mood && t < a.mood.until) return;
    if (a.mood) a.mood = null;
    if (t < a.stayUntil) return;
    this.goIdle(a);
  }

  private goIdle(a: Agent): void {
    const options = this.spots.filter((s) => s.weight > 0 && (!s.by || s.by === a) && s !== a.spot);
    let pick: Spot | null = null;
    if (Math.random() > 0.12) {
      // Prefer the bistro when someone is already there: that is a chat.
      let total = 0;
      const weights = options.map((s) => {
        let w = s.weight;
        if (s.group === "bistro" && this.spots.some((o) => o.group === "bistro" && o.by && o.by !== a)) w *= 3;
        total += w;
        return w;
      });
      let r = Math.random() * total;
      for (let i = 0; i < options.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          pick = options[i];
          break;
        }
      }
    }
    if (!pick) {
      // Stroll to a random free place and look around.
      pick = { id: "stroll", activity: "stroll", approach: this.nav.randomFree(), face: Math.random() * 6.28, weight: 0, stay: [3, 7], by: null };
    }
    this.goTo(a, pick, false);
    // The clock starts when the agent gets there.
    a.stayFor = rand(pick.stay[0], pick.stay[1]);
    a.stayUntil = Infinity;
  }

  /** A free spot from the list, preferring index `prefer`. */
  private freeSpot(list: Spot[], a: Agent, prefer?: number): Spot | undefined {
    if (prefer !== undefined && list[prefer] && (!list[prefer].by || list[prefer].by === a)) return list[prefer];
    return list.find((s) => !s.by || s.by === a);
  }

  /** Plan a route to a spot: stand up if seated, walk, turn, sit if it has a seat. */
  private goTo(a: Agent, spot: Spot | null, hurry: boolean): void {
    if (spot && a.spot === spot) return;
    const prev = a.spot;
    if (a.spot && a.spot.by === a) a.spot.by = null;
    a.spot = spot;
    if (spot) spot.by = a;
    const current = a.plan[0];
    const plan: Step[] = [];
    // A sit or stand in progress finishes first.
    if (current && (current.kind === "sit" || current.kind === "stand")) plan.push(current);
    const willBeSeated = current?.kind === "sit" || (a.seated && current?.kind !== "stand");
    if (willBeSeated) {
      const seatSpot = current?.kind === "sit" ? current.spot : prev;
      const seat = seatSpot?.seat ?? { x: a.pos.x, z: a.pos.z, y: a.seatY };
      const to = seatSpot?.seat ? seatSpot.approach : this.nav.nearestFree(v2(a.pos.x + Math.sin(a.heading) * 0.6, a.pos.z + Math.cos(a.heading) * 0.6));
      plan.push({ kind: "stand", t: 0, from: v2(seat.x, seat.z), to, seatY: seat.y });
    }
    if (spot) {
      plan.push({ kind: "walk", to: spot.approach, hurry, blockedFor: 0 });
      plan.push({ kind: "turn", face: spot.face });
      if (spot.seat) plan.push({ kind: "sit", spot, t: 0, from: spot.approach });
    }
    plan.push({ kind: "do" });
    a.plan = plan;
  }

  /** Executes the agent's plan: walking, turning, sitting down and standing up. */
  private move(a: Agent, dt: number): void {
    const step = a.plan[0];
    let moving = false;
    if (step) {
      switch (step.kind) {
        case "walk": {
          if (!step.path) step.path = this.nav.find(a.pos, step.to);
          const next = step.path[0];
          if (!next) {
            a.plan.shift();
            break;
          }
          const dx = next.x - a.pos.x;
          const dz = next.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          const remaining = d + step.path.slice(1).reduce((s, p, i) => s + dist(p, i === 0 ? next : step.path![i]), 0);
          let target = (step.hurry ? 1.55 : 1.05) * clamp(remaining * 1.6 + 0.25, 0, 1);
          // Yield to someone just ahead (standing still, or with right of way) and step aside.
          const ahead = this.agents.find((o) => {
            if (o === a) return false;
            const ox = o.pos.x - a.pos.x;
            const oz = o.pos.z - a.pos.z;
            const od = Math.hypot(ox, oz);
            return od < 0.62 && (ox * dx + oz * dz) / (od * d + 1e-6) > 0.55 && ((o.speed < 0.2 && !o.yielding) || o.index < a.index);
          });
          a.yielding = Boolean(ahead) && step.blockedFor < 1.6;
          if (a.yielding) {
            step.blockedFor += dt;
            target = 0;
            const side = v2(a.pos.x + (dz / d) * 0.5 * dt, a.pos.z - (dx / d) * 0.5 * dt);
            if (this.nav.free(side)) a.pos = side;
          } else if (!ahead) step.blockedFor = Math.max(0, step.blockedFor - dt);
          a.speed = damp(a.speed, target, 6, dt);
          if (d < 0.04 || a.speed * dt >= d) {
            a.pos.x = next.x;
            a.pos.z = next.z;
            step.path.shift();
            if (!step.path.length) a.plan.shift();
          } else {
            a.pos.x += (dx / d) * a.speed * dt;
            a.pos.z += (dz / d) * a.speed * dt;
            a.heading = dampAngle(a.heading, Math.atan2(dx, dz), 9, dt);
          }
          moving = a.speed > 0.05;
          break;
        }
        case "turn": {
          a.heading = dampAngle(a.heading, step.face, 8, dt);
          if (Math.abs(wrapAngle(step.face - a.heading)) < 0.05) a.plan.shift();
          break;
        }
        case "sit": {
          step.t = Math.min(1, step.t + dt / 0.7);
          const seat = step.spot.seat!;
          const k = ease(Math.min(1, step.t * 1.25));
          a.pos.x = lerp(step.from.x, seat.x, k);
          a.pos.z = lerp(step.from.z, seat.z, k);
          a.heading = dampAngle(a.heading, step.spot.face, 10, dt);
          a.seatY = seat.y;
          a.seatT = ease(clamp((step.t - 0.25) / 0.75, 0, 1));
          if (step.t >= 1) a.plan.shift();
          break;
        }
        case "stand": {
          step.t = Math.min(1, step.t + dt / 0.6);
          a.seatT = 1 - ease(clamp(step.t / 0.7, 0, 1));
          a.seatY = step.seatY;
          const k = ease(clamp((step.t - 0.3) / 0.7, 0, 1));
          a.pos.x = lerp(step.from.x, step.to.x, k);
          a.pos.z = lerp(step.from.z, step.to.z, k);
          if (step.t >= 1) {
            a.seatT = 0;
            a.plan.shift();
          }
          break;
        }
        case "do":
          break;
      }
    }
    if (!moving) a.speed = damp(a.speed, 0, 8, dt);
    if (step?.kind !== "walk") a.yielding = false;
    if (a.stayUntil === Infinity && a.plan[0]?.kind === "do") a.stayUntil = this.time + a.stayFor;
    a.root.position.set(a.pos.x, 0, a.pos.z);
    a.root.rotation.y = a.heading;
  }

  /** Poses the body from what the agent is doing. */
  private animate(a: Agent, dt: number): void {
    const t = this.time;
    const atSpot = a.plan.length > 0 && a.plan[0].kind === "do";
    const act = atSpot ? a.spot?.activity : undefined;
    const job = a.job;
    const mood = a.mood && t < a.mood.until ? a.mood.word : null;

    const target: Pose = { walk: 0, type: 0, raise: 0, cheer: 0, scratch: 0, hold: 0, point: 0, lean: 0, phone: 0, shrug: 0 };
    target.walk = clamp(a.speed / 0.9, 0, 1);
    let prop: keyof Agent["props"] | null = null;
    if (atSpot) {
      if (act === "type" && job) {
        if (job.state === "question") {
          target.raise = 1;
          target.lean = 1;
        } else target.type = 1;
      } else if (act === "coffee" || act === "water" || act === "snack") {
        target.hold = 1;
        prop = "mug";
      } else if (act === "read") {
        target.hold = 0.55;
        prop = "book";
      } else if (act === "think") target.point = 1;
      else if (act === "plants") {
        target.hold = 0.4;
        prop = "can";
      } else if (act === "lounge" || act === "chat") {
        if (a.index % 2 === 0 && act === "lounge") {
          target.phone = 1;
          prop = "phone";
        } else target.hold = act === "chat" ? 0.6 : 0;
        if (act === "chat") prop = "mug";
      }
    }
    if (mood && !a.seated) {
      if (mood === "shipped") target.cheer = 1;
      else if (mood === "issue") target.scratch = 1;
      else target.shrug = 1;
    }
    for (const k of Object.keys(target) as (keyof Pose)[]) a.pose[k] = damp(a.pose[k], target[k], 7, dt);
    for (const [k, m] of Object.entries(a.props)) m.visible = k === prop && a.pose.hold + a.pose.phone > 0.3;

    const p = a.pose;
    a.phase += dt * (3 + a.speed * 7.5);
    const sw = Math.sin(a.phase);
    const sit = a.seatT;

    // Hop when celebrating.
    a.hop = mood === "shipped" && !a.seated ? Math.abs(Math.sin(t * 7)) * 0.16 * p.cheer : damp(a.hop, 0, 10, dt);
    const bob = p.walk * Math.abs(Math.cos(a.phase)) * 0.045 + Math.sin(t * 2 + a.index) * 0.008;
    a.body.position.y = sit * (a.seatY + 0.02 - 0.4) + bob + a.hop;

    a.legL.rotation.x = -sit * 1.45 + p.walk * sw * 0.6;
    a.legR.rotation.x = -sit * 1.45 - p.walk * sw * 0.6;
    a.legL.rotation.z = 0;
    a.legR.rotation.z = 0;

    const sip = p.hold > 0.5 ? Math.max(0, Math.sin(t * 0.9 + a.index)) ** 6 : 0;
    const typeL = Math.sin(t * 17 + a.index) * 0.09;
    const typeR = Math.sin(t * 19 + a.index * 2) * 0.09;
    const chat = Math.sin(t * 3.1 + a.index) * 0.25 * (act === "chat" ? 1 : 0);
    const wave = Math.sin(t * 2.2) * 0.25;
    a.armL.rotation.x = -p.walk * sw * 0.55 + p.type * (-1.2 + typeL) + p.cheer * -2.8 + p.scratch * -2.5 + p.lean * -0.3 + p.phone * -0.9 + p.shrug * -0.35;
    a.armR.rotation.x =
      p.walk * sw * 0.55 + p.type * (-1.2 + typeR) + p.raise * -2.9 + p.cheer * -2.8 + p.hold * (-1.0 - 0.9 * sip) + chat + p.point * (-1.9 + wave * 0.3) + p.phone * -0.9 + p.shrug * -0.35;
    a.armL.rotation.z = p.cheer * -0.35 + p.scratch * 0.35 + p.shrug * -0.5 + p.phone * 0.35;
    a.armR.rotation.z = p.cheer * 0.35 + p.raise * -0.15 + p.shrug * 0.5 + p.phone * -0.35 + p.point * -0.2;

    a.torso.rotation.x = p.type * 0.1 - p.lean * 0.14 + p.walk * 0.04;
    a.torso.rotation.z = p.walk * Math.sin(a.phase) * 0.03;

    // The head nods while typing, looks down at books and phones, and looks around otherwise.
    if (t > a.lookAt) {
      a.lookTarget = act === "chat" || act === "window" || act === "stroll" || act === "wait" || (!atSpot && !a.speed) ? rand(-0.7, 0.7) : rand(-0.25, 0.25);
      a.lookAt = t + rand(1.5, 4.5);
    }
    a.lookYaw = damp(a.lookYaw, p.type > 0.5 ? 0 : a.lookTarget, 3, dt);
    a.head.rotation.y = a.lookYaw * (1 - p.walk * 0.7);
    a.head.rotation.x = p.type * (0.06 + Math.sin(t * 2.3 + a.index) * 0.03) + (p.phone + (prop === "book" ? 1 : 0)) * 0.3 - p.lean * 0.12 + (mood === "shipped" ? -0.2 : 0);
    a.head.rotation.z = mood === "issue" ? Math.sin(t * 5) * 0.08 : 0;

    // Blink now and then.
    if (t > a.blinkAt) {
      a.eyes.scale.y = 0.15;
      if (t > a.blinkAt + 0.12) {
        a.eyes.scale.y = 1;
        a.blinkAt = t + rand(2, 6);
      }
    }

    // The status word.
    if (job) {
      const seatedAtDesk = atSpot && a.spot?.activity === "type";
      a.word = job.state === "queued" ? "waiting" : job.state === "question" ? (seatedAtDesk ? "question" : "starting") : seatedAtDesk ? "working" : "starting";
    } else if (mood) a.word = mood;
    // At the bistro it is "chatting" only with company; on the way there it is "coffee".
    else if (a.spot?.activity === "chat") a.word = atSpot && this.spots.some((s) => s.group === "bistro" && s.by && s.by !== a && s.by.plan[0]?.kind === "do") ? "chatting" : "coffee";
    else if (a.spot) a.word = ACTIVITY_WORD[a.spot.activity];
    else a.word = "idle";

    // The desk screen follows its sitter.
    const desk = a.spot?.desk;
    if (desk !== undefined) {
      const s = this.screens[desk];
      if (atSpot && job) s.state = job.state === "question" ? 2 : 1;
    }
  }

  /* -------------------------------------------------------------- jobs */

  private applyJobs(jobs: OfficeJob[], initial: boolean): void {
    const byId = new Map(jobs.map((j) => [j.id, j]));
    for (const a of this.agents) {
      if (!a.job) continue;
      const j = byId.get(a.job.id);
      if (!j) {
        a.job = null;
        this.finish(a, null);
        continue;
      }
      if (j.status === "succeeded" || j.status === "failed" || j.status === "cancelled") {
        a.job = null;
        this.finish(a, j.status === "succeeded" ? "shipped" : j.status === "failed" ? "issue" : "stopped");
        continue;
      }
      a.job.state = j.status === "queued" ? "queued" : j.question ? "question" : "running";
    }
    const taken = new Set(this.agents.filter((a) => a.job).map((a) => a.job!.id));
    const fresh = jobs
      .filter((j) => (j.status === "running" || j.status === "queued") && !taken.has(j.id))
      .sort((x, y) => (x.status === y.status ? x.id - y.id : x.status === "running" ? -1 : 1));
    let overflow = 0;
    for (const j of fresh) {
      const free = this.agents
        .filter((a) => !a.job)
        .sort((x, y) => (x.mood ? 1 : 0) - (y.mood ? 1 : 0) || this.deskDistance(x) - this.deskDistance(y))[0];
      if (!free) {
        overflow++;
        continue;
      }
      free.job = { id: j.id, state: j.status === "queued" ? "queued" : j.question ? "question" : "running" };
      free.mood = null;
      if (initial && j.status === "running") this.seatNow(free);
    }
    this.overflow = overflow;
  }

  private deskDistance(a: Agent): number {
    const free = this.desks.filter((d) => !d.by);
    return free.length ? Math.min(...free.map((d) => dist(a.pos, d.approach))) : 0;
  }

  /** On first load, agents already at work start in their seats. */
  private seatNow(a: Agent): void {
    const desk = this.freeSpot(this.desks, a, a.index);
    if (!desk?.seat) return;
    if (a.spot && a.spot.by === a) a.spot.by = null;
    desk.by = a;
    a.spot = desk;
    a.pos = v2(desk.seat.x, desk.seat.z);
    a.heading = desk.face;
    a.seatT = 1;
    a.seatY = desk.seat.y;
    a.plan = [{ kind: "do" }];
  }

  private finish(a: Agent, mood: Mood | null): void {
    const desk = a.spot?.desk;
    if (desk !== undefined) {
      // The screen shows the result for a while.
      const screen = this.screens[desk];
      screen.state = mood === "shipped" ? 4 : mood === "issue" ? 3 : 0;
      screen.until = this.time + 7;
    }
    if (mood) a.mood = { word: mood, until: this.time + (mood === "shipped" ? 6 : mood === "issue" ? 8 : 4) };
    // Stand up and stay a moment, then wander off.
    this.goTo(a, null, false);
    a.stayUntil = this.time + (mood ? 3.5 : 0.5);
  }

  /* -------------------------------------------------------------- demo */

  private spawnDemoJobs(count: number): void {
    const t = this.time;
    for (let i = 0; i < count; i++) {
      if (this.demo.jobs.length >= 4) break;
      const queued = Math.random() < 0.2;
      const startAt = t + (queued ? rand(4, 8) : 0);
      const endAt = startAt + rand(18, 42);
      const asks = Math.random() < 0.35;
      this.demo.jobs.push({
        id: -this.demo.seq++,
        status: queued ? "queued" : "running",
        question: false,
        startAt,
        askAt: asks ? startAt + rand(6, (endAt - startAt) * 0.6) : Infinity,
        askFor: rand(5, 10),
        endAt,
        outcome: Math.random() < 0.82 ? "succeeded" : "failed",
      });
    }
  }

  private tickDemo(): void {
    const t = this.time;
    const d = this.demo;
    if (t >= d.next) {
      const busy = d.jobs.length;
      if (busy < 3 && Math.random() < 0.75) this.spawnDemoJobs(Math.random() < 0.3 ? 2 : 1);
      d.next = t + rand(7, 16);
    }
    const out: OfficeJob[] = [];
    for (const j of d.jobs) {
      if (t >= j.endAt) j.status = j.outcome;
      else if (t >= j.startAt) j.status = "running";
      j.question = t >= j.askAt && t < j.askAt + j.askFor;
      out.push({ id: j.id, status: j.status, question: j.question });
    }
    this.applyJobs(out, false);
    d.jobs = d.jobs.filter((j) => t < j.endAt);
  }

  private summarise(): void {
    const s: OfficeSummary = { working: 0, question: 0, waiting: 0, overflow: this.overflow };
    for (const a of this.agents) {
      if (!a.job) continue;
      if (a.job.state === "queued") s.waiting++;
      else if (a.job.state === "question") s.question++;
      else s.working++;
    }
    const key = `${s.working}/${s.question}/${s.waiting}/${s.overflow}`;
    if (key !== this.lastSummary) {
      this.lastSummary = key;
      this.onSummary?.(s);
    }
  }

  /* ------------------------------------------------------------- render */

  private render(): void {
    if (!this.artW) return;
    // Snap the camera to the pixel grid; the remainder moves the canvas by a fraction of a pixel.
    const tx = this.view.x;
    const ty = this.view.y;
    const sx = Math.round(tx * this.ppu) / this.ppu;
    const sy = Math.round(ty * this.ppu) / this.ppu;
    const target = new THREE.Vector3().addScaledVector(this.right, sx).addScaledVector(this.up, sy);
    this.camera.position.copy(target).addScaledVector(this.camDir, 70);
    this.camera.lookAt(target);
    this.camera.updateMatrixWorld();
    const fx = (tx - sx) * this.ppu * this.ps;
    const fy = (ty - sy) * this.ppu * this.ps;
    const rect = this.container.getBoundingClientRect();
    const left = (rect.width - this.artW * this.ps) / 2 - fx;
    const top = (rect.height - this.artH * this.ps) / 2 + fy;
    this.stage.style.transform = `translate3d(${left.toFixed(2)}px, ${top.toFixed(2)}px, 0)`;
    // The rows of the canvas the box shows right now, so labels stay inside them.
    this.visibleRows = [Math.max(0, -top / this.ps), Math.min(this.artH, (rect.height - top) / this.ps)];

    const r = this.renderer;
    // Shadows: once per frame, before the passes.
    r.shadowMap.needsUpdate = true;
    // Normals and depth for the edges (solid things only).
    this.camera.layers.set(0);
    this.scene.overrideMaterial = this.normalMat;
    r.setRenderTarget(this.rtNormal);
    r.setClearColor(0x8080ff, 1);
    r.clear();
    r.render(this.scene, this.camera);
    // Colour.
    this.scene.overrideMaterial = null;
    this.camera.layers.enableAll();
    r.setRenderTarget(this.rtColor);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.camera);
    // Edges, palette, upscale.
    r.setRenderTarget(null);
    r.render(this.postScene, this.postCamera);

    this.drawTags();
  }

  private visibleRows: [number, number] = [0, 0];

  private tag(word: string, dot: string): HTMLCanvasElement {
    const key = `${this.theme}|${word}|${dot}`;
    let c = this.tagCache.get(key);
    if (c) return c;
    const text = word.toUpperCase();
    const tw = textWidth(text);
    const w = tw + 8;
    const h = 9;
    c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d")!;
    const colors = TAGS[this.theme];
    g.fillStyle = colors.bg;
    // A pill with clipped corners and a little pointer.
    g.fillRect(1, 0, w - 2, 7);
    g.fillRect(0, 1, w, 5);
    g.fillRect(Math.floor(w / 2) - 1, 7, 3, 1);
    g.fillRect(Math.floor(w / 2), 8, 1, 1);
    g.fillStyle = dot;
    g.fillRect(2, 2, 3, 3);
    g.fillStyle = colors.text;
    drawText(g, text, 6, 1);
    this.tagCache.set(key, c);
    return c;
  }

  private drawTags(): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.artW, this.artH);
    const colors = TAGS[this.theme];
    const tagColor: Record<string, string> = {
      working: colors.accent,
      starting: colors.accent,
      question: "#facc15",
      waiting: "#a1a1aa",
      issue: "#f43f5e",
      shipped: "#84cc16",
      stopped: "#a1a1aa",
    };
    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const p = new THREE.Vector3();
    const order = [...this.agents].sort((x, y) => y.pos.x + y.pos.z - (x.pos.x + x.pos.z));
    for (const a of order) {
      a.labelAnchor(p).project(this.camera);
      const dot = tagColor[a.word] ?? (this.theme === "matrix" ? "#12862f" : colors.muted);
      const img = this.tag(a.word, this.theme === "matrix" ? (tagColor[a.word] ? "#00ff41" : "#12862f") : dot);
      let x = Math.round(((p.x + 1) / 2) * this.artW - img.width / 2);
      let y = Math.round(((1 - p.y) / 2) * this.artH - img.height);
      const urgent = a.word === "question" || a.word === "issue";
      if (urgent) y -= Math.round(Math.abs(Math.sin(this.time * 3)) * 2);
      // Keep it inside the visible part of the canvas (the strip shows only a band of it).
      x = clamp(x, 1, this.artW - img.width - 1);
      const [top, bottom] = this.visibleRows;
      const minY = Math.ceil(top + 1);
      if (y < minY && p.y < 1) y = minY;
      // Then move it off any label already placed: up, or down when there is no room above.
      for (let guard = 0; guard < 3; guard++) {
        const hit = placed.find((q) => x < q.x + q.w && x + img.width > q.x && y < q.y + q.h && y + img.height > q.y);
        if (!hit) break;
        const up = hit.y - img.height - 1;
        y = up >= minY ? up : hit.y + hit.h + 1;
      }
      placed.push({ x, y, w: img.width, h: img.height });
      if (y > bottom) continue;
      ctx.globalAlpha = tagColor[a.word] ? 1 : 0.82;
      ctx.drawImage(img, x, y);
      // A little rain cloud for problems, sparkles for shipped work.
      if (a.word === "issue") this.drawCloud(ctx, x + img.width / 2, y - 6);
      if (a.word === "shipped") this.drawSparkles(ctx, x + img.width / 2, y - 2, a.index);
    }
    ctx.globalAlpha = 1;
  }

  private drawCloud(ctx: CanvasRenderingContext2D, cx: number, cy: number): void {
    const x = Math.round(cx - 4);
    const y = Math.round(cy);
    ctx.fillStyle = this.theme === "matrix" ? "#12862f" : "#9aa3b5";
    ctx.fillRect(x + 2, y, 4, 1);
    ctx.fillRect(x + 1, y + 1, 7, 1);
    ctx.fillRect(x, y + 2, 9, 2);
    ctx.fillStyle = this.theme === "matrix" ? "#00ff41" : "#7cc4ff";
    for (let i = 0; i < 3; i++) {
      const k = (this.time * 6 + i * 1.7) % 3;
      ctx.fillRect(x + 1 + i * 3, y + 4 + Math.floor(k), 1, 1);
    }
  }

  private drawSparkles(ctx: CanvasRenderingContext2D, cx: number, cy: number, seed: number): void {
    ctx.fillStyle = this.theme === "matrix" ? "#00ff41" : "#fde047";
    for (let i = 0; i < 3; i++) {
      const ph = this.time * 3 + i * 2.1 + seed;
      if (Math.sin(ph) < 0.2) continue;
      const x = Math.round(cx + Math.cos(i * 2.4 + seed) * 12);
      const y = Math.round(cy - 3 - ((i * 5 + seed) % 6));
      ctx.fillRect(x, y - 1, 1, 3);
      ctx.fillRect(x - 1, y, 3, 1);
    }
  }
}

/** The theme accent, softened for rugs, cushions and the divider. */
function decorAccent(theme: OfficeTheme): THREE.Color {
  return new THREE.Color(TAGS[theme].accent).lerp(new THREE.Color(0xe9e1d3), theme === "matrix" ? 0.2 : 0.38);
}

function blendLook(a: Look, b: Look, t: number): Look {
  const out = { ...b };
  const ca = new THREE.Color();
  const cb = new THREE.Color();
  for (const k of Object.keys(b) as (keyof Look)[]) {
    const va = a[k];
    const vb = b[k];
    if (typeof va !== "number" || typeof vb !== "number") continue;
    const isColor = ["sun", "fill", "sky", "ground", "glassTop", "glassBottom", "lamp", "beam"].includes(k);
    (out as Record<string, number>)[k] = isColor ? ca.set(va).lerp(cb.set(vb), t).getHex() : lerp(va, vb, t);
  }
  return out;
}
