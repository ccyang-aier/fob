export const FLUID_SIZE = 32;
export const FLUID_STRIDE = FLUID_SIZE + 2;
const N = FLUID_SIZE;
const S = FLUID_STRIDE;
const CELLS = S * S;

export type ProjectFluid = {
  time: number;
  phase: number;
  ink: Float32Array;
  inkNext: Float32Array;
  inkAdvected: Float32Array;
  u: Float32Array;
  v: Float32Array;
  uNext: Float32Array;
  vNext: Float32Array;
  pressure: Float32Array;
  divergence: Float32Array;
};

function boundary(field: Float32Array, axis: 0 | 1 | 2) {
  for (let i = 1; i <= N; i++) {
    field[i * S] = (axis === 1 ? -1 : 1) * field[1 + i * S];
    field[N + 1 + i * S] = (axis === 1 ? -1 : 1) * field[N + i * S];
    field[i] = (axis === 2 ? -1 : 1) * field[i + S];
    field[i + (N + 1) * S] = (axis === 2 ? -1 : 1) * field[i + N * S];
  }
  field[0] = .5 * (field[1] + field[S]);
  field[N + 1] = .5 * (field[N] + field[N + 1 + S]);
  field[(N + 1) * S] = .5 * (field[1 + (N + 1) * S] + field[N * S]);
  field[N + 1 + (N + 1) * S] = .5 * (field[N + (N + 1) * S] + field[N + 1 + N * S]);
}

function project(fluid: ProjectFluid) {
  const { u, v, pressure: p, divergence: d } = fluid;
  p.fill(0);
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    d[i] = -.5 * (u[i + 1] - u[i - 1] + v[i + S] - v[i - S]) / N;
  }
  boundary(d, 0);
  for (let iteration = 0; iteration < 12; iteration++) {
    for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
      const i = x + y * S;
      p[i] = (d[i] + p[i - 1] + p[i + 1] + p[i - S] + p[i + S]) * .25;
    }
    boundary(p, 0);
  }
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    u[i] -= .5 * N * (p[i + 1] - p[i - 1]);
    v[i] -= .5 * N * (p[i + S] - p[i - S]);
  }
  boundary(u, 1);
  boundary(v, 2);
}

function advectVelocity(target: Float32Array, source: Float32Array, u: Float32Array, v: Float32Array, dt: number, axis: 1 | 2) {
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    const px = Math.max(.5, Math.min(N + .5, x - u[i] * dt * N));
    const py = Math.max(.5, Math.min(N + .5, y - v[i] * dt * N));
    const left = Math.floor(px), top = Math.floor(py);
    const fx = px - left, fy = py - top;
    const a = left + top * S;
    target[i] = (source[a] * (1 - fx) + source[a + 1] * fx) * (1 - fy)
      + (source[a + S] * (1 - fx) + source[a + S + 1] * fx) * fy;
  }
  boundary(target, axis);
}

function inkBoundary(ink: Float32Array) {
  for (let i = 1; i <= N; i++) for (let c = 0; c < 4; c++) {
    ink[(i * S) * 4 + c] = ink[(1 + i * S) * 4 + c];
    ink[(N + 1 + i * S) * 4 + c] = ink[(N + i * S) * 4 + c];
    ink[i * 4 + c] = ink[(i + S) * 4 + c];
    ink[(i + (N + 1) * S) * 4 + c] = ink[(i + N * S) * 4 + c];
  }
  for (let c = 0; c < 4; c++) {
    ink[c] = .5 * (ink[4 + c] + ink[S * 4 + c]);
    ink[(N + 1) * 4 + c] = .5 * (ink[N * 4 + c] + ink[(N + 1 + S) * 4 + c]);
    ink[((N + 1) * S) * 4 + c] = .5 * (ink[(1 + (N + 1) * S) * 4 + c] + ink[(N * S) * 4 + c]);
    ink[(N + 1 + (N + 1) * S) * 4 + c] = .5 * (ink[(N + (N + 1) * S) * 4 + c] + ink[(N + 1 + N * S) * 4 + c]);
  }
}

