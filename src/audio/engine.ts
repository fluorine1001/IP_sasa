/* Apollo sound engine: every sound is synthesised with Web Audio at run time.
 * Buses: master → compressor → speakers; sfx, ui and ambience feed master; a shared
 * synthetic room (convolver) gives events a tail. No audio files are shipped.
 *
 * The AudioContext is created lazily on the first user gesture (browser autoplay
 * rules) and suspended while the page is hidden. Every public call is safe to make
 * before that and simply does nothing. */

export type Volumes = { master: number; sfx: number; ui: number; ambience: number };
export type UiSound =
  | 'click'
  | 'hover'
  | 'toggle'
  | 'confirm'
  | 'back'
  | 'open'
  | 'close'
  | 'place'
  | 'move'
  | 'remove'
  | 'error'
  | 'tick';
export type EventSound =
  | 'ignite'
  | 'cutoff'
  | 'separate'
  | 'deploy'
  | 'push'
  | 'turn'
  | 'touchdown'
  | 'crash'
  | 'goal'
  | 'win'
  | 'fail'
  | 'countdown'
  | 'liftoff'
  | 'warn'
  | 'medal';

type Graph = {
  ctx: AudioContext;
  master: GainNode;
  sfx: GainNode;
  ui: GainNode;
  ambience: GainNode;
  room: GainNode;
  noise: AudioBuffer;
  engine?: EngineVoice;
  drone?: DroneVoice;
};
type EngineVoice = {
  gain: GainNode;
  roar: BiquadFilterNode;
  rumble: GainNode;
  crackle: GainNode;
  stop: () => void;
};
type DroneVoice = {
  gain: GainNode;
  wind: GainNode;
  windFilter: BiquadFilterNode;
  stop: () => void;
};

let graph: Graph | undefined;
let volumes: Volumes = { master: 0.8, sfx: 0.8, ui: 0.6, ambience: 0.5 };
let unlocked = false;
let lastUi = 0;

function build(): Graph | undefined {
  if (graph) return graph;
  if (!unlocked || typeof AudioContext === 'undefined') return undefined;
  try {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.2;
    const master = ctx.createGain();
    master.connect(compressor).connect(ctx.destination);
    const bus = () => {
      const g = ctx.createGain();
      g.connect(master);
      return g;
    };
    const sfx = bus(),
      ui = bus(),
      ambience = bus();
    // A short synthetic room: decaying stereo noise as an impulse response.
    const convolver = ctx.createConvolver();
    const length = Math.floor(ctx.sampleRate * 1.8);
    const ir = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const data = ir.getChannelData(c);
      for (let i = 0; i < length; i++)
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2);
    }
    convolver.buffer = ir;
    const room = ctx.createGain();
    room.gain.value = 0.22;
    room.connect(convolver).connect(master);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    graph = { ctx, master, sfx, ui, ambience, room, noise };
    applyVolumes();
    document.addEventListener('visibilitychange', () => {
      if (!graph) return;
      void (document.hidden ? graph.ctx.suspend() : graph.ctx.resume());
    });
    return graph;
  } catch {
    return undefined;
  }
}

function applyVolumes() {
  if (!graph) return;
  const t = graph.ctx.currentTime;
  const curve = (v: number) => Math.max(0, Math.min(1, v)) ** 1.6; // perceptual taper
  graph.master.gain.setTargetAtTime(curve(volumes.master), t, 0.03);
  graph.sfx.gain.setTargetAtTime(curve(volumes.sfx), t, 0.03);
  graph.ui.gain.setTargetAtTime(curve(volumes.ui) * 0.8, t, 0.03);
  graph.ambience.gain.setTargetAtTime(curve(volumes.ambience) * 0.6, t, 0.03);
}

/** Call once at start-up: the first pointer or key press anywhere unlocks audio. */
export function installAudio(initial: Volumes) {
  volumes = { ...initial };
  const unlock = () => {
    unlocked = true;
    const g = build();
    void g?.ctx.resume();
  };
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
}
export function setVolumes(next: Volumes) {
  volumes = { ...next };
  applyVolumes();
}

