import { blankStage } from '../../src/stages/factory';
import { createMarker, compileMarker } from '../../src/stages/goal-marker';
import { syncLaunch } from '../../src/world/launch';

/** Physical parameters of the unsaved editor scene exported on 2026-10-15.
 * IDs/authoring labels are regenerated; no successful plan is supplied. */
export function stalledSurfaceOrbit() {
  const s = blankStage();
  s.referencePlans = [];
  s.published = false;
  s.bodies[0].position = { x: -0.7, y: 0.5 };
  s.bodies[0].radius = 0.6;
  s.bodies[0].mu = 1;
  s.launchBodyId = s.bodies[0].id;
  s.launchAngle = -0.13503680324254888;
  s.rules.launchLimit = 1.1;
  s.rules.maneuverBudget = 0.1;
  s.rules.maxTime = 40;
  s.rules.timelineDuration = 20;
  s.rules.worldRadius = 14;
  s.rules.commandLimits = { ignite: 6, stop: 6, turn: 8, separate: 3, push: 8 };
  syncLaunch(s);
  const g = createMarker(s, 'orbit', { x: 3.375524508112351, y: 0.5 });
  Object.assign(g.marker!, {
    radius: 4.075524508112351,
    minor: 4.075524508112351,
    width: 2.1894420529553384,
    angle: -2.8362523314881964,
    span: 'revolution',
  });
  Object.assign(g, compileMarker(s, g));
  s.goals = [g];
  return s;
}
