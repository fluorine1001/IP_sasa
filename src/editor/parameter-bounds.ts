import type { SearchParameter } from './solution-search';

/** Shared upper bounds for native parameterisation and its time relation. */
export function timeCeilings(parameters: SearchParameter[], after?: Record<string, string[]>) {
  if (after) {
    const limits = new Map(
      parameters
        .filter((p) => p.key.endsWith('.time'))
        .map((p) => [p.key, p.enabled ? p.max : p.value]),
    );
    for (const p of [...parameters].reverse())
      for (const parent of after[p.key] ?? [])
        limits.set(parent, Math.min(limits.get(parent) ?? Infinity, limits.get(p.key) ?? Infinity));
    return parameters.map((p) => limits.get(p.key) ?? p.max);
  }
  const upper: number[] = [];
  let later = Infinity;
  for (let i = parameters.length - 1; i >= 0; i--) {
    const p = parameters[i],
      timed = p.key.endsWith('.time');
    upper[i] = timed ? Math.min(p.max, later) : p.max;
    if (timed) later = Math.min(later, p.enabled ? p.max : p.value);
  }
  return upper;
}