/* ---------- building blocks ---------- */
type Env = { a?: number; d: number; peak: number; at?: number };
function envelope(g: Graph, env: Env, dest: AudioNode, room = 0) {
  const gain = g.ctx.createGain();
  const t = (env.at ?? g.ctx.currentTime) + 0.001;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(env.peak, t + (env.a ?? 0.004));
  gain.gain.exponentialRampToValueAtTime(0.0001, t + (env.a ?? 0.004) + env.d);
  gain.connect(dest);
  if (room) {
    const send = g.ctx.createGain();
    send.gain.value = room;
    gain.connect(send).connect(g.room);
  }
  return { gain, t, end: t + (env.a ?? 0.004) + env.d + 0.05 };
}
function tone(
  g: Graph,
  dest: AudioNode,
  o: {
    type?: OscillatorType;
    f: number;
    to?: number;
    d: number;
    peak: number;
    a?: number;
    at?: number;
    room?: number;
    detune?: number;
  },
) {
  const env = envelope(g, { a: o.a, d: o.d, peak: o.peak, at: o.at }, dest, o.room);
  const osc = g.ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f, env.t);
  if (o.detune) osc.detune.value = o.detune;
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, env.t + o.d);
  osc.connect(env.gain);
  osc.start(env.t);
  osc.stop(env.end);
}
function hiss(
  g: Graph,
  dest: AudioNode,
  o: {
    type: BiquadFilterType;
    f: number;
    to?: number;
    q?: number;
    d: number;
    peak: number;
    a?: number;
    at?: number;
    room?: number;
  },
) {
  const env = envelope(g, { a: o.a, d: o.d, peak: o.peak, at: o.at }, dest, o.room);
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  src.loop = true;
  const filter = g.ctx.createBiquadFilter();
  filter.type = o.type;
  filter.Q.value = o.q ?? 0.8;
  filter.frequency.setValueAtTime(o.f, env.t);
  if (o.to) filter.frequency.exponentialRampToValueAtTime(o.to, env.t + o.d);
  src.connect(filter).connect(env.gain);
  src.start(env.t, Math.random() * 1.5);
  src.stop(env.end);
}

/* ---------- interface ---------- */
export function uiSound(kind: UiSound) {
  const g = build();
  if (!g) return;
  const now = g.ctx.currentTime;
  // Debounce: a burst of identical UI events (hover sweeps) must not machine-gun.
  if (kind === 'hover' && now - lastUi < 0.05) return;
  lastUi = now;
  const bus = g.ui;
  switch (kind) {
    case 'hover':
      return tone(g, bus, { type: 'sine', f: 2400, d: 0.03, peak: 0.05 });
    case 'click':
    case 'tick':
      tone(g, bus, {
        type: 'triangle',
        f: 1500,
        to: 900,
        d: 0.045,
        peak: kind === 'tick' ? 0.1 : 0.22,
      });
      return hiss(g, bus, { type: 'highpass', f: 3500, d: 0.02, peak: 0.08 });
    case 'toggle':
      tone(g, bus, { type: 'square', f: 900, d: 0.03, peak: 0.06 });
      return tone(g, bus, { type: 'square', f: 1350, d: 0.03, peak: 0.06, at: now + 0.05 });
    case 'confirm':
      tone(g, bus, { type: 'triangle', f: 660, d: 0.09, peak: 0.2 });
      return tone(g, bus, {
        type: 'triangle',
        f: 990,
        d: 0.16,
        peak: 0.2,
        at: now + 0.07,
        room: 0.3,
      });
    case 'back':
      tone(g, bus, { type: 'triangle', f: 760, d: 0.08, peak: 0.16 });
      return tone(g, bus, { type: 'triangle', f: 520, d: 0.12, peak: 0.16, at: now + 0.06 });
    case 'open':
      return hiss(g, bus, { type: 'bandpass', f: 600, to: 2600, q: 2, d: 0.14, peak: 0.12 });
    case 'close':
      return hiss(g, bus, { type: 'bandpass', f: 2400, to: 500, q: 2, d: 0.12, peak: 0.1 });
    case 'place':
      tone(g, bus, { type: 'sine', f: 520, to: 780, d: 0.07, peak: 0.25 });
      return tone(g, bus, { type: 'triangle', f: 1560, d: 0.05, peak: 0.06 });
    case 'move':
      return tone(g, bus, { type: 'sine', f: 1100, d: 0.025, peak: 0.06 });
    case 'remove':
      return tone(g, bus, { type: 'sine', f: 600, to: 300, d: 0.1, peak: 0.22 });
    case 'error':
      tone(g, bus, { type: 'square', f: 150, d: 0.09, peak: 0.08 });
      return tone(g, bus, { type: 'square', f: 140, d: 0.12, peak: 0.08, at: now + 0.11 });
  }
}

