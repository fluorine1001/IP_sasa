import { execute, createRun, tick } from '../world/engine';
self.onmessage = (event) => {
  try {
    const stage = event.data.stage,
      horizon = stage.audit.timeLimit ?? stage.rules.maxTime;
    const run = event.data.video
      ? execute(stage, event.data.plan, true)
      : createRun(stage, event.data.plan);
    if (!event.data.video)
      while ((run.status === 'running' || run.status === 'impact') && run.time < horizon - 1e-8) {
        tick(run, stage, Math.min(0.1, horizon - run.time), stage.objects, true);
        // Paths need real observed points, not thousands of video snapshots.
        run.frames = [];
      }
    const stride = Math.max(1, Math.ceil(run.trail.length / 512));
    const trail = run.trail.filter((_, i) => i % stride === 0 || i === run.trail.length - 1);
    self.postMessage({
      trail: trail.map(({ position, velocity, time }) => ({ position, velocity, time })),
      ...(event.data.video ? { run } : {}),
    });
  } catch {
    self.postMessage({ trail: [] });
  }
};
