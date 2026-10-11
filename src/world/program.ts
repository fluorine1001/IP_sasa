import { length, scale } from '../physics/vector';

import type { Stage, RoutePlan } from './types';
export type ProgramEvent = {
  id: string;
  time: number;
  kind: 'ignite' | 'stop' | 'turn' | 'separate' | 'push' | 'sensor';
  label: string;
  actorId: string;
};
export function programEvents(plan: RoutePlan): ProgramEvent[] {
  return [
    { id: 'launch', time: 0, kind: 'ignite' as const, label: '발사 · 첫 추진', actorId: 'craft' },
    ...(plan.engineCommands ?? []).flatMap((c) => {
      const base = { id: c.id, time: c.time, actorId: c.actorId };
      if (c.separate)
        return [{ ...base, kind: 'separate' as const, label: '단 분리 · 다음 엔진은 꺼짐' }];
      const labels: ProgramEvent[] = [];
      if (c.throttle !== undefined)
        labels.push({
          ...base,
          kind: c.throttle > 0 ? 'ignite' : 'stop',
          label:
            c.throttle > 0
              ? '엔진 출력 ' + Math.round(c.throttle * 100) + '%'
              : '엔진 끄기 · 관성 비행',
        });
      if (c.direction)
        labels.push({
          ...base,
          id: c.throttle === undefined ? c.id : c.id + ':turn',
          kind: 'turn',
          label: '방향 전환',
        });
      return labels;
    }),
    ...plan.impulses.map((c) => ({
      id: c.id,
      time: c.time,
      kind: 'push' as const,
      label: '수정 추진 · 속력 변화 ' + length(c.vector).toFixed(2),
      actorId: 'craft',
    })),
  ].sort((a, b) => a.time - b.time);
}
export function launchReadout(stage: Stage, plan: RoutePlan) {
  const throttle = length(plan.launch) / stage.rules.launchLimit;
  if (!stage.rocket) return { powered: false as const, speed: length(plan.launch), throttle };
  const part = stage.rocket.parts[0];
  const mass =
    stage.rocket.payloadMass + stage.rocket.parts.reduce((m, p) => m + p.dryMass + p.fuelMass, 0);

  return {
    powered: true as const,
    throttle,
    thrust: part.thrust * throttle,
    mass,
    acceleration: (part.thrust * throttle) / mass,
    fullAcceleration: part.thrust / mass,
    fuelSeconds:
      part.thrust * throttle > 0
        ? (part.fuelMass * part.exhaustSpeed) / (part.thrust * throttle)
        : Infinity,
  };
}
export function programWarnings(stage: Stage, plan: RoutePlan): string[] {
  const warnings: string[] = planConstraints(stage, plan);
  if (plan.impulses.reduce((n, c) => n + length(c.vector), 0) > stage.rules.maneuverBudget + 1e-8)
    warnings.push('수정 추진 예약 합계가 장치의 여유를 넘습니다.');
  if (!stage.rocket) return warnings;
  const config = stage.rocket;
  let index = 0,
    throttle = Math.min(1, length(plan.launch) / stage.rules.launchLimit),
    time = 0;
  const fuel = config.parts.map((p) => p.fuelMass),
    ignitions = config.parts.map((_, i) => (i === 0 && throttle > 0 ? 1 : 0));
  for (const c of [...(plan.engineCommands ?? [])]
    .filter((c) => c.actorId === 'craft')
    .sort((a, b) => a.time - b.time)) {
    const p = config.parts[index];
    if (p)
      fuel[index] = Math.max(
        0,
        fuel[index] - ((c.time - time) * p.thrust * throttle) / p.exhaustSpeed,
      );
    if (p && fuel[index] <= 1e-8) throttle = 0;
    time = c.time;
    if (c.separate) {
      if (index >= config.parts.length - 1)
        warnings.push(
          c.time.toFixed(1) + '초: 마지막 추진단까지 버립니다. 이후에는 추진할 수 없습니다.',
        );
      index++;
      throttle = 0;
    } else if (c.throttle !== undefined) {
      if (c.throttle > 0 && (!config.parts[index] || fuel[index] <= 1e-8))
        warnings.push(c.time.toFixed(1) + '초: 켜려는 엔진에 연료가 없습니다.');
      if (
        c.throttle > 0 &&
        throttle === 0 &&
        config.parts[index] &&
        ++ignitions[index] > config.parts[index].ignitionLimit
      )
        warnings.push(c.time.toFixed(1) + '초: 엔진 재점화 한도를 넘습니다.');
      throttle = c.throttle;
    }
  }
  return warnings;
}
export function heading(stage: Stage, degrees: number) {
  const angle = (stage.launchAngle ?? 0) + (degrees * Math.PI) / 180;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
export function launchAt(stage: Stage, degrees: number, percent: number) {
  return scale(heading(stage, degrees), (stage.rules.launchLimit * percent) / 100);
}

export type CommandKind = 'ignite' | 'stop' | 'turn' | 'separate' | 'push';
export const commandNames: Record<CommandKind, string> = {
  ignite: '엔진 출력',
  stop: '엔진 끄기',
  turn: '방향 회전',
  separate: '단 분리',
  push: '수정 추진',
};
export function timelineDuration(stage: Stage) {
  return stage.rules.timelineDuration ?? stage.rules.maxTime;
}
export function missionTimeLimit(stage: Stage) {
  return stage.rules.maxTimeUnlimited ? Infinity : stage.rules.maxTime;
}
export function planningTimeLimit(stage: Stage) {
  return Math.min(
    stage.rules.timelineUnlimited ? Infinity : timelineDuration(stage),
    missionTimeLimit(stage),
  );
}
export function commandUsage(plan: RoutePlan): Record<CommandKind, number> {
  const count = { ignite: 0, stop: 0, turn: 0, separate: 0, push: plan.impulses.length };
  for (const c of plan.engineCommands ?? []) {
    if (c.separate) count.separate++;
    else {
      if (c.throttle !== undefined) count[c.throttle > 0 ? 'ignite' : 'stop']++;
      if (c.direction) count.turn++;
    }
  }
  return count;
}
export function canAddCommand(stage: Stage, plan: RoutePlan, kind: CommandKind) {
  const limit = stage.rules.commandLimits?.[kind];
  return limit === undefined || commandUsage(plan)[kind] < limit;
}
export function planConstraints(stage: Stage, plan: RoutePlan): string[] {
  const out: string[] = [];
  const usage = commandUsage(plan);
  for (const kind of Object.keys(usage) as CommandKind[]) {
    const limit = stage.rules.commandLimits?.[kind];
    if (limit !== undefined && usage[kind] > limit)
      out.push(commandNames[kind] + ' 예약 한도 ' + limit + '회를 넘습니다.');
  }
  if (
    [...plan.impulses, ...(plan.engineCommands ?? [])].some(
      (c) => !Number.isFinite(c.time) || c.time < 0 || c.time > planningTimeLimit(stage),
    )
  )
    out.push(
      '조작 시각은 0초부터 타임라인 한도 ' + planningTimeLimit(stage) + '초 안에 지정하세요.',
    );
  return out;
}
