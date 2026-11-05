import { eventSound } from '../audio/engine';
/** Compatibility wrapper for older call sites; new code uses src/audio directly. */
export function sound(_volume: number, kind: 'click' | 'launch' | 'win' | 'fail' = 'click') {
  eventSound(kind === 'click' ? 'countdown' : kind === 'launch' ? 'liftoff' : kind);
}
