import type { Stage } from '../world/types';
/** Legacy fields are accepted on import but can no longer affect a flight.
 * Preserve every authored physical value; never generate a replacement world. */
export function fixedEnvironment(source: Stage): Stage {
  if (!Object.hasOwn(source, 'randomization') && !Object.hasOwn(source.rules ?? {}, 'attempts'))
    return source;
  const stage = { ...source, rules: { ...source.rules } };
  delete stage.randomization;
  delete stage.rules.attempts;
  return stage;
}