export function createProjectFluid(seed: number): ProjectFluid {
  let randomState = seed;
  function random() {
    randomState = (randomState + 0x6d2b79f5) | 0;
    let value = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }
  const phase = random() * Math.PI * 2;
  const pools = Array.from({ length: 12 }, (_, index) => ({
    x: index < 4 ? (index % 2 ? .73 : .27) + (random() - .5) * .28 : .05 + random() * .9,
    y: index < 4 ? (index < 2 ? .27 : .73) + (random() - .5) * .28 : .05 + random() * .9,
    radius: index < 4 ? .23 + random() * .09 : .09 + random() * .13, pigment: index % 4,
  }));
  const ink = new Float32Array(CELLS * 4);
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const nx = (x - .5) / N, ny = (y - .5) / N;
    const weights = [.008, .008, .008, .008];
    for (const pool of pools) {
      const dx = nx - pool.x, dy = ny - pool.y;
      weights[pool.pigment] += Math.exp(-(dx * dx + dy * dy) / (pool.radius * pool.radius));
    }
    let total = 0;
    for (let c = 0; c < 4; c++) { weights[c] = weights[c] ** 3; total += weights[c]; }
    for (let c = 0; c < 4; c++) ink[(x + y * S) * 4 + c] = weights[c] / total;
  }
  inkBoundary(ink);
  const fluid: ProjectFluid = {
    time: random() * 40, phase, ink, inkNext: new Float32Array(CELLS * 4), inkAdvected: new Float32Array(CELLS * 4),
    u: new Float32Array(CELLS), v: new Float32Array(CELLS),
    uNext: new Float32Array(CELLS), vNext: new Float32Array(CELLS),
    pressure: new Float32Array(CELLS), divergence: new Float32Array(CELLS),
  };
  for (let i = 0; i < 24; i++) advanceProjectFluid(fluid, .15);
  return fluid;
}

