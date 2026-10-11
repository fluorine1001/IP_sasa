import { atmosphericState, rocketMass } from './rocket.ts';
import { add, dot, length, scale, sub, type Vec } from '../physics/vector.ts';
import {
  bodyPosition,
  bodyVelocity,
  gravity,
  objectPosition,
  objectVelocity,
} from './celestial.ts';
import type { GoalContext, GoalProgress } from './types.ts';
type Metric = {
  label: string;
  unit: string;
  target: boolean;
  read: (c: GoalContext, targetId: string, p: GoalProgress) => number;
};
function frame(c: GoalContext, id: string) {
  const body = c.stage.bodies.find((b) => b.id === id),
    object = c.stage.objects.find((o) => o.id === id),
    position = body
      ? bodyPosition(c.stage, body, c.run.time)
      : object
        ? objectPosition(c.stage, object, c.run.time)
        : { x: 0, y: 0 },
    velocity = body
      ? bodyVelocity(c.stage, body, c.run.time)
      : object
        ? objectVelocity(c.stage, object, c.run.time)
        : { x: 0, y: 0 };
  return {
    body,
    radius: body?.radius ?? object?.radius ?? 0,
    d: sub(c.run.position, position),
    v: sub(c.run.velocity, velocity),
  };
}
export const metrics: Record<string, Metric> = {
  targetGravityParameter: {
    label: '대상 천체의 중력 상수 GM',
    unit: 'u³/t²',
    target: true,
    read: (c, id) => c.stage.bodies.find((b) => b.id === id)?.mu ?? NaN,
  },
  throttle: {
    label: '엔진 스로틀',
    unit: '0~1',
    target: false,
    read: (c) =>
      c.actorId && c.actorId !== 'craft'
        ? (c.run.detached.find((a) => a.id === c.actorId)?.throttle ?? NaN)
        : (c.run.rocket?.throttle ?? 0),
  },
  ignitions: {
    label: '선택 엔진의 점화 횟수',
    unit: '회',
    target: false,
    read: (c) =>
      c.actorId && c.actorId !== 'craft'
        ? (c.run.detached.find((a) => a.id === c.actorId)?.ignitions ?? NaN)
        : (c.run.rocket?.ignitions[c.run.rocket.partIndex] ?? 0),
  },
  targetRadius: {
    label: '대상 오브젝트의 반경 / 경로 허용 폭',
    unit: 'u',
    target: true,
    read: (c, id) =>
      c.stage.objects.find((o) => o.id === id)?.radius ??
      c.stage.bodies.find((b) => b.id === id)?.radius ??
      NaN,
  },
  routeProgress: {
    label: '목표 경로의 진행 위치',
    unit: '0~1',
    target: true,
    read: (c, id) => {
      const path = c.stage.objects.find((o) => o.id === id && o.kind === 'path');
      if (!path?.points?.length) return NaN;
      let closest = Infinity,
        progress = 0,
        total = 0;
      const lengths = path.points.slice(1).map((v, i) => length(sub(v, path.points![i])));
      const full = lengths.reduce((a, b) => a + b, 0);
      for (let i = 1; i < path.points.length; i++) {
        const a = add(path.position, path.points[i - 1]),
          b = add(path.position, path.points[i]),
          d = sub(b, a),
          t = Math.max(0, Math.min(1, dot(sub(c.run.position, a), d) / Math.max(dot(d, d), 1e-9))),
          distance = length(sub(c.run.position, add(a, scale(d, t))));
        if (distance < closest - 1e-9) {
          closest = distance;
          progress = (total + lengths[i - 1] * t) / Math.max(full, 1e-9);
        }
        total += lengths[i - 1];
      }
      return progress;
    },
  },
  altitudeRoute: {
    label: '목표 경로에서 벗어난 거리',
    unit: 'u',
    target: true,
    read: (c, id) => {
      const path = c.stage.objects.find((o) => o.id === id && o.kind === 'path');
      if (!path?.points?.length) return NaN;
      let best = Infinity;
      for (let i = 1; i < path.points.length; i++) {
        const a = add(path.position, path.points[i - 1]),
          b = add(path.position, path.points[i]),
          d = sub(b, a),
          t = Math.max(0, Math.min(1, dot(sub(c.run.position, a), d) / Math.max(dot(d, d), 1e-9)));
        best = Math.min(best, length(sub(c.run.position, add(a, scale(d, t)))));
      }
      return best;
    },
  },
  dynamicPressure: {
    label: '대기가 가하는 힘 / 면적',
    unit: '질량/u/t²',
    target: false,
    read: (c) => atmosphericState(c.stage, c.run.position, c.run.velocity, c.run.time).q,
  },
  airDensity: {
    label: '현재 공기 밀도',
    unit: '질량/u³',
    target: false,
    read: (c) => atmosphericState(c.stage, c.run.position, c.run.velocity, c.run.time).density,
  },
  mass: {
    label: '비행체 질량',
    unit: '질량',
    target: false,
    read: (c) => {
      const actor = c.run.detached.find((a) => a.id === c.actorId);
      return actor ? actor.dryMass + actor.fuel : c.stage.rocket ? rocketMass(c.stage, c.run) : 1;
    },
  },
  fuel: {
    label: '선택 엔진의 남은 연료',
    unit: '질량',
    target: false,
    read: (c) => {
      const actor = c.run.detached.find((a) => a.id === c.actorId);
      return actor ? actor.fuel : (c.run.rocket?.fuel[c.run.rocket.partIndex] ?? 0);
    },
  },
  separatedStages: {
    label: '분리한 로켓 단 수',
    unit: '개',
    target: false,
    read: (c) => c.run.detached.length,
  },
  touchdownSpeed: {
    label: '지면에 닿은 순간 상대속력',
    unit: 'u/t',
    target: false,
    read: (c) =>
      c.actorId && c.actorId !== 'craft'
        ? (c.run.detached.find((a) => a.id === c.actorId)?.touchdownSpeed ?? NaN)
        : (c.run.touchdownSpeed ?? NaN),
  },
  heat: {
    label: '누적 가열',
    unit: '게임 열 단위',
    target: false,
    read: (c) => c.run.detached.find((a) => a.id === c.actorId)?.heat ?? c.run.rocket?.heat ?? 0,
  },
  time: { label: '비행 시간', unit: 't', target: false, read: (c) => c.run.time },
  speed: { label: '상대 속력', unit: 'u/t', target: true, read: (c, id) => length(frame(c, id).v) },
  distance: {
    label: '중심까지 거리',
    unit: 'u',
    target: true,
    read: (c, id) => length(frame(c, id).d),
  },
  altitude: {
    label: '표면에서 높이',
    unit: 'u',
    target: true,
    read: (c, id) => {
      const f = frame(c, id);
      return length(f.d) - f.radius;
    },
  },
  radialSpeed: {
    label: '멀어지는 속도 (음수: 접근)',
    unit: 'u/t',
    target: true,
    read: (c, id) => {
      const f = frame(c, id);
      return dot(f.d, f.v) / Math.max(length(f.d), 1e-9);
    },
  },
  energy: {
    label: '대상 기준 역학적 에너지 / 질량',
    unit: 'u²/t²',
    target: true,
    read: (c, id) => {
      const f = frame(c, id);
      return (
        dot(f.v, f.v) / 2 -
        ((f.body?.mu ?? 0) + (c.stage.bodies.find((b) => b.id === c.actorId)?.mu ?? 0)) /
          Math.max(length(f.d), 1e-9)
      );
    },
  },
  angularMomentum: {
    label: '대상 기준 각운동량 / 질량',
    unit: 'u²/t',
    target: true,
    read: (c, id) => {
      const f = frame(c, id);
      return f.d.x * f.v.y - f.d.y * f.v.x;
    },
  },
  gravity: {
    label: '현재 중력 가속도 크기',
    unit: 'u/t²',
    target: false,
    read: (c) => length(gravity(c.stage, c.run.position, c.run.time)),
  },
  x: { label: '상대 위치 X', unit: 'u', target: true, read: (c, id) => frame(c, id).d.x },
  y: { label: '상대 위치 Y', unit: 'u', target: true, read: (c, id) => frame(c, id).d.y },
  vx: { label: '상대 속도 X', unit: 'u/t', target: true, read: (c, id) => frame(c, id).v.x },
  vy: { label: '상대 속도 Y', unit: 'u/t', target: true, read: (c, id) => frame(c, id).v.y },
  thrustUsed: { label: '사용한 수정 추진 Δv', unit: 'u/t', target: false, read: (c) => c.run.used },
  thrustLeft: {
    label: '남은 수정 추진 Δv',
    unit: 'u/t',
    target: false,
    read: (c) => Math.max(0, c.stage.rules.maneuverBudget - c.run.used),
  },
  buoys: { label: '방출한 부표 개수', unit: '개', target: false, read: (c) => c.run.buoys.length },
  angularTravel: {
    label: '대상 주위 누적 회전량 (양방향 합산)',
    unit: 'rad',
    target: true,
    read: (c, id, p) => {
      const f = frame(c, id),
        angle = Math.atan2(f.d.y, f.d.x);
      p.conditionMemory ??= {};
      const m = (p.conditionMemory[`angle:${c.actorId ?? 'craft'}:${id}`] ??= {
        hold: 0,
        index: 0,
        latched: false,
      });
      m.travel =
        (m.travel ?? 0) +
        (m.lastAngle === undefined
          ? 0
          : Math.abs(Math.atan2(Math.sin(angle - m.lastAngle), Math.cos(angle - m.lastAngle))));
      m.lastAngle = angle;
      return m.travel;
    },
  },
  traveledDistance: {
    label: '누적 이동 거리',
    unit: 'u',
    target: false,
    read: (c, _id, p) => {
      p.conditionMemory ??= {};
      const m = (p.conditionMemory[`distance:${c.actorId ?? 'craft'}`] ??= {
        hold: 0,
        index: 0,
        latched: false,
      });
      m.travel = (m.travel ?? 0) + (m.position ? length(sub(c.run.position, m.position)) : 0);
      m.position = { ...c.run.position };
      return m.travel;
    },
  },
  orbitTurns: {
    label: '대상 주위를 돈 바퀴 수',
    unit: '회',
    target: true,
    read: (c, id, p) => {
      const f = frame(c, id),
        angle = Math.atan2(f.d.y, f.d.x);
      p.conditionMemory ??= {};
      const m = (p.conditionMemory[`metric:${c.actorId ?? 'craft'}:${id}`] ??= {
        hold: 0,
        index: 0,
        latched: false,
      });
      m.travel =
        (m.travel ?? 0) +
        (m.lastAngle === undefined
          ? 0
          : Math.atan2(Math.sin(angle - m.lastAngle), Math.cos(angle - m.lastAngle)));
      m.lastAngle = angle;
      return Math.abs(m.travel) / (2 * Math.PI);
    },
  },
};
