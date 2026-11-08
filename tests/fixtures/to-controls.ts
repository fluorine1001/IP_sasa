/* Test support: rewrite a plan's Δv burns (an older authoring form the engine still runs)
 * as the controls players have — 회전 (hold the burn's frame), 출력 on the burn's event,
 * 끄기 after the burn's length — measuring each length from a recorded run of the
 * original plan. Used to enter older witnesses through the real planning UI. */
import { execute } from '../../src/world/engine';
import type { RoutePlan, Stage } from '../../src/world/types';

export function toControls(stage: Stage, plan: RoutePlan): RoutePlan {
  if (!plan.engineCommands?.some((c) => c.burn)) return plan;
  const run = execute(stage, plan, true);
  const frames = run.frames ?? [];
  const spans = (actorId: string) => {
    const out: [number, number][] = [];
    let start: number | undefined;
    for (const f of frames) {
      const t =
        actorId === 'craft'
          ? f.rocket?.throttle
          : f.detached?.find((d) => d.id === actorId)?.throttle;
      const on = (t ?? 0) > 0;
      if (on && start === undefined) start = f.time;
      if (!on && start !== undefined) {
        out.push([start, f.time]);
        start = undefined;
      }
    }
    return out;
  };
  const engineCommands: NonNullable<RoutePlan['engineCommands']> = [];
  for (const c of plan.engineCommands) {
    if (!c.burn) {
      engineCommands.push(c);
      continue;
    }
    const end = run.firedAt?.[c.id];
    const span =
      end === undefined
        ? undefined
        : spans(c.actorId).reduce<[number, number] | undefined>(
            (b, s) => (Math.abs(s[1] - end) < Math.abs((b?.[1] ?? 1e9) - end) ? s : b),
            undefined,
          );
    // The length from the fuel the burn used (exact; frames bracket it), else the span.
    const fuelAt = (t: number) => {
      const f = [...frames].reverse().find((x) => x.time <= t + 1e-9) ?? frames[0];
      if (c.actorId === 'craft') return f?.rocket ? f.rocket.fuel[f.rocket.partIndex] : undefined;
      return f?.detached?.find((d) => d.id === c.actorId)?.fuel;
    };
    const partIndex =
      c.actorId === 'craft'
        ? ([...frames].reverse().find((x) => x.time <= (span?.[0] ?? 0))?.rocket?.partIndex ?? 0)
        : (stage.rocket?.parts.findIndex((p) => p.id === c.actorId) ?? 0);
    const part = stage.rocket?.parts[partIndex];
    const before = span ? fuelAt(span[0] - 0.06) : undefined,
      after = span ? fuelAt(span[1] + 0.06) : undefined;
    const byFuel =
      part && before !== undefined && after !== undefined && before > after
        ? ((before - after) * part.exhaustSpeed) / (part.thrust * (c.burn.throttle ?? 1))
        : undefined;
    const length = Math.max(
      0.001,
      Math.round((byFuel ?? (span ? span[1] - span[0] : 0.5)) * 1000) / 1000,
    );
    const { heading, throttle, at, ref, delay, atAngle, phaseTarget, altitude } = c.burn;
    const trig = { at, ref, delay, atAngle, phaseTarget, altitude };
    engineCommands.push({
      id: c.id + 'a',
      time: at ? c.time : Math.max(0, c.time - 1.5),
      actorId: c.actorId,
      heading,
      ...(at && ref ? { at: 'after' as const, ref, delay: 0 } : {}),
    });
    engineCommands.push({
      id: c.id + 'b',
      time: c.time,
      actorId: c.actorId,
      throttle: throttle ?? 1,
      ...trig,
    });
    engineCommands.push({
      id: c.id,
      time: c.time,
      actorId: c.actorId,
      throttle: 0,
      at: 'after',
      ref: c.id + 'b',
      delay: length,
    });
  }
  return { ...plan, engineCommands };
}