/* ---------- flight events ---------- */
export function eventSound(kind: EventSound, intensity = 1) {
  const g = build();
  if (!g) return;
  const bus = g.sfx,
    now = g.ctx.currentTime,
    k = Math.max(0.2, Math.min(1.5, intensity));
  switch (kind) {
    case 'ignite':
      hiss(g, bus, { type: 'lowpass', f: 4000, to: 500, d: 0.35, peak: 0.5 * k, room: 0.4 });
      tone(g, bus, { type: 'sine', f: 120, to: 45, d: 0.35, peak: 0.6 * k });
      return;
    case 'cutoff':
      hiss(g, bus, { type: 'lowpass', f: 1200, to: 120, d: 0.4, peak: 0.25 });
      tone(g, bus, { type: 'triangle', f: 220, to: 90, d: 0.12, peak: 0.12 });
      return;
    case 'separate':
      // Pyro bolt crack, then a metallic clang of inharmonic partials, then a low thump.
      hiss(g, bus, { type: 'highpass', f: 2500, d: 0.06, peak: 0.6, room: 0.5 });
      for (const [f, p] of [
        [313, 0.18],
        [507, 0.14],
        [871, 0.1],
        [1293, 0.07],
      ] as const)
        tone(g, bus, { type: 'triangle', f, d: 0.6, peak: p, at: now + 0.01, room: 0.6 });
      tone(g, bus, { type: 'sine', f: 90, to: 40, d: 0.3, peak: 0.55 });
      return;
    case 'deploy':
      tone(g, bus, { type: 'sine', f: 1200, to: 320, d: 0.22, peak: 0.25, room: 0.4 });
      hiss(g, bus, { type: 'bandpass', f: 3000, q: 3, d: 0.05, peak: 0.25 });
      tone(g, bus, { type: 'triangle', f: 1760, d: 0.25, peak: 0.08, at: now + 0.12, room: 0.6 });
      return;
    case 'push':
      hiss(g, bus, {
        type: 'bandpass',
        f: 3200,
        to: 1800,
        q: 1.4,
        a: 0.01,
        d: 0.22 * k + 0.08,
        peak: 0.45,
      });
      tone(g, bus, { type: 'sine', f: 180, to: 110, d: 0.12, peak: 0.15 });
      return;
    case 'turn':
      hiss(g, bus, { type: 'bandpass', f: 4200, q: 2, d: 0.05, peak: 0.18 });
      hiss(g, bus, { type: 'bandpass', f: 3800, q: 2, d: 0.05, peak: 0.14, at: now + 0.09 });
      return;
    case 'touchdown':
      tone(g, bus, { type: 'sine', f: 95, to: 38, d: 0.35, peak: 0.7 * k });
      hiss(g, bus, { type: 'lowpass', f: 900, to: 200, d: 0.6, peak: 0.25 * k, room: 0.3 });
      tone(g, bus, { type: 'triangle', f: 410, d: 0.15, peak: 0.08, at: now + 0.02 });
      return;
    case 'crash': {
      hiss(g, bus, { type: 'lowpass', f: 2600, to: 90, a: 0.005, d: 1.8, peak: 0.9, room: 0.7 });
      tone(g, bus, { type: 'sine', f: 70, to: 28, d: 1.2, peak: 0.9 });
      tone(g, bus, { type: 'sawtooth', f: 55, to: 30, d: 0.5, peak: 0.25 });
      for (let i = 0; i < 6; i++)
        tone(g, bus, {
          type: 'triangle',
          f: 300 + Math.random() * 900,
          d: 0.08,
          peak: 0.06,
          at: now + 0.25 + i * (0.08 + Math.random() * 0.12),
          room: 0.5,
        });
      return;
    }
    case 'goal':
      tone(g, bus, { type: 'sine', f: 1318.5, d: 0.7, peak: 0.25, room: 0.6 });
      tone(g, bus, { type: 'sine', f: 1975.5, d: 0.5, peak: 0.1, room: 0.6 });
      return;
    case 'win': {
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        tone(g, bus, {
          type: 'triangle',
          f,
          d: 0.5 + i * 0.1,
          peak: 0.22,
          at: now + i * 0.11,
          room: 0.6,
        });
        tone(g, bus, { type: 'sine', f: f * 2, d: 0.3, peak: 0.05, at: now + i * 0.11 });
      });
      tone(g, bus, { type: 'sine', f: 261.63, d: 1.4, peak: 0.25, at: now + 0.33, room: 0.6 });
      return;
    }
    case 'fail':
      tone(g, bus, { type: 'triangle', f: 392, to: 370, d: 0.3, peak: 0.2, room: 0.4 });
      tone(g, bus, {
        type: 'triangle',
        f: 311,
        to: 233,
        d: 0.7,
        peak: 0.2,
        at: now + 0.22,
        room: 0.5,
      });
      return;
    case 'countdown':
      return tone(g, bus, { type: 'square', f: 880, d: 0.08, peak: 0.07 });
    case 'liftoff':
      return tone(g, bus, { type: 'square', f: 1320, d: 0.35, peak: 0.07 });
    case 'warn':
      tone(g, bus, { type: 'square', f: 740, d: 0.1, peak: 0.06 });
      return tone(g, bus, { type: 'square', f: 554, d: 0.12, peak: 0.06, at: now + 0.13 });
    case 'medal':
      tone(g, bus, { type: 'sine', f: 1568, d: 0.4, peak: 0.18, room: 0.6 });
      return tone(g, bus, { type: 'sine', f: 2093, d: 0.6, peak: 0.14, at: now + 0.09, room: 0.6 });
  }
}

