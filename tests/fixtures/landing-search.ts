import { blankStage, newBody } from '../../src/stages/factory';
import { compileOutcome } from '../../src/stages/outcomes';
/** Powered, finite-fuel transfer. No stored solution is supplied to the search. */
export function landingSearchStage() {
  const s = blankStage();
  s.bodies[0].name = '지구';
  s.bodies[0].mu = 0.025;
  const moon = newBody('moon');
  moon.position = { x: 2.8, y: 0 };
  moon.radius = 0.3;
  moon.mu = 0.002;
  s.bodies.push(moon);
  s.rocket!.parts = [s.rocket!.parts[0]];
  s.rocket!.parts[0].maxLandingSpeed = 0.24;
  s.rocket!.parts[0].ignitionLimit = 3;
  s.rules.maxTime = 24;
  s.rules.timelineDuration = 24;
  s.rules.commandLimits = { ignite: 1, stop: 2, turn: 1, separate: 0, push: 0, deploy: 0 };
  s.audit.timeLimit = 24;
  s.audit.samples = 16;
  Object.assign(
    s.goals[0],
    compileOutcome(s, { kind: 'recovery', targetId: moon.id, speed: 0.24, duration: 0.2 }),
  );
  s.goals[0].endTime = 24;
  return s;
}
