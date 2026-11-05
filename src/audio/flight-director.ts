/* Turns what the craft is doing into sound. It watches the visible flight (live run or
 * replay frame) once per animation frame and compares it with the previous look, so the
 * physics code never calls audio. Scrubbing a replay resynchronises silently. */
import type { Stage, Run } from '../world/types';
import type { FlightFrame } from '../world/replay';
import { atmosphericState } from '../world/rocket';
import { ambienceVoice, engineVoice, eventSound } from './engine';

type View = Run | FlightFrame;
type Look = {
  time: number;
  throttle: number;
  partIndex: number;
  detached: Set<string>;
  used: number;
  landed: boolean;
  status: string;
  goals: number;
  turning: string;
  lowFuel: boolean;
};

function look(stage: Stage, v: View): Look {
  const r = v.rocket;
  const fuelLeft = r ? (r.fuel[r.partIndex] ?? 0) : 1;
  const fuelFull = stage.rocket?.parts[r?.partIndex ?? 0]?.fuelMass ?? 1;
  return {
    time: v.time,
    throttle: r && r.airborne !== false ? r.throttle : (r?.throttle ?? 0),
    partIndex: r?.partIndex ?? 0,
    detached: new Set((v.detached ?? []).map((d) => d.id)),
    used: v.used ?? 0,
    landed: !!v.landed,
    status: v.status,
    goals: Object.values(v.goals ?? {}).filter((g) => g.complete).length,
    turning: r?.targetDirection
      ? `${r.targetDirection.x.toFixed(2)},${r.targetDirection.y.toFixed(2)}`
      : '',
    lowFuel: !!r && r.throttle > 0 && fuelLeft / Math.max(1e-9, fuelFull) < 0.15,
  };
}

export function flightSoundDirector(stage: Stage) {
  let prev: Look | undefined;
  return {
    /** quiet: the view jumped (scrub, seek) or should not narrate. */
    observe(view: View | undefined, o: { audible: boolean; ambient: boolean }) {
      if (!view) {
        engineVoice(0);
        ambienceVoice(o.ambient);
        prev = undefined;
        return;
      }
      const now = look(stage, view);
      const air = atmosphericState(stage, view.position, view.velocity, view.time);
      const airNorm = Math.min(1, air.density / 0.5);
      const flying = view.status === 'running' || view.status === 'impact';
      engineVoice(o.audible && flying ? now.throttle : 0, airNorm);
      ambienceVoice(o.ambient, airNorm, air.speed);
      const jumped = !prev || now.time < prev.time - 1e-6 || now.time - prev.time > 0.75;
      if (o.audible && prev && !jumped) {
        if (now.throttle > 0 && prev.throttle === 0) eventSound('ignite', 0.6 + now.throttle * 0.6);
        if (now.throttle === 0 && prev.throttle > 0 && now.partIndex === prev.partIndex)
          eventSound('cutoff');
        if (now.partIndex > prev.partIndex) eventSound('separate');
        for (const id of now.detached)
          if (!prev.detached.has(id) && stage.rocket?.payloads?.some((p) => p.id === id))
            eventSound('deploy');
        if (now.used > prev.used + 1e-9)
          eventSound('push', Math.min(1.4, (now.used - prev.used) * 4 + 0.5));
        if (now.turning && now.turning !== prev.turning) eventSound('turn');
        if (now.landed && !prev.landed) eventSound('touchdown');
        if (now.goals > prev.goals && now.status === 'running') eventSound('goal');
        if (now.lowFuel && !prev.lowFuel) eventSound('warn');
        const crashed =
          (now.status === 'impact' && prev.status !== 'impact') ||
          (now.status === 'failed' &&
            prev.status === 'running' &&
            /충돌|충격|추락|부서|파손/.test(view.reason ?? ''));
        if (crashed) eventSound('crash');
      }
      prev = now;
    },
    silence() {
      engineVoice(0);
      ambienceVoice(false);
      prev = undefined;
    },
  };
}
