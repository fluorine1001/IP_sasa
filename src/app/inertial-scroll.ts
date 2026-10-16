export const scrollFriction = 10;
export function wheelImpulse(velocity: number, delta: number) {
  if (velocity * delta < 0) velocity = 0;
  return Math.max(-2600, Math.min(2600, velocity + Math.max(-120, Math.min(120, delta)) * 5));
}
export function coastScroll(velocity: number, dt: number) {
  const decay = Math.exp(-scrollFriction * Math.max(0, dt));
  return { distance: (velocity / scrollFriction) * (1 - decay), velocity: velocity * decay };
}
/** One delegated controller: wheel over buttons/text reaches the owning viewport. */
export function inertialScroll(root: HTMLElement) {
  const states = new Map<HTMLElement, number>();
  const fractions = new Map<HTMLElement, number>();
  let frame = 0,
    previous = 0;
  const canScroll = (element: HTMLElement, delta: number) =>
    /auto|scroll/.test(getComputedStyle(element).overflowY) &&
    element.scrollHeight > element.clientHeight + 1 &&
    (delta > 0
      ? element.scrollTop < element.scrollHeight - element.clientHeight - 1
      : element.scrollTop > 0);
  function animate(now: number) {
    const dt = Math.min(0.05, (now - previous) / 1000);
    previous = now;
    for (const [element, velocity] of states) {
      if (!element.isConnected || Math.abs(velocity) < 1) {
        states.delete(element);
        fractions.delete(element);
        continue;
      }
      const next = coastScroll(velocity, dt),
        total = (fractions.get(element) ?? 0) + next.distance;
      const pixels = Math.trunc(total);
      fractions.set(element, total - pixels);
      element.scrollTop += pixels;
      if (
        (next.velocity < 0 && element.scrollTop <= 0) ||
        (next.velocity > 0 && element.scrollTop >= element.scrollHeight - element.clientHeight - 1)
      ) {
        states.delete(element);
        fractions.delete(element);
      } else states.set(element, next.velocity);
    }
    frame = states.size ? requestAnimationFrame(animate) : 0;
  }
  root.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey || event.defaultPrevented || !event.deltaY) return;
      let element =
        event.target instanceof HTMLElement ? event.target : (event.target as Node).parentElement;
      const origin = element;
      while (element && element !== root && !canScroll(element, event.deltaY))
        element = element.parentElement;
      if (!element || element === root) {
        const host = origin?.closest<HTMLElement>('[data-scroll-host]');
        element = host?.querySelector<HTMLElement>(host.dataset.scrollHost!) ?? null;
        if (!element || !canScroll(element, event.deltaY)) return;
      }
      event.preventDefault();
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1);
      if (
        document.body.classList.contains('reduced-motion') ||
        matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        element.scrollTop += Math.max(-45, Math.min(45, delta * 0.35));
        return;
      }
      states.set(element, wheelImpulse(states.get(element) ?? 0, delta));
      if (!frame) {
        previous = performance.now();
        frame = requestAnimationFrame(animate);
      }
    },
    { passive: false },
  );
  root.addEventListener('pointerdown', () => {
    states.clear();
    fractions.clear();
  });
}
