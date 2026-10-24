import { createTranslator } from '@/lib/i18n/messages';
import styles from './companion-character.module.css';
import { createCompanionFur } from './companion-fur';
import { createCompanionClickSequence } from './companion-click-sequence';
import { messages, type CompanionAction } from './companion.messages';

export interface CompanionState { label: string; mood: number; full: number; busy: boolean; speech: string | null }
export const initialCompanionState: CompanionState = { label: 'REST', mood: 60, full: 40, busy: false, speech: null };

/** Scoped animation controller: React owns the shell; this controller owns only the character DOM. */
export function createCompanionRuntime(root: HTMLElement, onChange: (state: CompanionState) => void) {
  const get = <T extends HTMLElement>(selector: string) => root.querySelector<T>(`.${styles[selector.slice(1)]}`)!;
  const hop = get('.hop'), squash = get('.squash'), tilt = get('.tilt'), breath = get('.breath');
  const face = get('.face'), shadow = get('.shadow'), stage = get('.stage');
  const eyes = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.eye}`));
  const pupils = Array.from(root.querySelectorAll<HTMLElement>(`.${styles.pupil}`));
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fur = createCompanionFur(get<HTMLCanvasElement>('.body-svg'), motionPreference.matches);
  const text = createTranslator(messages);
  const events = new AbortController();
  const cancelled = Symbol('disposed companion');
  const timers = new Map<ReturnType<typeof setTimeout>, (() => void) | undefined>();
  const particles = new Set<HTMLElement>();
  let disposed = false, frame = 0;
  let state = { ...initialCompanionState };
  let lastMove = Date.now(), sleeping = false, manualSleep = false, lookOverride: { x: number; y: number } | null = null;
  const mouse = { x: innerWidth / 2, y: innerHeight / 2 }, cur = { x: 0, y: 0 };
  const clicks = createCompanionClickSequence();
  let pendingBurst = false, petAcc = 0, lastPet = 0;
  let previousFrame = 0, nearPointer: boolean | null = null, measureNeeded = true;
  const anchor = root.closest<HTMLElement>('[data-companion-drag]') ?? root;
  const widget = root.closest<HTMLElement>('[data-companion]') ?? anchor;
  const anchorCenter = { x: 0, y: 0 };
  root.dataset.tracking = 'true';
  const invalidatePosition = () => { measureNeeded = true; };
  const positionObserver = new MutationObserver(invalidatePosition);
  positionObserver.observe(widget, { attributes: true, attributeFilter: ['style', 'data-open'] });
  window.addEventListener('resize', () => { invalidatePosition(); fur.resize(); }, { signal: events.signal });
  motionPreference.addEventListener('change', event => fur.setReducedMotion(event.matches), { signal: events.signal });

  function later(fn: () => void, ms: number) {
    const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
    timers.set(id, undefined);
    return id;
  }
  function cancelTimer(id: ReturnType<typeof setTimeout> | undefined) {
    if (id !== undefined) { clearTimeout(id); timers.delete(id); }
  }
  function sleep(ms: number) {
    return new Promise<void>((resolve, reject) => {
      if (disposed) { reject(cancelled); return; }
      const id = later(resolve, ms);
      timers.set(id, () => reject(cancelled));
    });
  }
  function update(next: Partial<CompanionState>) {
    if (disposed) return;
    if (next.busy !== undefined && next.busy !== state.busy) nearPointer = null;
    state = { ...state, ...next };
    root.dataset.tracking = String(!state.busy && !sleeping);
    onChange(state);
  }
  const setLabel = (label: string) => update({ label });
  const eyeClasses = ['closed', 'm-down', 'm-up', 'drowsy', 'wide'].map(name => styles[name]);
  function setEyes(cls = '', which = [0, 1]) {
    which.forEach(i => { eyes[i].classList.remove(...eyeClasses); if (cls) eyes[i].classList.add(...cls.split(' ').map(name => styles[name])); });
  }
  const clearEyes = () => setEyes();
  let bubbleTimer: ReturnType<typeof setTimeout> | undefined;
  function say(key: keyof typeof messages, ms = 1800) {
    update({ speech: text(key) }); cancelTimer(bubbleTimer);
    bubbleTimer = later(() => update({ speech: null }), ms);
  }
  const addMood = (d: number) => update({ mood: Math.max(0, Math.min(100, state.mood + d)) });
  const addFull = (d: number) => update({ full: Math.max(0, Math.min(100, state.full + d)) });
  function center() {
    if (measureNeeded) {
      const r = anchor.getBoundingClientRect();
      anchorCenter.x = r.left + r.width / 2; anchorCenter.y = r.top + r.height / 2;
      measureNeeded = false;
    }
    return anchorCenter;
  }
  function render(now: number) {
    const c = center(), dx = mouse.x - c.x, dy = mouse.y - c.y, distance = Math.hypot(dx, dy), d = distance || 1;
    let tx: number, ty: number;
    if (lookOverride) { tx = lookOverride.x; ty = lookOverride.y; }
    else {
      const k = Math.min(1, d / 260); tx = dx / d * k; ty = dy / d * k;
    }
    const dt = previousFrame ? Math.min(64, now - previousFrame) : 1000 / 60;
    previousFrame = now;
    const follow = motionPreference.matches ? 1 : 1 - Math.pow(.82, dt / (1000 / 60));
    if (Math.abs(tx - cur.x) + Math.abs(ty - cur.y) > .001) {
      cur.x += (tx - cur.x) * follow; cur.y += (ty - cur.y) * follow;
      pupils.forEach(p => { p.style.transform = `translate(${cur.x * 10}px,${cur.y * 10}px)`; });
      face.style.transform = `translate(calc(-50% + ${cur.x * 6}px), calc(-50% + ${cur.y * 5}px))`;
      if (!state.busy && !sleeping) tilt.style.transform = `rotate(${cur.x * 4}deg)`;
    }
    if (!state.busy && !sleeping) {
      const near = distance < 140 && distance > 80;
      if (near !== nearPointer) { nearPointer = near; eyes.forEach(el => el.classList.toggle(styles.wide, near)); }
    }
    fur.draw(now);
    frame = requestAnimationFrame(render);
  }
  function visibility() {
    cancelAnimationFrame(frame);
    previousFrame = 0; invalidatePosition();
    if (!document.hidden && !disposed) frame = requestAnimationFrame(render);
  }
  document.addEventListener('visibilitychange', visibility, { signal: events.signal });
  visibility();

  function removeParticle(node: HTMLElement) { node.getAnimations().forEach(a => a.cancel()); node.remove(); particles.delete(node); }
  function particle(className: string) { const node = document.createElement('div'); node.className = styles[className]; node.setAttribute('aria-hidden', 'true'); stage.appendChild(node); particles.add(node); return node; }
  function spawnMinis(n: number) {
    for (let i = 0; i < n; i++) {
      const m = particle('mini');
      m.innerHTML = `<img alt="" src="${fur.miniURL}" style="position:absolute;left:-19px;top:-19px;width:64px;height:64px;max-width:none"><svg viewBox="-20 -20 40 40" width="26" height="26" style="position:absolute;overflow:visible"><circle cx="-3.5" cy="-1" r="2.6" fill="#fff"/><circle cx="3.5" cy="-1" r="2.6" fill="#fff"/><circle cx="-3" cy="-.6" r="1.1" fill="#000"/><circle cx="4" cy="-.6" r="1.1" fill="#000"/></svg>`;
      const a = -Math.PI / 2 + (Math.random() - .5) * Math.PI * 1.4, dist = 90 + Math.random() * 60, s = .6 + Math.random() * .6;
      m.style.left = '97px'; m.style.top = '110px';
      m.animate([
        { transform: 'translate(0,0) scale(.2)', opacity: 0 },
        { transform: `translate(${Math.cos(a) * dist * .7}px,${Math.sin(a) * dist * .7}px) scale(${s})`, opacity: 1, offset: .35 },
        { transform: `translate(${Math.cos(a) * dist}px,${Math.sin(a) * dist + 60}px) scale(${s * .8}) rotate(${(Math.random() - .5) * 180}deg)`, opacity: 0 },
      ], { duration: 1400 + Math.random() * 500, easing: 'cubic-bezier(.2,.8,.3,1)' }).onfinish = () => removeParticle(m);
    }
  }
  function hearts(n: number) {
    for (let i = 0; i < n; i++) later(() => {
      const h = particle('heart'); h.textContent = '♥';
      h.style.left = (90 + Math.random() * 40) + 'px'; h.style.top = '60px'; h.style.setProperty('--dx', (Math.random() - .5) * 60 + 'px');
      later(() => removeParticle(h), 1500);
    }, i * 180);
  }

  const A = {
    async lookLeft() { setLabel('LOOK LEFT'); lookOverride = { x: -1, y: -.1 }; tilt.style.transform = 'rotate(-5deg)'; await sleep(1300); lookOverride = null; },
    async lookRight() { setLabel('LOOK RIGHT'); lookOverride = { x: 1, y: -.1 }; tilt.style.transform = 'rotate(5deg)'; await sleep(1300); lookOverride = null; },
    async blink() { setLabel('BLINK'); setEyes('m-down'); await sleep(700); clearEyes(); },
    async wink() { setLabel('WINK'); setEyes('m-up', [1]); tilt.style.transform = 'rotate(-6deg)'; say('嘿~', 1200); await sleep(900); clearEyes(); },
    async happy() {
      setLabel('HAPPY'); setEyes('m-up'); breath.classList.add(styles.shy);
      for (let i = 0; i < 2; i++) { squash.style.transform = 'scale(1.06,.92)'; await sleep(160); squash.style.transform = 'scale(.96,1.05)'; await sleep(160); }
      squash.style.transform = ''; hearts(3); await sleep(700); clearEyes(); breath.classList.remove(styles.shy);
    },
    async drowsy() {
      setLabel('DROWSY'); setEyes('drowsy'); lookOverride = { x: 0, y: .4 }; tilt.classList.add(styles.nodding);
      await sleep(2600); tilt.classList.remove(styles.nodding); clearEyes(); lookOverride = null;
    },
    async surprised() { setLabel('SURPRISED'); setEyes('wide'); lookOverride = { x: 0, y: 0 }; await sleep(1600); clearEyes(); lookOverride = null; },
    async shy() { setLabel('SHY'); setEyes('m-up'); breath.classList.add(styles.shy); tilt.style.transform = 'rotate(-7deg)'; await sleep(1800); clearEyes(); breath.classList.remove(styles.shy); },
    dizzy,
    async curious() { setLabel('CURIOUS TILT'); tilt.style.transform = 'rotate(-16deg)'; lookOverride = { x: .5, y: -.6 }; setEyes('wide'); say('嗯？', 1300); await sleep(1500); clearEyes(); lookOverride = null; },
    async hopAct(n = 2) {
      setLabel('HOP');
      for (let i = 0; i < n; i++) {
        squash.style.transform = 'scale(1.12,.86)'; await sleep(160);
        squash.style.transform = 'scale(.92,1.1)'; hop.style.transform = 'translateY(-46px)'; shadow.style.transform = 'scale(.6)'; shadow.style.opacity = '.5'; await sleep(300);
        hop.style.transform = ''; squash.style.transform = 'scale(.96,1.04)'; await sleep(220);
        squash.style.transform = 'scale(1.1,.9)'; shadow.style.transform = ''; shadow.style.opacity = '1'; await sleep(130); squash.style.transform = '';
        await sleep(120);
      }
    },
    async poof() {
      setLabel('ANTICIPATE'); setEyes('m-down'); squash.style.transform = 'scale(1.12,.82)'; fur.setFur(18); await sleep(420);
      setLabel('BURST'); clearEyes(); setEyes('wide'); breath.classList.add(styles.bursting);
      squash.style.transform = 'scale(1.22,1.22)'; fur.setFur(52); spawnMinis(7); await sleep(480);
      breath.classList.remove(styles.bursting);
      setLabel('POOF HOLD'); squash.style.transform = 'scale(1.16,1.16)'; await sleep(650);
      setLabel('SETTLE'); clearEyes(); squash.style.transform = 'scale(.95,1.04)'; fur.setFur(30); await sleep(240);
      squash.style.transform = ''; await sleep(300);
    },
  };

  async function dizzy() {
    setLabel('DIZZY'); say('晕了晕了…', 1600);
    root.classList.add(styles.dizzy);
    try {
      for (let i = 0; i < 12; i++) { lookOverride = { x: Math.cos(i * 1.2), y: Math.sin(i * 1.2) }; tilt.style.transform = `rotate(${Math.sin(i) * 12}deg)`; await sleep(130); }
      addMood(-5);
    } finally { root.classList.remove(styles.dizzy); lookOverride = null; }
  }
  async function run(fn: () => Promise<void>) {
    if (state.busy || disposed) return;
    update({ busy: true }); eyes.forEach(e => e.classList.remove(styles.wide));
    try { await fn(); }
    catch (error) { if (error !== cancelled) throw error; }
    finally {
      if (!disposed) {
        tilt.style.transform = ''; update({ busy: false, label: sleeping ? 'SLEEP' : 'REST' });
        if (pendingBurst) { pendingBurst = false; void run(tapBurst); }
      }
    }
  }
  function goSleep(manual = false) {
    sleeping = true; manualSleep = manual; lookOverride = { x: 0, y: .1 };
    cancelTimer(bubbleTimer); update({ label: 'SLEEP', speech: null }); setEyes('m-down');
    breath.classList.add(styles.sleeping); breath.style.animationDuration = '5.5s'; tilt.style.transform = 'rotate(-4deg)';
  }
  function clearSleep() { sleeping = false; manualSleep = false; lookOverride = null; breath.classList.remove(styles.sleeping); breath.style.animationDuration = ''; clearEyes(); }
  function wake() {
    clicks.reset();
    lastMove = Date.now();
    if (!sleeping) return;
    clearSleep();
    void run(async () => { setEyes('drowsy'); await sleep(500); clearEyes(); setEyes('wide'); say('啊！我没睡！', 1500); await A.hopAct(1); });
  }
  window.addEventListener('pointermove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY; lastMove = Date.now();
    if (sleeping && !manualSleep) wake();
  }, { signal: events.signal, passive: true });
  hop.addEventListener('pointermove', e => {
    if (sleeping) return;
    if (root.closest('[data-dragging="true"]')) return;
    const now = Date.now(); if (now - lastPet < 16) return; lastPet = now;
    petAcc += Math.abs(e.movementX) + Math.abs(e.movementY); fur.ruffle();
    if (!state.busy) { setEyes('m-up'); breath.classList.add(styles.shy); }
    if (petAcc > 900) { petAcc = 0; hearts(2); addMood(3); const lines = ['好舒服~', '嘿嘿嘿', '再摸摸'] as const; say(lines[Math.floor(Math.random() * 3)], 1200); }
  }, { signal: events.signal, passive: true });
  hop.addEventListener('pointerleave', () => { petAcc = 0; if (!state.busy && !sleeping) { clearEyes(); breath.classList.remove(styles.shy); } }, { signal: events.signal });

  async function feed() {
    clearSleep(); lastMove = Date.now();
    await run(async () => {
      setLabel('CANDY!');
      const colors = ['#ffb3c7', '#ffe29a', '#b5f0d0', '#b9d4ff', '#e2c6ff'];
      const c = particle('candy'), col = colors[Math.floor(Math.random() * colors.length)];
      c.innerHTML = `<svg viewBox="-10 -10 20 20" width="18" height="18"><path d="M0-9 2.4-3.2 8.6-2.8 3.8 1.2 5.4 7.4 0 4 -5.4 7.4 -3.8 1.2 -8.6-2.8 -2.4-3.2Z" fill="${col}" stroke="#fff" stroke-width="1" stroke-linejoin="round"/></svg>`;
      const sx = 40 + Math.random() * 140; c.style.left = sx + 'px'; c.style.top = '-160px';
      setEyes('wide'); say('哇！', 900);
      c.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translate(${101 - sx}px,260px) rotate(540deg)` }], { duration: 1100, easing: 'cubic-bezier(.5,0,.8,.6)', fill: 'forwards' });
      const t0 = performance.now();
      const follow = () => {
        if (disposed || !c.isConnected) return;
        const r = c.getBoundingClientRect(), cc = center(), dx = r.left - cc.x, dy = r.top - cc.y, d = Math.hypot(dx, dy) || 1;
        lookOverride = { x: dx / d, y: dy / d };
        if (performance.now() - t0 < 900) later(follow, 16);
      };
      follow(); await sleep(700);
      squash.style.transform = 'scale(.92,1.1)'; hop.style.transform = 'translateY(-30px)'; await sleep(260);
      removeParticle(c); clearEyes(); setEyes('m-up'); hop.style.transform = ''; squash.style.transform = 'scale(1.1,.9)'; await sleep(200);
      for (let i = 0; i < 3; i++) { squash.style.transform = 'scale(1.04,.96)'; await sleep(130); squash.style.transform = 'scale(.98,1.02)'; await sleep(130); }
      squash.style.transform = ''; lookOverride = null; breath.classList.add(styles.shy); hearts(4); say(state.full > 85 ? '吃不下啦…' : '好甜！✦', 1500);
      addFull(state.full > 85 ? 0 : 15); addMood(8); await sleep(900); breath.classList.remove(styles.shy); clearEyes();
    });
  }
  async function tapBurst() {
    await A.poof();
    const lines = ['噗！', '别戳我啦~', '再来一次？', '咕噜咕噜', '我是煤球，不是芝麻球', '嘿嘿', '软乎乎的吧'] as const;
    say(lines[Math.floor(Math.random() * lines.length)]); addMood(4);
  }
  function interact() {
    lastMove = Date.now();
    if (sleeping) { wake(); return; }
    if (!clicks.register(lastMove)) return;
    if (state.busy) pendingBurst = true;
    else void run(tapBurst);
  }
  function act(action: CompanionAction) {
    if (state.busy) return;
    clicks.reset();
    lastMove = Date.now();
    if (action === 'sleep') { goSleep(true); return; }
    clearSleep(); void run(A[action]);
  }

  async function blinkOnce() {
    if (state.busy || sleeping || document.hidden) return;
    eyes.forEach(e => e.classList.add(styles.closed)); await sleep(110); eyes.forEach(e => e.classList.remove(styles.closed));
  }
  async function blinkLoop() {
    while (!disposed) { await sleep(2500 + Math.random() * 3500); await blinkOnce(); if (Math.random() < .25) { await sleep(160); await blinkOnce(); } }
  }
  async function idleLoop() {
    const pool = ['lookLeft', 'lookRight', 'blink', 'wink', 'drowsy', 'curious', 'hopAct', 'happy'] as const;
    while (!disposed) {
      await sleep(2600 + Math.random() * 2600);
      if (state.busy || sleeping || document.hidden) continue;
      const idle = Date.now() - lastMove;
      if (idle > 25000) goSleep();
      else if (idle > 2500) await run(A[pool[Math.floor(Math.random() * pool.length)]]);
    }
  }
  async function hungerLoop() {
    while (!disposed) { await sleep(6000); if (document.hidden) continue; addFull(-1); if (state.full < 15 && !state.busy && !sleeping) say('肚子饿了…', 1500); }
  }
  const finishLoop = (error: unknown) => { if (error !== cancelled) throw error; };
  void blinkLoop().catch(finishLoop); void idleLoop().catch(finishLoop); void hungerLoop().catch(finishLoop);
  later(() => { if (!sleeping) say('你好呀，我是 Feather', 2200); }, 600);

  return {
    act, feed, interact, wake,
    dispose() {
      disposed = true; events.abort(); positionObserver.disconnect(); cancelAnimationFrame(frame);
      for (const [id, reject] of timers) { clearTimeout(id); reject?.(); } timers.clear();
      for (const node of particles) removeParticle(node);
    },
  };
}
export type CompanionRuntime = ReturnType<typeof createCompanionRuntime>;
