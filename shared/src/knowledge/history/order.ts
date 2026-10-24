/** Unique block IDs reduce sibling LCS to a strictly increasing subsequence. O(n log n). */
export function stableSiblingIds(items: readonly { id: string; index: number }[]): Set<string> {
  const tails: number[] = [];
  const previous = new Int32Array(items.length).fill(-1);
  for (let index = 0; index < items.length; index++) {
    let low = 0, high = tails.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (items[tails[middle]].index < items[index].index) low = middle + 1;
      else high = middle;
    }
    if (low) previous[index] = tails[low - 1];
    tails[low] = index;
  }
  const result = new Set<string>();
  for (let index = tails.at(-1) ?? -1; index >= 0; index = previous[index]) result.add(items[index].id);
  return result;
}
