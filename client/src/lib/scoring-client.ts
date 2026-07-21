// Client-side mirror of the tiny pure display helper from server/scoring.ts.
// Duplicated intentionally — the client bundle must not import server code.
export function confidenceToGauge(confidence: number): number {
  const clamped = Math.min(1, Math.max(-1, confidence));
  return Math.round(clamped * 100);
}
