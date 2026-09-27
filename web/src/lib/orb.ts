/* Divings Field System — dot-lattice orbs, ported VERBATIM from the CCA-F guide's js/orb.js (DIV-49):
   lattice maths, the three state palettes, rotation speed, depth fade and reduced-motion behaviour are
   unchanged; only the module wrapper is new. In the spirit of Jakub Antalik's MIT "thinking orbs",
   reimplemented from scratch in vanilla 2D canvas. The orbs are the app's ENTIRE motion budget.
   Palette note: grey / blue / gold are intentionally NOT Field System tokens. */
export type OrbState = "ahead" | "current" | "done";

const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const DPR = Math.min((typeof devicePixelRatio === "number" && devicePixelRatio) || 1, 2);

const COLORS: Record<OrbState, { rgb: [number, number, number]; rings: number; perEq: number; rot: number; dense: number }> = {
  ahead: { rgb: [125, 135, 148], rings: 13, perEq: 30, rot: 0, dense: 1 },
  current: { rgb: [47, 111, 219], rings: 15, perEq: 34, rot: 0.22, dense: 1.05 },
  done: { rgb: [200, 144, 26], rings: 15, perEq: 36, rot: 0, dense: 1.15 },
};

type Pt = [number, number, number];
interface Orb {
  c: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  size: number;
  cfg: (typeof COLORS)[OrbState];
  pts: Pt[];
  a: number;
  drawn?: boolean;
}

function globe(rings: number, perEq: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < rings; i++) {
    const lat = -Math.PI / 2 + (Math.PI * (i + 0.5)) / rings; // avoid exact poles
    const y = Math.sin(lat), r = Math.cos(lat);
    const n = Math.max(6, Math.round(perEq * r));
    const off = (i % 2) * (Math.PI / n); // stagger alternate rings
    for (let j = 0; j < n; j++) {
      const t = off + (j / n) * Math.PI * 2;
      pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
    }
  }
  return pts;
}

function draw(o: Orb, t: number) {
  const { ctx, size, cfg } = o, R = (size * DPR) / 2, rad = R * 0.86;
  const ang = o.a + t * cfg.rot, ca = Math.cos(ang), sa = Math.sin(ang);
  const tilt = -0.35, ct = Math.cos(tilt), st = Math.sin(tilt);
  ctx.clearRect(0, 0, size * DPR, size * DPR);
  const [r, g, b] = cfg.rgb;
  for (const [x0, y0, z0] of o.pts) {
    // rotate around Y, then tilt around X
    const x = x0 * ca + z0 * sa, z = -x0 * sa + z0 * ca, y = y0;
    const y2 = y * ct - z * st, z2 = y * st + z * ct;
    const depth = (z2 + 1) / 2; // 0 back … 1 front
    const alpha = 0.14 + depth * 0.78; // back face fades further, front reads solid
    const dot = (0.5 + depth * 1.0) * (size / 56) * DPR * cfg.dense;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${r},${g},${b},${alpha})`;
    ctx.arc(R + x * rad, R + y2 * rad, dot, 0, Math.PI * 2);
    ctx.fill();
  }
}

/* Live orbs are pruned when their canvas leaves the DOM, so re-rendering never leaks animation work. */
let live: Orb[] = [];
let looping = false;

function loop(ts: number) {
  const t = ts / 1000;
  live = live.filter((o) => o.c.isConnected !== false);
  for (const o of live) if (o.cfg.rot || !o.drawn) { draw(o, t); o.drawn = true; }
  if (live.length) requestAnimationFrame(loop);
  else looping = false;
}

/** mount(canvas, state, size) — the row's text carries the state; the orb is decorative. */
export function mountOrb(canvas: HTMLCanvasElement, state: OrbState, size: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cfg = COLORS[state] ?? COLORS.ahead;
  canvas.width = size * DPR; canvas.height = size * DPR;
  canvas.style.width = size + "px"; canvas.style.height = size + "px";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-hidden", "true");
  const o: Orb = { c: canvas, ctx, size, cfg, pts: globe(cfg.rings, cfg.perEq), a: Math.random() * 6 };
  live = live.filter((x) => x.c !== canvas);
  if (reduced || !cfg.rot) { draw(o, 0); o.drawn = true; if (reduced) return; }
  live.push(o);
  if (!looping && typeof requestAnimationFrame === "function") { looping = true; requestAnimationFrame(loop); }
}
