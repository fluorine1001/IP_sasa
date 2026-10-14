const clamp = (n: number) => Math.max(0, Math.min(1, n));
/** Panel and spotlight share a start time, but not their travel duration. */
export function tutorialMotion(elapsed: number) {
  const expand = clamp((elapsed - 900) / 2000),
    settle = clamp((elapsed - 900) / 950);
  return { expand, ease: expand * expand * (3 - 2 * expand), settle: 1 - (1 - settle) ** 3 };
}
