import { blankStage, newGoal } from '../../src/stages/factory';
import { createMarker, compileMarker } from '../../src/stages/goal-marker';
import type { RoutePlan } from '../../src/world/types';

/** Two-dimensional circular -> half-ellipse coast -> circular transfer. No answer is fed to search. */
export function hohmannTransfer() {
  const stage = blankStage();
  delete stage.rocket;
  delete stage.launchBodyId;
  stage.published = false;
  stage.title = '원 궤도에서 전이 타원을 거쳐 바깥 원 궤도로';
  stage.bodies[0].radius = 0.2;
  stage.spawn = { position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } };
  stage.rules.launchLimit = 0;
  stage.rules.maneuverBudget = 0.4;
  stage.rules.commandLimits = { ignite: 0, stop: 0, turn: 0, separate: 0, deploy: 0, push: 2 };
  stage.rules.maxTime = stage.rules.timelineDuration = stage.audit.timeLimit = 28;
  stage.audit.samples = 16;
  stage.referencePlans = [];
  const orbit = (a: number, b: number, width: number, angle = 0) => {
    const goal = createMarker(stage, 'orbit', { x: a, y: 0 });
    goal.endTime = 28;
    Object.assign(goal.marker!, { radius: a, minor: b, width, angle });
    return goal;
  };
  const initial = orbit(1, 1, 0.04),
    transfer = orbit(1.5, Math.sqrt(2), 0.08, 1),
    final = orbit(2, 2, 0.08);
  initial.title = '출발 원 궤도';
  initial.marker!.span = 'settle';
  initial.marker!.duration = 0.5;
  transfer.title = '전이 타원에서 관성 비행';
  transfer.marker!.span = 'settle';
  transfer.marker!.duration = 5;
  final.title = '바깥 원 궤도에서 한 바퀴';
  for (const goal of [initial, transfer, final]) Object.assign(goal, compileMarker(stage, goal));
  const mission = {
    ...newGoal(),
    title: stage.title,
    endTime: 28,
    condition: {
      kind: 'sequence' as const,
      children: [initial, transfer, final].map((g) => ({
        kind: 'reference' as const,
        goalId: g.id,
      })),
    },
  };
  stage.goals = [initial, transfer, final, mission];
  const first = Math.sqrt(4 / 3) - 1,
    second = 1 / Math.sqrt(2) - 1 / Math.sqrt(3);
  const plan: RoutePlan = {
    launch: { x: 0, y: 0 },
    impulses: [
      { id: 'transfer-burn', time: 1, vector: { x: -Math.sin(1) * first, y: Math.cos(1) * first } },
      {
        id: 'insertion-burn',
        time: 1 + Math.PI * Math.sqrt(1.5 ** 3),
        vector: { x: Math.sin(1) * second, y: -Math.cos(1) * second },
      },
    ],
  };
  return { stage, plan };
}
