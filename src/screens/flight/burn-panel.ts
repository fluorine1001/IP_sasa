import { launchCutoffTime, launchFraction } from '../../world/program';
import type { Heading } from '../../world/heading';
import type { RoutePlan, Stage } from '../../world/types';

/**
 * Plan bookkeeping for one Δv burn: which stage burns, how long, how much of its
 * tank, and how much Δv that stage still holds. Rocket equation only; no flight.
 */
export function burnEstimate(stage: Stage, plan: RoutePlan, id: string) {
  const config = stage.rocket;
  if (!config) return { stageDv: 0, html: '' };
  const parts = config.parts,
    fuel = parts.map((p) => p.fuelMass);
  const payload = config.payloadMass + (config.payloads ?? []).reduce((m, q) => m + q.mass, 0);
  const massFrom = (i: number) =>
    payload + parts.slice(i).reduce((m, q, j) => m + q.dryMass + fuel[i + j], 0);
  let index = 0,
    throttle = Math.min(1, launchFraction(stage, plan)),
    clock = 0;
  const separatedFuel: Record<string, number> = {};
  const spend = (to: number) => {
    const p = parts[index];
    if (p && throttle > 0)
      fuel[index] = Math.max(
        0,
        fuel[index] - ((to - clock) * p.thrust * throttle) / p.exhaustSpeed,
      );
    clock = Math.max(clock, to);
  };
  const cutoff = launchCutoffTime(stage, plan);
  const ordered = [
    ...(plan.engineCommands ?? []).filter((c) => !c.releasePayload),
    ...(Number.isFinite(cutoff)
      ? [{ id: 'launch-cutoff', time: cutoff, actorId: 'craft', throttle: 0 }]
      : []),
  ].sort((a, b) => a.time - b.time) as NonNullable<RoutePlan['engineCommands']>;
  for (const c of ordered) {
    if (c.actorId !== 'craft' && c.id !== id) continue;
    spend(c.time);
    if (c.id === id) break;
    if (c.separate) {
      separatedFuel[parts[index]?.id ?? ''] = fuel[index];
      index++;
      throttle = 0;
    } else if (c.burn) {
      const p = parts[index];
      if (!p) continue;
      const used = Math.min(
        fuel[index],
        massFrom(index) * (1 - Math.exp(-c.burn.dv / p.exhaustSpeed)),
      );
      fuel[index] -= used;
      clock = c.time + used / (p.thrust / p.exhaustSpeed);
      throttle = 0;
    } else if (c.throttle !== undefined) throttle = c.throttle;
  }
  const command = ordered.find((c) => c.id === id);
  const booster = command && command.actorId !== 'craft';
  const partIndex = booster ? parts.findIndex((p) => p.id === command.actorId) : index;
  const p = parts[partIndex];
  if (!p || !command?.burn) return { stageDv: 0, html: '' };
  const tank = booster ? (separatedFuel[p.id] ?? p.fuelMass) : fuel[partIndex];
  const mass = booster ? p.dryMass + tank : massFrom(partIndex);
  const stageDv = tank > 0 ? p.exhaustSpeed * Math.log(mass / (mass - tank)) : 0;
  const used = Math.min(tank, mass * (1 - Math.exp(-command.burn.dv / p.exhaustSpeed)));
  const seconds = used / (p.thrust / p.exhaustSpeed);
  const short = command.burn.dv > stageDv + 1e-9;
  return {
    stageDv,
    html:
      `<dl class="burn-figures"><div><dt>연소 시간</dt><dd>${seconds.toFixed(2)} 초</dd></div>` +
      `<div><dt>연료 사용</dt><dd>${tank > 0 ? Math.round((used / tank) * 100) : 0}%</dd></div>` +
      `<div class="${short ? 'short' : ''}"><dt>${booster ? '분리한 단' : `${partIndex + 1}단`} 남은 Δv</dt><dd>${stageDv.toFixed(2)} u/s</dd></div></dl>`,
  };
}

/** The burn direction drawn in the orbit's frame: surface below, motion to the right. */
export function frameDiagram(h: Heading) {
  const base = { prograde: 0, retrograde: 180, outward: 90, inward: -90 }[h.frame];
  // Along-track bases tilt toward outward (up); radial bases tilt toward prograde (right).
  const tilt = h.frame === 'retrograde' ? -h.angle : h.frame === 'outward' ? -h.angle : h.angle;
  const a = ((base + tilt) * Math.PI) / 180;
  const cx = 70,
    cy = 46,
    r = 30;
  const x = cx + Math.cos(a) * r,
    y = cy - Math.sin(a) * r;
  const head = (px: number, py: number, angle: number) => {
    const l = 7,
      w = 0.5;
    return `M${px - Math.cos(angle - w) * l} ${py + Math.sin(angle - w) * l}L${px} ${py}L${px - Math.cos(angle + w) * l} ${py + Math.sin(angle + w) * l}`;
  };
  return `<svg class="frame-diagram" viewBox="0 0 140 84" role="img" aria-label="궤도 기준 방향 그림"><path class="frame-ground" d="M6 82Q70 66 134 82"/><path class="frame-axis" d="M${cx} ${cy}h44${head(cx + 44, cy, 0)}"/><text class="frame-label" x="${cx + 46}" y="${cy + 14}">진행</text><path class="frame-axis dashed" d="M${cx} ${cy}v-38"/><text class="frame-label" x="${cx + 4}" y="12">바깥</text><path class="frame-burn" d="M${cx} ${cy}L${x.toFixed(1)} ${y.toFixed(1)}${head(x, y, a)}"/><circle class="frame-craft" cx="${cx}" cy="${cy}" r="3"/></svg>`;
}
