import { blankStage, newGoal, newObject } from '../../stages/factory';
import { createMarker, compileMarker } from '../../stages/goal-marker';
import { syncLaunch } from '../../world/launch';
import { execute } from '../../world/engine';
import { controlSamples } from './control-samples';
import { assessDifficulty, acceptsDifficulty, type DifficultyAssessment } from './assessment';
import type { RoutePlan, Stage } from '../../world/types';
import type { Difficulty } from './difficulty';
import { configureEnvironment, type EnvironmentKind } from './environments';
import { configureMission, fitMission } from './mission-templates';

export type TemplateKind = 'survey' | 'relay' | 'landing' | 'orbit' | 'escape';
export type Margin = 'wide' | 'standard';
export const templateNames: Record<TemplateKind, string> = {
  survey: '상공 관측소 방문',
  relay: '연속 관측소 방문',
  landing: '상승 후 안전 착륙',
  orbit: '엔진 종료 후 한 바퀴 궤도 유지',
  escape: '천체계 중력권 탈출',
};
export type Recipe = {
  kind: TemplateKind;
  difficulty: Difficulty;
  margin: Margin;
  radius: number;
  clock: number;
  launchAngle: number;
  targetAngle: number;
  targetRadius: number;
  planetCount: number;
  environment?: EnvironmentKind;
  planets: { angle: number; distance: number; radius: number; mass: number }[];
};
export type Blueprint = {
  stage: Stage;
  witness: RoutePlan;
  omissions: { label: string; plan: RoutePlan }[];
  recipe: Recipe;
  fingerprint: string;
  preparationChecks: number;
  assessment?: DifficultyAssessment;
};
export const polar = (radius: number, angle: number) => ({
  x: radius * Math.cos(angle),
  y: radius * Math.sin(angle),
});