/** Stateful incompressible transport: every frame moves the previous pigment field. */
export function advanceProjectFluid(fluid: ProjectFluid, dt: number) {
  fluid.time += dt;
  const { u, v, uNext, vNext, phase, time } = fluid;
  const currents = [
    { x: .35 + Math.sin(time * .17 + phase) * .21, y: .35 + Math.cos(time * .13 + phase) * .2, force: .64 + Math.sin(time * .23) * .2, falloff: 9 },
    { x: .65 + Math.cos(time * .11 + phase * 2) * .22, y: .64 + Math.sin(time * .19 + phase) * .19, force: -.6 + Math.cos(time * .21) * .18, falloff: 9 },
    { x: .5 + Math.sin(time * .21 + phase * 3) * .31, y: .5 + Math.cos(time * .16 + phase * 2) * .29, force: .9 * Math.sin(time * .12 + phase), falloff: 32 },
    { x: .5 + Math.cos(time * .19 + phase) * .27, y: .5 + Math.sin(time * .22 + phase * 3) * .3, force: -.85 * Math.cos(time * .15 + phase), falloff: 38 },
  ];
  const drag = Math.exp(-dt * .8);
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    const nx = (x - .5) / N, ny = (y - .5) / N;
    let fx = 0, fy = 0;
    for (const current of currents) {
      const dx = nx - current.x, dy = ny - current.y;
      const force = current.force * Math.exp(-(dx * dx + dy * dy) * current.falloff);
      fx -= dy * force;
      fy += dx * force;
    }
    u[i] = (u[i] + fx * dt) * drag;
    v[i] = (v[i] + fy * dt) * drag;
  }
  boundary(u, 1);
  boundary(v, 2);
  project(fluid);
  advectVelocity(uNext, u, u, v, dt, 1);
  advectVelocity(vNext, v, u, v, dt, 2);
  fluid.u = uNext; fluid.uNext = u;
  fluid.v = vNext; fluid.vNext = v;
  project(fluid);

  const { ink, inkNext, inkAdvected } = fluid;
  // Forward/reverse error correction preserves curling fronts instead of blurring
  // them into an average gradient. Local bounds keep all pigment fractions valid.
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    const px = Math.max(.5, Math.min(N + .5, x - fluid.u[i] * dt * N));
    const py = Math.max(.5, Math.min(N + .5, y - fluid.v[i] * dt * N));
    const left = Math.floor(px), top = Math.floor(py);
    const fx = px - left, fy = py - top;
    const a = (left + top * S) * 4;
    for (let c = 0; c < 4; c++) inkAdvected[i * 4 + c] =
      (ink[a + c] * (1 - fx) + ink[a + 4 + c] * fx) * (1 - fy)
      + (ink[a + S * 4 + c] * (1 - fx) + ink[a + S * 4 + 4 + c] * fx) * fy;
  }
  inkBoundary(inkAdvected);
  const diffusion = .0001 * dt * N * N;
  const feeds = Array.from({ length: 4 }, (_, index) => ({
    x: .5 + Math.sin(time * .07 + phase + index * 1.7) * .32,
    y: .5 + Math.cos(time * .09 + phase + index * 2.3) * .32,
    pigment: index,
  }));
  for (let y = 1; y <= N; y++) for (let x = 1; x <= N; x++) {
    const i = x + y * S;
    const px = Math.max(.5, Math.min(N + .5, x - fluid.u[i] * dt * N));
    const py = Math.max(.5, Math.min(N + .5, y - fluid.v[i] * dt * N));
    const left = Math.floor(px), top = Math.floor(py);
    const a = (left + top * S) * 4;
    const offset = i * 4;
    const rx = Math.max(.5, Math.min(N + .5, x + fluid.u[i] * dt * N));
    const ry = Math.max(.5, Math.min(N + .5, y + fluid.v[i] * dt * N));
    const reverseLeft = Math.floor(rx), reverseTop = Math.floor(ry);
    const rfx = rx - reverseLeft, rfy = ry - reverseTop;
    const b = (reverseLeft + reverseTop * S) * 4;
    let total = 0;
    for (let c = 0; c < 4; c++) {
      const reversed = (inkAdvected[b + c] * (1 - rfx) + inkAdvected[b + 4 + c] * rfx) * (1 - rfy)
        + (inkAdvected[b + S * 4 + c] * (1 - rfx) + inkAdvected[b + S * 4 + 4 + c] * rfx) * rfy;
      const minimum = Math.min(ink[a + c], ink[a + 4 + c], ink[a + S * 4 + c], ink[a + S * 4 + 4 + c]);
      const maximum = Math.max(ink[a + c], ink[a + 4 + c], ink[a + S * 4 + c], ink[a + S * 4 + 4 + c]);
      const value = Math.max(minimum, Math.min(maximum, inkAdvected[offset + c] + .5 * (ink[offset + c] - reversed)));
      const neighbors = (ink[(i - 1) * 4 + c] + ink[(i + 1) * 4 + c] + ink[(i - S) * 4 + c] + ink[(i + S) * 4 + c]) * .25;
      inkNext[offset + c] = value * (1 - diffusion) + neighbors * diffusion;
      total += inkNext[offset + c];
    }
    for (let c = 0; c < 4; c++) inkNext[offset + c] /= total;
    // Fresh pigment displaces the mixture, preserving color during long sessions.
    for (const feed of feeds) {
      const dx = (x - .5) / N - feed.x, dy = (y - .5) / N - feed.y;
      const amount = dt * .2 * Math.exp(-(dx * dx + dy * dy) * 26);
      for (let c = 0; c < 4; c++) inkNext[offset + c] *= 1 - amount;
      inkNext[offset + feed.pigment] += amount;
    }
  }
  inkBoundary(inkNext);
  fluid.ink = inkNext;
  fluid.inkNext = ink;
}
