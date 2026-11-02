/** "Nice" y-axis ticks: 0 up to a round ceiling, in steps of 1/2/5 × 10^k, aiming for about `target` gridlines. */
export function niceTicks(max: number, target = 4): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const rough = max / target;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? pow * 10;
  const ticks: number[] = [];
  for (let v = 0; ; v += step) {
    ticks.push(Math.round(v * 1e9) / 1e9);
    if (v >= max) break;
  }
  return ticks;
}
