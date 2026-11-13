import { exploreMethods, methodSkills, type VerifiedMethod } from './solutions';
import { practicesFocus } from './mastery';
import type { RoutePlan, Stage } from '../../world/types';

const round = (x: number) => Math.round(x * 10) / 10;
function* combinationPlans(
  stage: Stage,
  methods: VerifiedMethod[],
  index: number,
): Generator<RoutePlan> {
  if (index === 2) {
    for (const source of methods.filter(
      (m) => m.coarse && m.skills.includes('출력 조절') && !m.skills.includes('재점화'),
    )) {
      const base = source.plan.engineCommands!.find((c) => c.direction)!,
        stop = source.plan.engineCommands!.find((c) => c.throttle === 0)!;
      for (const offset of [-30, 30, -20, 20, -10, 10, -40, 40])
        for (const fraction of [0.25, 0.5, 0.75]) {
          const plan = structuredClone(source.plan),
            at = round(stop.time * fraction);
          if (at <= 0 || at >= stop.time) continue;
          const a = Math.atan2(base.direction!.y, base.direction!.x) + (offset * Math.PI) / 180;
          plan.engineCommands!.find((c) => c.id === base.id)!.direction = {
            x: Math.cos(a),
            y: Math.sin(a),
          };
          plan.engineCommands!.push({
            id: 'practice-turn',
            time: at,
            actorId: 'craft',
            direction: { ...base.direction! },
          });
          plan.engineCommands!.sort((a, b) => a.time - b.time);
          yield plan;
        }
    }
  }
  if (index === 3) {
    for (const source of methods.filter(
      (m) => m.coarse && m.skills.includes('재점화') && m.skills.includes('중간 방향 수정'),
    )) {
      const stop = source.plan.engineCommands!.find((c) => c.throttle === 0)!.time,
        power = Math.hypot(source.plan.launch.x, source.plan.launch.y) / stage.rules.launchLimit;
      for (const low of [0.1, 0.2, 0.3, 0.4])
        for (const high of [0.1, 0.2, 0.3])
          for (const fraction of [0.3, 0.5, 0.7]) {
            const at = round(stop * fraction);
            if (power - low < 0.2 || power + high > 1 || at <= 0 || at >= stop) continue;
            const plan = structuredClone(source.plan);
            plan.launch.x *= (power - low) / power;
            plan.launch.y *= (power - low) / power;
            plan.engineCommands!.push({
              id: 'practice-power',
              time: at,
              actorId: 'craft',
              throttle: round(power + high),
            });
            plan.engineCommands!.sort((a, b) => a.time - b.time);
            yield plan;
          }
    }
  }
}
/** Additional combinations use the same omission checks and actual engine as the simpler methods. */
export function* completeMasteryMethods(stage: Stage, input: VerifiedMethod[], index: number) {
  const methods = [...input];
  let checked = 0,
    attempted = 0;
  if (!methods.some((m) => practicesFocus(m, index)))
    for (const plan of combinationPlans(stage, methods, index)) {
      if (++attempted > 100) break;
      let result;
      for (const step of exploreMethods(stage, [plan], 0)) result = step;
      checked += result!.checked;
      const method = result!.methods[0];
      if (method && practicesFocus(method, index)) {
        method.label =
          index === 2 ? '출력 조절을 활용하며 중간 회전' : '출력 조절·중간 회전을 활용하며 재점화';
        method.skills = methodSkills(method.plan);
        methods.push(method);
        yield { methods, checked };
        return;
      }
      if (attempted % 8 === 0) yield { methods, checked };
    }
  yield { methods, checked };
}
