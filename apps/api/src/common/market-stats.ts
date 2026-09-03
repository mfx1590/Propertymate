/**
 * The arithmetic every public market number goes through — region landing
 * pages (step 16), market snapshots and the valuation estimate (step 25).
 *
 * Extracted rather than reimplemented, for the reason `contactRevealed()` was:
 * two copies of "which price is public" would eventually drift, and this one
 * carries §13.5 — on a mediated resale the OWNER'S ask is confidential and the
 * agent's list price is what a buyer would pay. Any consumer that priced rows
 * its own way could leak the margin.
 */

/** §13.5: the price a buyer actually sees — list price first, ask as fallback. */
export function publicPriceGbp(row: { priceBaseGbp: unknown; listPriceGbp: unknown }): number {
  return Number(row.listPriceGbp ?? row.priceBaseGbp);
}

/**
 * Median, not mean, everywhere a "typical" figure is shown: one £3m villa in a
 * region of £150k flats would drag an average somewhere no actual listing sits.
 *
 * Returns the EXACT value — callers round where they present whole pounds.
 * The old in-function rounding produced a median £/m² that could land above
 * the 75th percentile (round-half-up on the midpoint of two floats), which
 * put a valuation estimate outside its own high band.
 */
export function median(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Nearest-rank percentile over a sorted array; p in (0, 1). */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

/** Positive, finite values only, ascending — what the functions above expect. */
export function cleanSorted(values: number[]): number[] {
  return values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
}

/** £/m² of the rows that can express one. */
export function perM2Values(
  rows: { areaM2: number | null; priceBaseGbp: unknown; listPriceGbp: unknown }[],
): number[] {
  return cleanSorted(
    rows
      .filter((r) => r.areaM2 && r.areaM2 > 0)
      .map((r) => publicPriceGbp(r) / (r.areaM2 as number)),
  );
}
