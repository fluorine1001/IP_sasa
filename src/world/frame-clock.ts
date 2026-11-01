/** Render time is accumulated; physics receives whole quanta only. A pause
 * discards pending render time, so resuming never fast-forwards unseen flight. */
export class FrameClock {
  private pending = 0;
  reset() {
    this.pending = 0;
  }
  advance(seconds: number, step: number, update: (dt: number) => boolean | void) {
    if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isFinite(step) || step <= 0) return;
    this.pending += seconds;
    while (this.pending + 1e-10 >= step) {
      this.pending = Math.max(0, this.pending - step);
      if (update(step) === false) {
        this.reset();
        break;
      }
    }
  }
}
