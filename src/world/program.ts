import { length, scale } from '../physics/vector';
import { gravity } from './celestial';
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
    ...(plan.deployments ?? []).map((c) => ({
      id: c.id,
      time: c.time,
      kind: 'sensor' as const,
      label: (c.kind === 'gravity' ? '중력' : '속력') + ' 부표 방출',
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
  const g = length(gravity(stage, stage.spawn.position, 0));
  const angle = Math.atan2(plan.launch.y, plan.launch.x) - (stage.launchAngle ?? 0);
  const fullLift = (part.thrust * Math.cos(angle)) / Math.max(mass * g, 1e-9);
  return {
    powered: true as const,
    throttle,
    thrust: part.thrust * throttle,
    mass,
    lift: fullLift * throttle,
    minimum: fullLift > 0 ? 1 / fullLift : Infinity,
    fuelSeconds:
      part.thrust * throttle > 0
        ? (part.fuelMass * part.exhaustSpeed) / (part.thrust * throttle)
        : Infinity,
  };
}
export function programWarnings(stage: Stage, plan: RoutePlan): string[] {
  const warnings: string[] = [];
  if (plan.impulses.reduce((n, c) => n + length(c.vector), 0) > stage.rules.maneuverBudget + 1e-8)
    warnings.push('수정 추진 예약 합계가 장치의 여유를 넘습니다.');
  if (!stage.rocket) return warnings;
  const readout = launchReadout(stage, plan);
  if (readout.powered && stage.launchBodyId && readout.lift <= 1)
    warnings.push(
      '첫 출력의 위쪽 힘이 무게보다 작습니다. 현재 설정으로는 발사대를 떠나지 못합니다.',
    );
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
