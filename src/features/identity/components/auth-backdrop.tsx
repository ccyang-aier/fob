'use client';

import { useEffect, useRef } from 'react';
import styles from './auth-backdrop.module.css';

type RibbonSample = { x: number; y: number; nx: number; ny: number; spread: number; fold: number };

/** A small ribbon mesh, shaded across its folds instead of a field of blurred blobs. */
function drawRibbon(context: CanvasRenderingContext2D, width: number, height: number, time: number, layer: number, pointerX: number, pointerY: number) {
  const samples: RibbonSample[] = [];
  const phase = time * 0.13 + layer * 1.7;
  const point = (t: number) => {
    const wave = Math.sin(t * Math.PI * 2 - 1.1 + layer * 0.7);
    return {
      x: width * (-0.28 + t * 1.60 + 0.08 * Math.sin(t * Math.PI * 2 + phase)) + pointerX * 9,
      y: height * ((layer === 0 ? 0.20 : 0.36) + wave * (layer === 0 ? 0.13 : 0.21) + 0.045 * Math.sin(phase + t * 3)) + pointerY * 7,
    };
  };

  for (let index = 0; index <= 72; index++) {
    const t = index / 72;
    const center = point(t);
    const next = point(t + 0.001);
    const dx = next.x - center.x;
    const dy = next.y - center.y;
    const length = Math.hypot(dx, dy);
    samples.push({
      ...center,
      nx: -dy / length,
      ny: dx / length,
      spread: width * (layer === 0 ? 0.15 : 0.23) * (0.70 + 0.23 * Math.sin(t * 5 + phase)),
      fold: height * 0.065 * Math.sin(t * 5 - phase),
    });
  }

  const trace = (sample: RibbonSample, offset: number) => ({
    x: sample.x + sample.nx * sample.spread * offset,
    y: sample.y + sample.ny * sample.spread * offset + sample.fold * offset * offset,
  });

  context.globalAlpha = layer === 0 ? 0.58 : 0.92;
  for (let band = 0; band < 48; band++) {
    const start = band / 24 - 1;
    const end = (band + 1) / 24 - 1;
    const foldLight = Math.pow(Math.sin((band / 48) * Math.PI), 0.65);
    const gray = Math.round(171 + 78 * foldLight);
    const shade = context.createLinearGradient(0, 0, width, height * 0.4);
    shade.addColorStop(0, `rgb(${gray + 2} ${gray + 3} ${gray + 6})`);
    shade.addColorStop(0.32, `rgb(${Math.min(gray + 13, 255)} ${Math.min(gray + 14, 255)} ${Math.min(gray + 17, 255)})`);
    shade.addColorStop(0.68, `rgb(${gray - 7} ${gray - 5} ${gray})`);
    shade.addColorStop(1, `rgb(${gray + 2} ${gray + 3} ${gray + 6})`);
    context.beginPath();
    samples.forEach((sample, index) => {
      const p = trace(sample, start);
      if (index === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    for (let index = samples.length - 1; index >= 0; index--) {
      const p = trace(samples[index], end);
      context.lineTo(p.x, p.y);
    }
    context.closePath();
    context.fillStyle = shade;
    context.fill();
  }

  // Sparse hairline highlights reveal the flowing geometry without a busy grid.
  context.lineWidth = 0.7;
  for (let line = 0; line <= 12; line++) {
    const offset = line / 6 - 1;
    context.beginPath();
    samples.forEach((sample, index) => {
      const p = trace(sample, offset);
      if (index === 0) context.moveTo(p.x, p.y);
      else context.lineTo(p.x, p.y);
    });
    context.strokeStyle = line % 3 === 0 ? 'rgb(255 255 255 / .62)' : 'rgb(116 122 136 / .14)';
    context.stroke();
  }
  context.globalAlpha = 1;
}

/** Decorative local canvas. Animation never enters React's render cycle. */
export function AuthBackdrop({ desktopOnly = true }: { desktopOnly?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !context) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const desktopPane = window.matchMedia('(min-width: 681px)');
    const container = canvas.parentElement;
    let width = 0;
    let height = 0;
    let visible = true;
    let frame = 0;
    let lastDraw = 0;
    let elapsed = 0;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;

    const draw = () => {
      context.fillStyle = '#eef0f3';
      context.fillRect(0, 0, width, height);
      drawRibbon(context, width, height, elapsed, 0, pointerX, pointerY);
      drawRibbon(context, width, height, elapsed, 1, pointerX, pointerY);
      const paper = context.createLinearGradient(0, height * 0.20, 0, height);
      paper.addColorStop(0, 'rgb(246 247 249 / 0)');
      paper.addColorStop(0.48, 'rgb(246 247 249 / .15)');
      paper.addColorStop(1, 'rgb(246 247 249 / .91)');
      context.fillStyle = paper;
      context.fillRect(0, 0, width, height);
    };

    const canDraw = () => visible && (!desktopOnly || desktopPane.matches) && !document.hidden && width > 0 && height > 0;
    const animate = (timestamp: number) => {
      frame = 0;
      if (!canDraw() || reducedMotion.matches) return;
      if (timestamp - lastDraw >= 1000 / 24) {
        elapsed += Math.min((timestamp - lastDraw) / 1000, 0.08);
        lastDraw = timestamp;
        pointerX += (targetX - pointerX) * 0.045;
        pointerY += (targetY - pointerY) * 0.045;
        draw();
      }
      frame = window.requestAnimationFrame(animate);
    };
    const resume = () => {
      window.cancelAnimationFrame(frame);
      frame = 0;
      if (!canDraw()) return;
      lastDraw = performance.now();
      draw();
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    };
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      if (width <= 0 || height <= 0) { resume(); return; }
      const scale = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      context.setTransform(scale, 0, 0, scale, 0, 0);
      resume();
    };
    const move = (event: PointerEvent) => {
      if (reducedMotion.matches || !canDraw()) return;
      const bounds = canvas.getBoundingClientRect();
      targetX = (event.clientX - bounds.left) / width - 0.5;
      targetY = (event.clientY - bounds.top) / height - 0.5;
    };
    const leave = () => { targetX = 0; targetY = 0; };

    const resizeObserver = new ResizeObserver(resize);
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      resume();
    });
    resizeObserver.observe(canvas);
    intersectionObserver.observe(canvas);
    document.addEventListener('visibilitychange', resume);
    reducedMotion.addEventListener('change', resume);
    desktopPane.addEventListener('change', resize);
    container?.addEventListener('pointermove', move, { passive: true });
    container?.addEventListener('pointerleave', leave);
    resize();

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', resume);
      reducedMotion.removeEventListener('change', resume);
      desktopPane.removeEventListener('change', resize);
      container?.removeEventListener('pointermove', move);
      container?.removeEventListener('pointerleave', leave);
    };
  }, [desktopOnly]);

  return <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />;
}