/* ---------- continuous voices ---------- */
/** Engine roar: throttle 0..1 (0 fades out), air 0..1 (thin air muffles the sound). */
export function engineVoice(throttle: number, air = 0) {
  const g = graph;
  if (!g) return;
  const t = g.ctx.currentTime;
  if (throttle <= 0.001) {
    if (g.engine) {
      g.engine.gain.gain.setTargetAtTime(0.0001, t, 0.08);
      const voice = g.engine;
      g.engine = undefined;
      setTimeout(voice.stop, 600);
    }
    return;
  }
  if (!g.engine) {
    const gain = g.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(g.sfx);
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const roar = g.ctx.createBiquadFilter();
    roar.type = 'lowpass';
    roar.Q.value = 0.6;
    src.connect(roar).connect(gain);
    const osc = g.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 38;
    const sub = g.ctx.createBiquadFilter();
    sub.type = 'lowpass';
    sub.frequency.value = 140;
    const rumble = g.ctx.createGain();
    osc.connect(sub).connect(rumble).connect(gain);
    // Crackle: band-limited noise amplitude-modulated by a fast random-ish LFO.
    const crackleSrc = g.ctx.createBufferSource();
    crackleSrc.buffer = g.noise;
    crackleSrc.loop = true;
    const band = g.ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.9;
    const crackle = g.ctx.createGain();
    const lfo = g.ctx.createOscillator();
    lfo.frequency.value = 23;
    const depth = g.ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(crackle.gain);
    crackleSrc.connect(band).connect(crackle).connect(gain);
    src.start(t, Math.random());
    crackleSrc.start(t, Math.random());
    osc.start(t);
    lfo.start(t);
    g.engine = {
      gain,
      roar,
      rumble,
      crackle,
      stop: () => {
        for (const n of [src, crackleSrc, osc, lfo])
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        gain.disconnect();
      },
    };
  }
  const e = g.engine;
  const level = 0.18 + 0.42 * throttle;
  e.gain.gain.setTargetAtTime(level, t, 0.06);
  // In vacuum the roar is a muffled hull rumble; in thick air it opens up.
  e.roar.frequency.setTargetAtTime(220 + throttle * (500 + 2200 * air), t, 0.08);
  e.rumble.gain.setTargetAtTime(0.55 + 0.4 * throttle, t, 0.08);
  e.crackle.gain.setTargetAtTime(0.05 + 0.25 * air * throttle, t, 0.08);
}

