let context: AudioContext | undefined;
export function sound(volume: number, kind: 'click' | 'launch' | 'win' | 'fail' = 'click') {
  if (!volume) return;
  try {
    context ??= new AudioContext();
    void context.resume();
    const oscillator = context.createOscillator(),
      gain = context.createGain(),
      t = context.currentTime;
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(
      kind === 'win' ? 480 : kind === 'fail' ? 160 : kind === 'launch' ? 100 : 380,
      t,
    );
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === 'win' ? 960 : kind === 'launch' ? 400 : 220,
      t + 0.16,
    );
    gain.gain.setValueAtTime(volume * 0.07, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(t);
    oscillator.stop(t + 0.21);
  } catch {
    /* Sound is optional. */
  }
}
