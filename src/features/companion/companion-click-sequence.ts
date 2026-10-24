/** Single taps operate the toolbar; four consecutive taps request a burst. */
export function createCompanionClickSequence() {
  let count = 0, lastClick = -Infinity;
  return {
    register(now: number) {
      count = now - lastClick <= 1500 ? count + 1 : 1;
      lastClick = now;
      if (count < 4) return false;
      count = 0;
      return true;
    },
    reset() { count = 0; lastClick = -Infinity; },
  };
}
