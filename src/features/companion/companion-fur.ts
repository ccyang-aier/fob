/** User-supplied Feather renderer. Keep the strand distribution and drawing parameters intact. */
const BUCKETS = [
  { c: '#050505', w: 1.5, a: 1 },
  { c: '#0c0c0c', w: 1.15, a: 1 },
  { c: '#171717', w: .85, a: .95 },
  { c: '#2c2c2c', w: .55, a: .75 },
  { c: '#4a4a4a', w: .4, a: .5 },
  { c: '#262626', w: .7, a: .55 },
];

interface Strand { x: number; y: number; dx: number; dy: number; L: number; o: number; bend: number; phaseSin: number; phaseCos: number }

function makeFur(n: number, R: number) {
  const b: Strand[][] = BUCKETS.map(() => []);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, t = Math.pow(Math.random(), .5);
    const r0 = R * (.2 + .78 * t);
    let L = R * (.1 + .3 * t + Math.random() * .16);
    let bi = t < .45 ? 0 : t < .75 ? 1 : t < .92 ? 2 : 3;
    if (t > .94 && Math.random() < .4) { bi = 4; L *= 1.4; }
    if (t > .5 && t < .9 && Math.cos(a + 2.3) > .55 && Math.random() < .35) bi = 5;
    const dev = (Math.random() - .5) * .85, bend = (Math.random() - .5) * .55, phase = Math.random() * 6.28;
    b[bi].push({ x: Math.cos(a) * r0, y: Math.sin(a) * r0, dx: Math.cos(a + dev), dy: Math.sin(a + dev), L, o: t, bend, phaseSin: Math.sin(phase), phaseCos: Math.cos(phase) });
  }
  return b;
}

function drawFur(ctx: CanvasRenderingContext2D, b: Strand[][], cx: number, cy: number, R: number, fluff: number, t: number, wind: number, ws = 1) {
  const coreR = R * .8 * (1 + (fluff - 1) * .2);
  const g = ctx.createRadialGradient(cx - R * .3, cy - R * .35, R * .05, cx, cy, coreR);
  g.addColorStop(0, '#161616'); g.addColorStop(.6, '#080808'); g.addColorStop(1, '#030303');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, coreR, 0, Math.PI * 2); ctx.fill();
  ctx.lineCap = 'round';
  const timeSin = Math.sin(t * 1.7), timeCos = Math.cos(t * 1.7);
  for (let i = 0; i < b.length; i++) {
    const B = BUCKETS[i]; ctx.strokeStyle = B.c; ctx.globalAlpha = B.a; ctx.lineWidth = B.w * ws; ctx.beginPath();
    for (const s of b[i]) {
      const sw = (timeSin * s.phaseCos + timeCos * s.phaseSin) * .07 * wind * s.o;
      const push = 1 + (fluff - 1) * .25 * s.o;
      const x0 = cx + s.x * push, y0 = cy + s.y * push;
      const cos = Math.cos(sw), sin = Math.sin(sw), len = s.L * (1 + (fluff - 1) * (.6 + s.o));
      const dx = s.dx * cos - s.dy * sin, dy = s.dy * cos + s.dx * sin;
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + dx * len * .5 - dy * s.bend * len, y0 + dy * len * .5 + dx * s.bend * len, x0 + dx * len, y0 + dy * len);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function createCompanionFur(canvas: HTMLCanvasElement, reducedMotion = false) {
  const ctx = canvas.getContext('2d')!;
  const FS = 300;
  const mainFur = makeFur(4200, 62);
  let fluff = 1, fluffT = 1, wind = 1, lastDraw = -Infinity;
  function resize() {
    // Rasterize for the displayed sprite, including headroom for the burst scale.
    const size = Math.max(96, Math.ceil(canvas.getBoundingClientRect().width * Math.min(2, window.devicePixelRatio || 1) * 1.35));
    if (canvas.width === size && canvas.height === size) return;
    canvas.width = canvas.height = size;
    ctx.setTransform(size / FS, 0, 0, size / FS, 0, 0);
    lastDraw = -Infinity;
  }
  resize();
  const mini = document.createElement('canvas'); mini.width = mini.height = 128;
  const miniCtx = mini.getContext('2d')!; miniCtx.scale(2, 2);
  drawFur(miniCtx, makeFur(700, 15), 32, 32, 15, 1, 0, 0, .6);
  return {
    miniURL: mini.toDataURL(),
    resize,
    setReducedMotion(reduced: boolean) { reducedMotion = reduced; lastDraw = -Infinity; },
    setFur(o: number) { fluffT = 1 + (o / 30 - 1) * .6; if (o > 40) wind = 3.5; },
    ruffle() { wind = Math.min(3.5, wind + .12); },
    draw(now: number) {
      if (reducedMotion && Number.isFinite(lastDraw) && fluff === fluffT) return;
      if (now - lastDraw < 1000 / 30) return;
      const dt = Number.isFinite(lastDraw) ? Math.min(64, now - lastDraw) / (1000 / 60) : 1;
      lastDraw = now;
      fluff = reducedMotion ? fluffT : fluff + (fluffT - fluff) * (1 - Math.pow(.86, dt));
      wind += (1 - wind) * (1 - Math.pow(.97, dt));
      ctx.clearRect(0, 0, FS, FS);
      drawFur(ctx, mainFur, FS / 2, FS / 2, 62, fluff, now / 1000, reducedMotion ? 0 : wind);
    },
  };
}