/** Destinations and world geometry are fixed before trying any launch controls. */
export function buildBlueprint(recipe: Recipe): Blueprint {
  const { radius: r, clock, launchAngle, targetAngle, targetRadius, difficulty, margin } = recipe;
  const stage = blankStage(),
    mu = r ** 3 / clock ** 2,
    body = stage.bodies[0];
  Object.assign(body, { name: '출발 행성', radius: r, mu, estimateMu: mu });
  stage.published = false;
  stage.referencePlans = [];
  stage.objects = [];
  stage.goals = [];
  stage.launchBodyId = body.id;
  stage.launchAngle = launchAngle;
  stage.spawn.placed = true;
  syncLaunch(stage);
  configureEnvironment(stage, recipe);
  stage.rocket = {
    payloadMass: 0.2,
    parts: [
      {
        id: crypto.randomUUID(),
        name: '관측 로켓',
        dryMass: 1,
        fuelMass: 1.5,
        thrust: (2.7 * 4 * r) / clock ** 2,
        exhaustSpeed: (10 * r) / clock,
        area: 0.01,
        maxQ: 100,
        maxHeat: 100,
        ignitionLimit: 3,
        turnRate: 4 / clock,
      },
    ],
  };
  stage.rules.launchLimit = 1;
  stage.rules.maneuverBudget = 0;
  stage.rules.commandLimits = { ignite: 4, stop: 3, turn: 4, push: 0, separate: 0, deploy: 0 };
  stage.rules.maxTime = clock * (difficulty === 'easy' ? 6 : difficulty === 'normal' ? 11 : 17);
  stage.rules.timelineDuration = Math.min(stage.rules.maxTime, clock * 8);
  stage.rules.worldRadius = 14 * r;
  stage.audit = { samples: 32, maxPassRate: 0.15, seed: 31415, timeLimit: stage.rules.maxTime };
  const width =
    (difficulty === 'easy' ? 0.29 : difficulty === 'normal' ? 0.25 : 0.2) *
    (margin === 'wide' ? 1 : 0.85) *
    r;
  const targets =
    recipe.kind === 'relay'
      ? [
          {
            angle: targetAngle * 0.48,
            radius:
              difficulty === 'easy'
                ? 1.35
                : Math.max(1.25, targetRadius * (Math.abs(targetAngle) > 1.8 ? 1.16 : 0.82)),
          },
          { angle: targetAngle, radius: targetRadius },
        ]
      : [{ angle: targetAngle, radius: targetRadius }];
  for (const [index, target] of targets.entries()) {
    const sensor = newObject('sensor');
    sensor.name = `${index + 1}번 관측소`;
    sensor.position = polar(target.radius * r, launchAngle + target.angle);
    if (body.motion || body.dynamic)
      sensor.motion = {
        parentId: body.id,
        radius: target.radius * r,
        phase: launchAngle + target.angle,
        angularSpeed: 0,
      };
    sensor.radius =
      targets.length > 1 && index === 0 ? (difficulty === 'easy' ? 0.18 * r : width * 1.3) : width;
    stage.objects.push(sensor);
    const goal = createMarker(stage, 'area', sensor.position);
    goal.title = `${sensor.name} 관측구역`;
    goal.endTime = stage.rules.maxTime;
    Object.assign(goal.marker!, { targetId: sensor.id, radius: sensor.radius, span: 'instant' });
    Object.assign(goal, compileMarker(stage, goal));
    stage.goals.push(goal);
  }
  const visits = stage.goals.map((goal) => ({
    kind: 'hold' as const,
    duration: clock * 0.06,
    child: {
      kind: 'all' as const,
      children: [
        { kind: 'reference' as const, goalId: goal.id },
        {
          kind: 'compare' as const,
          left: { kind: 'metric' as const, metric: 'throttle', actorId: 'craft', targetId: '' },
          operator: 'eq' as const,
          right: { kind: 'constant' as const, value: 0 },
        },
      ],
    },
  }));
  stage.goals.push({
    ...newGoal(),
    title:
      targets.length > 1
        ? '엔진 종료 후 관측소를 순서대로 방문해 자료 수집'
        : '엔진 종료 후 관측소에서 자료 수집',
    endTime: stage.rules.maxTime,
    condition: targets.length > 1 ? { kind: 'sequence', children: visits } : visits[0],
  });
  configureMission(stage, recipe);
  const regions = [
    ...stage.bodies,
    ...stage.objects,
    ...stage.goals.flatMap((g) => {
      const body = stage.bodies.find((b) => b.id === g.display?.targetId);
      return body && g.display ? [{ position: body.position, radius: g.display.max }] : [];
    }),
  ];
  const minX = Math.min(...regions.map((o) => o.position.x - o.radius)),
    maxX = Math.max(...regions.map((o) => o.position.x + o.radius));
  const minY = Math.min(...regions.map((o) => o.position.y - o.radius)),
    maxY = Math.max(...regions.map((o) => o.position.y + o.radius));
  stage.camera = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    zoom: 180 / Math.max(maxX - minX, maxY - minY),
  };
  if (recipe.kind === 'survey' || recipe.kind === 'relay') {
    stage.title = recipe.kind === 'relay' ? '지상 기지에서 관측소 순회' : '지상 기지에서 상공 관측';
    stage.description = `행성 표면의 발사대에서 출발해 ${targets.length > 1 ? '번호 순서대로 관측소를 방문하세요' : '관측소에 도착하세요'}. 엔진을 끈 상태로 관측구역을 지나 자료를 모으면 임무가 완료됩니다.`;
  }
  const fit =
    recipe.kind === 'survey' || recipe.kind === 'relay'
      ? fitLaunch(stage, recipe)
      : fitMission(stage, recipe);
  const omissions = [
    { label: '출발 출력 생략', plan: { ...structuredClone(fit.witness), launch: { x: 0, y: 0 } } },
    {
      label: '엔진 종료 생략',
      plan: {
        ...structuredClone(fit.witness),
        engineCommands: fit.witness.engineCommands?.filter((c) => c.throttle !== 0),
      },
    },
  ];
  const direction = fit.witness.engineCommands?.find((c) => c.direction)?.direction;
  if (
    direction &&
    Math.abs(
      Math.atan2(
        Math.sin(Math.atan2(direction.y, direction.x) - launchAngle),
        Math.cos(Math.atan2(direction.y, direction.x) - launchAngle),
      ),
    ) > 0.15
  )
    omissions.push({
      label: '출발 방향 설정 생략',
      plan: {
        ...structuredClone(fit.witness),
        engineCommands: fit.witness.engineCommands?.filter((c) => !c.direction),
      },
    });
  const relative = stage.bodies
    .slice(1)
    .map((b) => [
      b.kind,
      Math.round(
        (((b.position.x - body.position.x) * Math.cos(launchAngle) +
          (b.position.y - body.position.y) * Math.sin(launchAngle)) /
          r) *
          4,
      ),
      Math.round(
        ((-(b.position.x - body.position.x) * Math.sin(launchAngle) +
          (b.position.y - body.position.y) * Math.cos(launchAngle)) /
          r) *
          4,
      ),
      Math.round((b.radius / r) * 10),
      Math.round((b.mu / body.mu) * 20),
      b.motion ? 'orbit' : b.dynamic ? 'dynamic' : 'fixed',
    ]);
  const missionGeometry =
    recipe.kind === 'landing'
      ? [
          'ascent',
          Math.round(Math.max(0.45, 0.5 + (targetRadius - 1.4) * 0.8) * 20),
          Math.round((stage.rocket!.parts[0].maxLandingSpeed! / (r / clock)) * 100),
        ]
      : recipe.kind === 'orbit'
        ? [
            'band',
            Math.round((stage.goals[0].display!.min / r) * 10),
            Math.round((stage.goals[0].display!.max / r) * 10),
          ]
        : [
            Math.round((targetAngle * 18) / Math.PI),
            recipe.kind === 'escape' ? 4 : Math.round(targetRadius * 5),
          ];
  return {
    stage,
    recipe,
    ...fit,
    omissions,
    fingerprint: JSON.stringify([
      recipe.kind,
      recipe.environment ?? 'planetary',
      missionGeometry,
      margin,
      relative,
    ]),
  };
}

