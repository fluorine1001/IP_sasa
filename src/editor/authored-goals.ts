import { goalReferences } from '../world/goals';
import type { Stage, Goal } from '../world/types';
/** An untouched new-stage sample must not silently add requirements to the author's mission. */
export function installAuthoredGoals(stage: Stage, added: Goal[]) {
  const referenced = new Set(
    [...stage.goals, ...added].flatMap((g) => [...g.dependsOn, ...goalReferences(g.condition)]),
  );
  stage.goals = stage.goals.filter((g) => {
    if (!g.editorSeed || referenced.has(g.id)) return true;
    const { editorSeed, ...authored } = g;
    return JSON.stringify(authored) !== editorSeed;
  });
  stage.goals.push(...added);
}
