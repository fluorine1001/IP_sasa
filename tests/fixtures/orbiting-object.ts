import { blankStage } from '../../src/stages/factory';
import { createMarker, compileMarker } from '../../src/stages/goal-marker';
export function orbitObjectScene() {
  const s = blankStage();
  delete s.rocket;
  delete s.launchBodyId;
  s.published = false;
  s.bodies[0].radius = 0.2;
  s.spawn = { position: { x: 6, y: 6 }, velocity: { x: 0, y: 0 } };
  s.rules.launchLimit = 0;
  s.rules.maneuverBudget = 0;
  s.rules.maxTime = s.rules.timelineDuration = s.audit.timeLimit = 20;
  s.referencePlans = [];
  const goal = createMarker(s, 'orbit', { x: 1.2, y: 0 });
  Object.assign(goal.marker!, { radius: 1.2, minor: 0.9, width: 0.08, angle: 0.3 });
  Object.assign(goal, compileMarker(s, goal));
  s.goals = [goal];
  return s;
}
