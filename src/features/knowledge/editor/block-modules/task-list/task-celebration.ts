const COLORS = ['#4489ef', '#9d78e8', '#f5b94c', '#ed789a', '#58bea2', '#f18b54'];

/** Local presentation only: never enters the editable DOM or document transactions. */
export function createTaskCelebration(document: Document) {
  const bursts = new Set<() => void>();
  return {
    burst(x: number, y: number) {
      const layer = document.createElement('div');
      layer.dataset.taskCelebration = '';
      layer.setAttribute('aria-hidden', 'true');
      Object.assign(layer.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, width: '0', height: '0', zIndex: '110', pointerEvents: 'none' });
      document.body.append(layer);
      const animations: Animation[] = [];
      const cleanup = () => {
        bursts.delete(cleanup);
        layer.remove();
        for (const animation of animations) animation.cancel();
      };
      bursts.add(cleanup);
      for (let index = 0; index < 40; index++) {
        const particle = document.createElement('span');
        const angle = -Math.PI + .18 + (index / 39) * (Math.PI - .36);
        const distance = 55 + Math.random() * 85;
        const dx = Math.cos(angle) * distance;
        const dy = Math.sin(angle) * distance - 20;
        const rotation = Math.random() * 180;
        const star = index % 7 === 0;
        Object.assign(particle.style, {
          position: 'absolute', left: '-3px', top: '-3px', width: star ? '9px' : '5px', height: star ? '9px' : index % 3 === 0 ? '5px' : '9px',
          background: COLORS[index % COLORS.length], borderRadius: index % 3 === 0 ? '50%' : '1px',
          clipPath: star ? 'polygon(50% 0%,61% 35%,98% 35%,68% 57%,79% 94%,50% 72%,21% 94%,32% 57%,2% 35%,39% 35%)' : '',
        });
        layer.append(particle);
        animations.push(particle.animate([
          { opacity: 0, transform: `translate(0,0) rotate(${rotation}deg) scale(.3)` },
          { offset: .12, opacity: 1, transform: `translate(${dx * .22}px,${dy * .32}px) rotate(${rotation + 50}deg) scale(1)` },
          { offset: .48, opacity: 1, transform: `translate(${dx}px,${dy}px) rotate(${rotation + 180}deg) scale(1)` },
          { opacity: 0, transform: `translate(${dx * 1.25}px,${dy + 95}px) rotate(${rotation + 420}deg) scale(.6)` },
        ], { duration: 850 + Math.random() * 350, easing: 'cubic-bezier(.18,.65,.4,1)', fill: 'both' }));
      }
      void Promise.allSettled(animations.map(animation => animation.finished)).then(cleanup);
    },
    destroy() { for (const cleanup of bursts) cleanup(); },
  };
}