/** Background: a low space drone, plus wind while inside an atmosphere. */
export function ambienceVoice(on: boolean, air = 0, speed = 0) {
  const g = graph;
  if (!g) return;
  const t = g.ctx.currentTime;
  if (!on) {
    if (g.drone) {
      g.drone.gain.gain.setTargetAtTime(0.0001, t, 0.4);
      const voice = g.drone;
      g.drone = undefined;
      setTimeout(voice.stop, 2500);
    }
    return;
  }
  if (!g.drone) {
    const gain = g.ctx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(g.ambience);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const [f, p, rate] of [
      [55, 0.22, 0.05],
      [82.4, 0.12, 0.07],
      [110.3, 0.05, 0.11],
    ] as const) {
      const osc = g.ctx.createOscillator();
      osc.frequency.value = f;
      const level = g.ctx.createGain();
      level.gain.value = p;
      const lfo = g.ctx.createOscillator();
      lfo.frequency.value = rate;
      const lfoDepth = g.ctx.createGain();
      lfoDepth.gain.value = 3;
      lfo.connect(lfoDepth).connect(osc.detune);
      osc.connect(level).connect(gain);
      osc.start(t);
      lfo.start(t);
      nodes.push(osc, lfo);
    }
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    const windFilter = g.ctx.createBiquadFilter();
    windFilter.type = 'bandpass';
    windFilter.Q.value = 1.6;
    windFilter.frequency.value = 500;
    const wind = g.ctx.createGain();
    wind.gain.value = 0;
    src.connect(windFilter).connect(wind).connect(gain);
    src.start(t);
    nodes.push(src);
    g.drone = {
      gain,
      wind,
      windFilter,
      stop: () => {
        for (const n of nodes)
          try {
            n.stop();
          } catch {
            /* already stopped */
          }
        gain.disconnect();
      },
    };
  }
  g.drone.gain.gain.setTargetAtTime(0.5, t, 0.8);
  const gust = air * Math.min(1, speed * 3);
  g.drone.wind.gain.setTargetAtTime(0.5 * gust, t, 0.2);
  g.drone.windFilter.frequency.setTargetAtTime(300 + 1400 * gust, t, 0.3);
}

/** Wire hover/click sounds to every button in the app without touching each screen. */
export function installUiSounds(root: HTMLElement) {
  root.addEventListener(
    'pointerover',
    (e) => {
      const b = (e.target as HTMLElement).closest?.(
        'button, [role="button"], a[href], .stage-card',
      );
      const from = (e as PointerEvent).relatedTarget as Node | null;
      if (b && !(b as HTMLButtonElement).disabled && !(from && b.contains(from))) uiSound('hover');
    },
    { passive: true },
  );
  root.addEventListener(
    'click',
    (e) => {
      const el = e.target as HTMLElement;
      const b = el.closest?.('button, [role="button"], .stage-card, input[type="checkbox"]');
      if (!b || (b as HTMLButtonElement).disabled) return;
      const sound = (b as HTMLElement).dataset.sound as UiSound | undefined;
      if (sound) return uiSound(sound);
      if (b.matches('input[type="checkbox"]')) return uiSound('toggle');
      if (/^(exit|back|result-close|.*-close)$/.test(b.id) || b.classList.contains('back'))
        return uiSound('back');
      uiSound('click');
    },
    { capture: true },
  );
}
