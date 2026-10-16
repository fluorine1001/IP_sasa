import { newObject } from '../stages/factory';
import { bodyPosition, objectPosition, objectVelocity } from '../world/celestial';
import { orbitInitialState } from './physical-design';
import { add, scale, sub, length } from '../physics/vector';
import type { Goal, Stage, WorldObject } from '../world/types';

export type FlightObjectKind = 'satellite' | 'station' | 'debris';
export function isFlightObject(value: unknown): value is WorldObject & { kind: FlightObjectKind } {
  return (
    !!value &&
    typeof value === 'object' &&
    'kind' in value &&
    ['satellite', 'station', 'debris'].includes(String(value.kind))
  );
}
export function objectMotion(stage: Stage, object: WorldObject, mode: string): WorldObject {
  if (!isFlightObject(object) || !['fixed', 'gravity', 'prescribed'].includes(mode))
    throw Error('비행 물체와 운동 방식을 확인하세요.');
  const position = objectPosition(stage, object, 0),
    velocity = objectVelocity(stage, object, 0);
  const result: WorldObject = {
    ...object,
    position: { ...position },
    surface: undefined,
    motion: undefined,
    dynamic: undefined,
  };
  if (mode === 'gravity') result.dynamic = { velocity: { ...velocity } };
  if (mode === 'prescribed') {
    const parent = stage.bodies
      .filter((b) => b.mu > 0)
      .sort(
        (a, b) =>
          length(sub(position, bodyPosition(stage, a, 0))) -
          length(sub(position, bodyPosition(stage, b, 0))),
      )[0];
    if (!parent) throw Error('공전의 중심 천체를 먼저 배치하세요.');
    const delta = sub(position, bodyPosition(stage, parent, 0)),
      radius = length(delta);
    if (radius <= parent.radius + (object.physicalRadius ?? object.radius))
      throw Error('물체를 천체 표면 밖으로 옮긴 뒤 공전시키세요.');
    result.motion = { parentId: parent.id, radius, phase: Math.atan2(delta.y, delta.x) };
  }
  return result;
}
/** Drawn orbit -> physical initial state, not a forced path or a success exemption. */
export function objectOnOrbit(stage: Stage, goal: Goal, kind: FlightObjectKind, clockwise = false) {
  const m = goal.marker,
    parent = stage.bodies.find((b) => b.id === m?.targetId);
  if (
    !m ||
    m.kind !== 'orbit' ||
    !parent ||
    parent.mu <= 0 ||
    !['satellite', 'station', 'debris'].includes(kind)
  )
    throw Error('중심 천체가 있는 궤도 표식을 먼저 선택하세요.');
  const object = newObject(kind),
    eccentricity = Math.sqrt(Math.max(0, 1 - (m.minor / m.radius) ** 2));
  object.radius = kind === 'debris' ? 0.035 : 0.08;
  object.name += ' ' + (stage.objects.filter((o) => o.kind === kind).length + 1);
  const periapsis = m.radius * (1 - eccentricity),
    angle = m.angle ?? 0;
  if (!(periapsis > parent.radius + object.radius))
    throw Error('궤도의 최근접 부분과 천체 사이에 물체가 들어갈 공간이 없습니다.');
  object.position = add(
    bodyPosition(stage, parent, 0),
    scale({ x: Math.cos(angle), y: Math.sin(angle) }, periapsis),
  );
  object.dynamic = {
    velocity: orbitInitialState(stage, parent, object.position, eccentricity, clockwise).velocity,
  };
  if (kind === 'station') object.physicalRadius = object.radius;
  return object;
}

export function sceneActorOptions(stage: Stage): [string, string][] {
  return [
    ['craft', '주 로켓'],
    ...[...(stage.rocket?.parts ?? []), ...(stage.rocket?.payloads ?? [])].map(
      (p): [string, string] => [p.id, p.name],
    ),
    ...stage.bodies.map((b): [string, string] => [b.id, b.name + ' (천체 관측)']),
    ...stage.objects
      .filter(isFlightObject)
      .map((o): [string, string] => [o.id, o.name + ' (비행 물체)']),
  ];
}
