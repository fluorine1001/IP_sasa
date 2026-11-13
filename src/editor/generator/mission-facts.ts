import type { Stage } from '../../world/types';
import type { Condition } from '../../world/conditions';
export function missionMetrics(stage: Stage) {
  const result = new Set<string>();
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const data = node as Record<string, unknown>;
    if (data.kind === 'metric') result.add(String(data.metric));
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  stage.goals.forEach((g) => visit(g.condition));
  return result;
}
export function missionFamily(stage: Stage) {
  const metrics = missionMetrics(stage);
  return metrics.has('landed')
    ? 'landing'
    : metrics.has('orbitTurns')
      ? 'orbit'
      : (metrics.has('energy') || metrics.has('propellantUsed')) && metrics.has('radialSpeed')
        ? 'escape'
        : 'observation';
}

/** Read authored tolerances, including after JSON import; no stored difficulty claim is trusted. */
export function missionTolerance(stage: Stage): number | undefined {
  const body = stage.bodies.find((b) => b.id === stage.launchBodyId);
  if (!body || body.mu <= 0) return;
  const family = missionFamily(stage),
    r = body.radius,
    clock = Math.sqrt(r ** 3 / body.mu);
  if (family === 'landing') {
    const speed = stage.rocket?.parts[0].maxLandingSpeed;
    if (speed !== undefined) return Math.max(0, 1 - speed / ((r / clock) * 0.65)) * 45;
  }
  if (family === 'orbit') {
    const outcome = stage.goals.find((g) => g.outcome?.kind === 'circular')?.outcome;
    if (outcome?.kind === 'circular')
      return Math.max(0, 1 - (outcome.max - outcome.min) / (r * 2.4)) * 45;
  }
  if (family === 'escape') {
    let cosine: number | undefined;
    const visit = (n: Condition) => {
      if (
        n.kind === 'compare' &&
        n.operator === 'gte' &&
        n.right?.kind === 'calculate' &&
        n.right.operation === 'multiply' &&
        n.right.args[0]?.kind === 'constant' &&
        n.right.args[1]?.kind === 'metric' &&
        n.right.args[1].metric === 'distance'
      )
        cosine = n.right.args[0].value;
      if ('children' in n) n.children.forEach(visit);
      if ('child' in n) visit(n.child);
      if ('when' in n) visit(n.when);
    };
    stage.goals.forEach((g) => visit(g.condition));
    if (cosine !== undefined && cosine >= -1 && cosine <= 1)
      return (1 - (Math.acos(cosine) * 180) / Math.PI / 50) * 40;
  }
}
