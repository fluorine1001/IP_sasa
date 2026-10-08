import { comparison } from '../world/conditions.ts';
import type { Body, Goal, Stage, WorldObject } from '../world/types.ts';
export const uid = () => crypto.randomUUID();
export function newBody(kind: Body['kind'] = 'planet'): Body {
  return {
    id: uid(),
    name:
      kind === 'black-hole' ? '블랙홀' : kind === 'star' ? '태양' : kind === 'moon' ? '달' : '행성',
    kind,
    position: { x: 0, y: 0 },
    radius: kind === 'star' ? 1.1 : 0.6,
    mu: kind === 'star' ? 8 : 1,
    color:
      kind === 'black-hole'
        ? '#6d497d'
        : kind === 'star'
          ? '#eaaa55'
          : kind === 'moon'
            ? '#b6bcb2'
            : '#65978b',
    hiddenGravity: false,
    estimateMu: 1,
  };
}
export function newObject(kind: WorldObject['kind'] = 'sensor'): WorldObject {
  return {
    id: uid(),
    kind,
    name:
      kind === 'sensor'
        ? '관측 부표'
        : kind === 'gate'
          ? '통과 게이트'
          : kind === 'hazard'
            ? '위험 구역'
            : '정거장',
    position: { x: 0, y: 0 },
    radius: kind === 'sensor' ? 0.45 : 0.6,
    angle: 0,
    points:
      kind === 'path'
        ? [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
          ]
        : undefined,
    sensor: 'gravity',
  };
}
export function newGoal(): Goal {
  return {
    id: uid(),
    title: '새 목표',
    condition: {
      kind: 'hold',
      duration: 1,
      child: { ...comparison('altitude', '', 1), operator: 'gte' },
    },
    position: { x: 3, y: 0 },
    startTime: 0,
    endTime: 40,
    dependsOn: [],
  };
}
export function blankStage(): Stage {
  const body = newBody();
  const goal = {
    ...newGoal(),
    title: '지면에서 벗어나 비행 유지',
    condition: {
      kind: 'hold' as const,
      duration: 1,
      child: { ...comparison('altitude', body.id, 1), operator: 'gte' as const },
    },
  };
  return {
    version: 2,
    launchBodyId: body.id,
    launchAngle: 0,
    id: uid(),
    title: '새 탐사 구역',
    description: '천체와 목표를 배치해 나만의 궤도 퍼즐을 만드세요.',
    order: 10,
    theme: 'frontier',
    bodies: [body],
    objects: [],
    goals: [goal],
    goalMode: 'all',
    spawn: { position: { x: body.radius + 0.005, y: 0 }, velocity: { x: 0, y: 0 } },
    rules: {
      launchLimit: 1.1,
      maneuverBudget: 0.1,
      maxTime: 40,
      worldRadius: 14,
      sensorSlots: 5,
      attempts: 3,
    },
    camera: { x: 0, y: 0, zoom: 60 },
    referencePlans: [],
    audit: { samples: 128, maxPassRate: 0.01, seed: 31415 },
  };
}