function fitLaunch(stage: Stage, recipe: Recipe) {
  const { clock, launchAngle, targetAngle, difficulty } = recipe;
  const sign = Math.sign(targetAngle) || 1,
    degrees = (Math.abs(targetAngle) * 180) / Math.PI;
  const headings =
    degrees < 25
      ? [degrees * 2, 0, 20, 35, 50]
      : degrees < 105
        ? [70, 85, 55, 40, 100, 25]
        : [90, 100, 80, 70, 110, 60];
  const burns =
    degrees < 25
      ? [0.35, 0.3, 0.4, 0.45, 0.5]
      : [0.43, 0.45, 0.41, 0.47, 0.39, 0.49, 0.37, 0.51, 0.35];
  let preparationChecks = 0,
    witness: RoutePlan = { launch: polar(0.7, launchAngle), impulses: [] };
  for (const throttle of [0.7, 0.65, 0.75, 0.6, 0.8]) {
    for (const burn of burns)
      for (const heading of headings) {
        const plan: RoutePlan = {
          launch: polar(throttle, launchAngle),
          impulses: [],
          engineCommands: [
            {
              id: 'initial-heading',
              time: 0,
              actorId: 'craft',
              direction: polar(1, launchAngle + (sign * heading * Math.PI) / 180),
            },
            { id: 'engine-cutoff', time: burn * clock, actorId: 'craft', throttle: 0 },
          ],
        };
        preparationChecks++;
        const run = execute(stage, plan, true);
        if (run.status !== 'won') continue;
        witness = plan;
        const samples = controlSamples(stage, plan, difficulty);
        let wins = 0;
        for (const sample of samples) {
          preparationChecks++;
          if (execute(stage, sample).status === 'won') wins++;
        }
        const assessment = assessDifficulty(stage, recipe, run, wins, samples.length);
        if (acceptsDifficulty(difficulty, assessment))
          return { witness, preparationChecks, assessment };
      }
  }
  return { witness, preparationChecks };
}
