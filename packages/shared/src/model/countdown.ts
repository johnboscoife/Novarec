/** Countdown before recording begins (e.g. 3 → [3, 2, 1] → go). */
export function countdownSequence(seconds: number): number[] {
  const total = Math.max(0, Math.floor(seconds));
  return Array.from({ length: total }, (_, i) => total - i);
}
