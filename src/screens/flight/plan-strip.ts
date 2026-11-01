import { launchFraction } from '../../world/program';
import { length } from '../../physics/vector';
import { STAGE_COLORS } from '../../render/rocket-sprite';
import type { RoutePlan, Stage } from '../../world/types';

export type BurnSpan = {
  start: number;
  end: number;
  stage: number;
  throttle: number;
  /** The tank ran dry before the next command. */
  fuelOut: boolean;
  /** Still burning at the edge of the view. */
  open: boolean;
};

/**
 * When the main craft's engine is commanded on, per stage. Plan bookkeeping only,
 * the same arithmetic as the preflight warnings (fuel use × throttle, ignition
 * limits, separation shuts the engine); it never integrates the flight.
 */
export function burnSpans(stage: Stage, plan: RoutePlan, until: number): BurnSpan[] {
  const config = stage.rocket;
  if (!config) return [];
  const parts = config.parts;
  const spans: BurnSpan[] = [];
  const fuel = parts.map((p) => p.fuelMass);
  let index = 0,
    throttle = Math.min(1, launchFraction(stage, plan)),
    clock = 0,
    from = 0;
  const ignitions = parts.map((_, i) => (i === 0 && throttle > 0 ? 1 : 0));
  const close = (end: number, fuelOut = false, open = false) => {
    if (end > from + 1e-9) spans.push({ start: from, end, stage: index, throttle, fuelOut, open });
  };
  const burn = (to: number) => {
    const p = parts[index];
    if (p && throttle > 0) {
      const rate = (p.thrust * throttle) / p.exhaustSpeed;
      const empty = clock + fuel[index] / rate;
      if (empty < to - 1e-9) {
        fuel[index] = 0;
        close(empty, true);
        throttle = 0;
      } else fuel[index] = Math.max(0, fuel[index] - (to - clock) * rate);
    }
    clock = to;
  };
  const commands = (plan.engineCommands ?? [])
    .filter((c) => c.actorId === 'craft' && !c.releasePayload)
    .sort((a, b) => a.time - b.time);
  for (const c of commands) {
    if (c.time > until) break;
    burn(c.time);
    if (c.separate) {
      if (throttle > 0) close(c.time);
      index++;
      throttle = 0;
    } else if (c.throttle !== undefined) {
      const p = parts[index];
      if (c.throttle <= 0) {
        if (throttle > 0) close(c.time);
        throttle = 0;
      } else if (throttle > 0) {
        if (Math.abs(c.throttle - throttle) > 1e-9) {
          close(c.time);
          throttle = c.throttle;
          from = c.time;
        }
      } else if (p && fuel[index] > 1e-8 && ignitions[index] < p.ignitionLimit) {
        ignitions[index]++;
        throttle = c.throttle;
        from = c.time;
      }
    }
  }
  burn(until);
  if (throttle > 0) close(until, false, true);
  return spans;
}

export const stageColor = (index: number) => STAGE_COLORS[index % STAGE_COLORS.length];

/** Approximate rendered width of chip text at 14px, for lane packing. */
export function textWidth(text: string) {
  let w = 0;
  for (const ch of text)
    w += /[가-힣]/.test(ch) ? 14 : /[0-9.%°+−-]/.test(ch) ? 8.6 : ch === ' ' ? 4 : 8;
  return w;
}

export type ChipText = { word: string; value: string; valueFirst?: boolean };

/** Short words for a timeline chip: what it does and its one number. */
export function chipText(
  stage: Stage,
  plan: RoutePlan,
  event: { id: string; kind: string; time: number; actorId: string },
  degrees: (v: { x: number; y: number }) => number,
): ChipText {
  if (event.id === 'launch') {
    const percent = Math.round(launchFraction(stage, plan) * 100);
    return stage.rocket
      ? { word: '발사', value: percent + '%' }
      : { word: '발사', value: (length(plan.launch) || 0).toFixed(2) };
  }
  const command = plan.engineCommands?.find((c) => c.id === event.id);
  const actorName =
    event.actorId && event.actorId !== 'craft' && event.kind !== 'deploy'
      ? ([...(stage.rocket?.parts ?? [])].find((p) => p.id === event.actorId)?.name ?? '')
          .split('·')[0]
          .trim()
      : '';
  const prefix = actorName ? actorName + ' ' : '';
  switch (event.kind) {
    case 'ignite': {
      const value = Math.round((command?.throttle ?? 1) * 100) + '%';
      const turn = command?.direction ? ' · ' + Math.round(degrees(command.direction)) + '°' : '';
      return { word: prefix + '출력', value: value + turn };
    }
    case 'stop':
      return { word: prefix + '끄기', value: '' };
    case 'turn':
      return {
        word: prefix + '회전',
        value: command?.direction ? Math.round(degrees(command.direction)) + '°' : '',
      };
    case 'separate': {
      const order = (plan.engineCommands ?? [])
        .filter((c) => c.actorId === 'craft' && c.separate)
        .sort((a, b) => a.time - b.time)
        .findIndex((c) => c.id === event.id);
      return { word: '분리', value: order >= 0 ? order + 1 + '단' : '', valueFirst: true };
    }
    case 'push': {
      const push = plan.impulses.find((c) => c.id === event.id);
      return { word: '추진', value: push ? length(push.vector).toFixed(2) : '' };
    }
    case 'deploy':
      return { word: '위성 분리', value: '' };
    default:
      return { word: '', value: '' };
  }
}
