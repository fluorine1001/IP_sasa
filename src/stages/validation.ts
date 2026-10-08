import { conditionIssues } from '../world/conditions.ts';
import { bodyPosition, bodyVelocity } from '../world/celestial.ts';
import { length, sub } from '../physics/vector.ts';
import { type Stage } from '../world/types.ts';
export function issues(stage: Stage): string[] {
  const out: string[] = [];
  if (stage.version !== 2) out.push('지원하지 않는 스테이지 버전입니다.');
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(stage.id))
    out.push('스테이지 ID는 UUID여야 합니다.');
  if (!stage.title?.trim()) out.push('스테이지 이름이 필요합니다.');
  if (!stage.bodies?.length || !stage.goals?.length)
    out.push('천체와 목표를 하나 이상 배치하세요.');
  const records = [
    ...(stage.bodies ?? []),
    ...(stage.objects ?? []),
    ...(stage.goals ?? []),
    ...(stage.rocket?.parts ?? []),
  ];
  const ids = new Set<string>();
  for (const r of records) {
    if (!r.id || ids.has(r.id)) out.push('오브젝트 ID가 중복되었습니다.');
    ids.add(r.id);
  }
  if (stage.bodies?.length > 64 || stage.objects?.length > 1000 || stage.goals?.length > 100)
    out.push('이 버전의 제작 범위를 초과했습니다 (천체 64, 오브젝트 1000, 목표 100).');
  for (const b of stage.bodies ?? []) {
    if (
      b.dynamic &&
      (![b.dynamic.velocity?.x, b.dynamic.velocity?.y].every(Number.isFinite) || b.motion)
    )
      out.push('운동 천체의 초기 속도와 궤도 모드를 확인하세요.');
    if (
      b.atmosphere &&
      (![b.atmosphere.height, b.atmosphere.density, b.atmosphere.scaleHeight].every(
        Number.isFinite,
      ) ||
        b.atmosphere.height <= 0 ||
        b.atmosphere.density < 0 ||
        b.atmosphere.scaleHeight <= 0)
    )
      out.push('대기 높이·밀도·감쇠 길이를 확인하세요.');
    if (
      !['planet', 'moon', 'star', 'black-hole', 'barycenter'].includes(b.kind) ||
      !/^#[0-9a-f]{6}$/i.test(b.color)
    )
      out.push('천체 종류와 색을 확인하세요.');
    if (
      ![b.mu, b.radius, b.position?.x, b.position?.y, b.estimateMu].every(Number.isFinite) ||
      (b.kind !== 'barycenter' && b.mu <= 0) ||
      b.mu < 0 ||
      b.radius <= 0 ||
      b.estimateMu <= 0
    )
      out.push(`${b.name}: 천체 수치를 확인하세요.`);
    if (b.motion) {
      if (
        !stage.bodies.some((p) => p.id === b.motion!.parentId) ||
        b.motion.parentId === b.id ||
        b.motion.radius <= 0 ||
        ![b.motion.radius, b.motion.phase].every(Number.isFinite)
      )
        out.push(`${b.name}: 공전 중심과 반지름을 확인하세요.`);
      const visited = new Set([b.id]);
      let parent = stage.bodies.find((p) => p.id === b.motion?.parentId);
      while (parent) {
        if (visited.has(parent.id)) {
          out.push(`${b.name}: 공전 관계가 순환합니다.`);
          break;
        }
        visited.add(parent.id);
        parent = stage.bodies.find((p) => p.id === parent!.motion?.parentId);
      }
    }
  }
  for (const o of stage.objects ?? []) {
    if (
      o.kind === 'path' &&
      (!Array.isArray(o.points) ||
        o.points.length < 2 ||
        o.points.length > 512 ||
        o.points.some((p) => ![p.x, p.y].every(Number.isFinite)))
    )
      out.push('목표 경로에는 유효한 점 2~512개가 필요합니다.');
    if (
      o.motion &&
      (!stage.bodies.some((b) => b.id === o.motion!.parentId) ||
        !Number.isFinite(o.motion.radius) ||
        o.motion.radius <= 0 ||
        !Number.isFinite(o.motion.phase))
    )
      out.push('오브젝트의 공전 관계를 확인하세요.');
    if (
      !['sensor', 'gate', 'hazard', 'station', 'path'].includes(o.kind) ||
      !['speed', 'gravity', 'distance', 'direction', 'clock'].includes(o.sensor) ||
      ![o.radius, o.angle, o.position?.x, o.position?.y].every(Number.isFinite) ||
      o.radius <= 0
    )
      out.push(`${o.name}: 오브젝트 수치를 확인하세요.`);
  }
  for (const g of stage.goals ?? []) {
    out.push(...conditionIssues(g.condition, new Set(records.map((r) => r.id))));
    if (
      typeof g.title !== 'string' ||
      !g.title.trim() ||
      ![g.startTime, g.endTime, g.position?.x, g.position?.y].every(Number.isFinite) ||
      g.startTime < 0 ||
      g.endTime > stage.rules?.maxTime ||
      g.startTime > g.endTime
    )
      out.push(`${g.title}: 목표 시간과 위치를 확인하세요.`);
    if (
      !Array.isArray(g.dependsOn) ||
      g.dependsOn.some((id) => id === g.id || !stage.goals.some((x) => x.id === id))
    )
      out.push(`${g.title}: 선행 목표를 확인하세요.`);
    if (
      g.display &&
      (!records.some((x) => x.id === g.display!.targetId) ||
        ![g.display.min, g.display.max].every(Number.isFinite) ||
        g.display.min <= 0 ||
        g.display.max < g.display.min)
    )
      out.push('목표 표시 영역을 확인하세요.');
  }
  const visitGoal = (id: string, path: Set<string>): boolean => {
    if (path.has(id)) return true;
    const g = stage.goals.find((x) => x.id === id);
    return !!g && g.dependsOn.some((x) => visitGoal(x, new Set([...path, id])));
  };
  if (stage.goals?.some((g) => visitGoal(g.id, new Set())))
    out.push('목표 선행 관계가 순환합니다.');
  if (stage.rocket) {
    const r = stage.rocket;
    if (
      !Number.isFinite(r.payloadMass) ||
      r.payloadMass <= 0 ||
      !Array.isArray(r.parts) ||
      r.parts.length < 1 ||
      r.parts.length > 6 ||
      stage.rules.launchLimit <= 0
    )
      out.push('로켓 탑재체 질량과 1~6단 구성을 확인하세요.');
    else
      for (const part of r.parts)
        if (
          ![
            part.dryMass,
            part.fuelMass,
            part.thrust,
            part.exhaustSpeed,
            part.area,
            part.maxQ,
            part.maxHeat,
            part.ignitionLimit,
          ].every(Number.isFinite) ||
          part.dryMass <= 0 ||
          part.fuelMass < 0 ||
          part.thrust <= 0 ||
          part.exhaustSpeed <= 0 ||
          part.area <= 0 ||
          part.maxQ <= 0 ||
          part.maxHeat <= 0 ||
          !Number.isInteger(part.ignitionLimit) ||
          part.ignitionLimit < 1 ||
          part.ignitionLimit > 20
        )
          out.push('로켓 단의 질량·추력·연료·재점화·보호 한계를 확인하세요.');
  }
  if (stage.published !== undefined && typeof stage.published !== 'boolean')
    out.push('배포 여부는 참/거짓이어야 합니다.');
  if (
    !Number.isFinite(stage.order) ||
    typeof stage.description !== 'string' ||
    stage.title.length > 200 ||
    stage.description.length > 4000
  )
    out.push('스테이지 순서와 설명을 확인하세요.');
  const r = stage.rules;
  if (
    !r ||
    ![r.launchLimit, r.maneuverBudget, r.maxTime, r.worldRadius, r.sensorSlots, r.attempts].every(
      Number.isFinite,
    ) ||
    r.launchLimit < 0 ||
    r.maneuverBudget < 0 ||
    r.maxTime <= 0 ||
    r.maxTime > 600 ||
    r.worldRadius <= 0 ||
    !Number.isInteger(r.sensorSlots) ||
    r.sensorSlots < 0 ||
    r.sensorSlots > 64 ||
    !Number.isInteger(r.attempts) ||
    r.attempts < 1 ||
    r.attempts > 100
  )
    out.push('발사·시간·장비 제한을 확인하세요.');
  if (
    ![
      stage.spawn?.position?.x,
      stage.spawn?.position?.y,
      stage.spawn?.velocity?.x,
      stage.spawn?.velocity?.y,
      stage.camera?.x,
      stage.camera?.y,
      stage.camera?.zoom,
    ].every(Number.isFinite) ||
    stage.camera.zoom <= 0
  )
    out.push('시작 위치와 카메라를 확인하세요.');
  const launch = stage.bodies.find((b) => b.id === stage.launchBodyId);
  if (!launch || !['planet', 'moon'].includes(launch.kind) || !Number.isFinite(stage.launchAngle))
    out.push('출발 천체와 표면 발사 위치를 지정하세요.');
  else if (
    Math.abs(
      length(sub(stage.spawn.position, bodyPosition(stage, launch, 0))) - (launch.radius + 0.005),
    ) > 0.00001 ||
    length(sub(stage.spawn.velocity, bodyVelocity(stage, launch, 0))) > 0.00001
  )
    out.push('출발점은 선택한 천체의 표면 발사대여야 합니다.');
  if (
    !stage.audit ||
    !Number.isInteger(stage.audit.samples) ||
    stage.audit.samples < 16 ||
    stage.audit.samples > 2048 ||
    !Number.isInteger(stage.audit.seed) ||
    !Number.isFinite(stage.audit.maxPassRate) ||
    stage.audit.maxPassRate < 0 ||
    stage.audit.maxPassRate > 1
  )
    out.push('설계 검사 표본과 성공률 기준을 확인하세요.');
  if (!Array.isArray(stage.referencePlans) || stage.referencePlans.length > 30)
    out.push('기준 경로 목록을 확인하세요.');
  else
    for (const plan of stage.referencePlans) {
      if (
        !plan.launch ||
        ![plan.launch.x, plan.launch.y].every(Number.isFinite) ||
        length(plan.launch) > stage.rules.launchLimit + 1e-8 ||
        !Array.isArray(plan.impulses) ||
        plan.impulses.length > 10000
      ) {
        out.push('기준 경로의 발사 추진과 명령을 확인하세요.');
        continue;
      }
      const ids = new Set<string>();
      let cost = 0;
      for (const burn of plan.impulses) {
        if (
          !burn.id ||
          ids.has(burn.id) ||
          !burn.vector ||
          ![burn.time, burn.vector?.x, burn.vector?.y].every(Number.isFinite) ||
          burn.time < 0 ||
          burn.time > stage.rules.maxTime
        )
          out.push('기준 경로의 추진 시각·ID·벡터를 확인하세요.');
        ids.add(burn.id);
        cost += length(burn.vector);
      }
      if (cost > stage.rules.maneuverBudget + 1e-8)
        out.push('기준 경로가 수정 추진 예산을 초과했습니다.');
      if (plan.engineCommands) {
        if (!Array.isArray(plan.engineCommands) || plan.engineCommands.length > 10000)
          out.push('엔진 명령 개수를 확인하세요.');
        else
          for (const command of plan.engineCommands) {
            if (
              !command.id ||
              ids.has(command.id) ||
              !Number.isFinite(command.time) ||
              command.time < 0 ||
              command.time > stage.rules.maxTime ||
              (command.throttle !== undefined &&
                (!Number.isFinite(command.throttle) ||
                  command.throttle < 0 ||
                  command.throttle > 1)) ||
              (command.direction &&
                ![command.direction.x, command.direction.y].every(Number.isFinite)) ||
              (command.actorId !== 'craft' &&
                !stage.rocket?.parts.some((p) => p.id === command.actorId))
            )
              out.push('엔진 명령의 대상·시각·방향·스로틀을 확인하세요.');
            ids.add(command.id);
          }
      }
      if (plan.deployments) {
        if (!Array.isArray(plan.deployments) || plan.deployments.length > stage.rules.sensorSlots)
          out.push('기준 경로의 부표 수를 확인하세요.');
        else
          for (const release of plan.deployments) {
            if (
              !release.id ||
              ids.has(release.id) ||
              !Number.isFinite(release.time) ||
              release.time < 0 ||
              release.time > stage.rules.maxTime ||
              !['speed', 'gravity', 'distance', 'direction', 'clock'].includes(release.kind)
            )
              out.push('기준 경로의 부표 명령을 확인하세요.');
            ids.add(release.id);
          }
      }
    }
  return [...new Set(out)];
}
export function parseStage(value: unknown): Stage {
  if (!value || typeof value !== 'object') throw new Error('스테이지 객체가 필요합니다.');
  const stage = value as Stage;
  try {
    const errors = issues(stage);
    if (errors.length) throw new Error(errors.join('\n'));
    return stage;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : '스테이지 형식을 확인하세요.');
  }
}
