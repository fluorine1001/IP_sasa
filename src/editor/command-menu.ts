/** Command menus escape toolbar/scroll clipping through the browser top layer.
 * Property disclosures stay in their own panels; no per-frame layout work. */
export function commandMenu(
  label: string,
  controls: HTMLElement[],
  destination: HTMLElement,
  signal: AbortSignal,
) {
  const wrapper = document.createElement('div');
  wrapper.className = 'editor-menu';
  const button = document.createElement('button');
  button.className = 'editor-menu-trigger';
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-expanded', 'false');
  const popup = document.createElement('section');
  popup.className = 'editor-menu-content';
  popup.id = `editor-menu-${controls[0].id}`;
  popup.setAttribute('popover', 'auto');
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', label);
  button.setAttribute('popovertarget', popup.id);
  button.setAttribute('aria-controls', popup.id);
  const header = document.createElement('header');
  const title = document.createElement('strong');
  title.textContent = label === '스테이지 파일' ? '파일 작업' : '편집 작업';
  const close = document.createElement('button');
  close.className = 'editor-menu-close';
  close.textContent = '×';
  close.setAttribute('aria-label', label + ' 닫기');
  close.setAttribute('popovertarget', popup.id);
  close.setAttribute('popovertargetaction', 'hide');
  header.append(title, close);
  popup.append(header);
  for (const control of controls) {
    if (control.tagName === 'SELECT') {
      const field = document.createElement('label');
      field.textContent = '스테이지 불러오기';
      field.append(control);
      popup.append(field);
    } else popup.append(control);
  }
  wrapper.append(button, popup);
  destination.append(wrapper);
  const opened = () => popup.matches(':popover-open');
  function position() {
    if (!opened()) return;
    const anchor = button.getBoundingClientRect(),
      width = document.documentElement.clientWidth,
      height = window.innerHeight;
    if (anchor.bottom <= 0 || anchor.top >= height) {
      popup.hidePopover();
      return;
    }
    popup.style.maxHeight = Math.max(1, height - 24) + 'px';
    const box = popup.getBoundingClientRect();
    const bar = destination.getBoundingClientRect(),
      lower = Math.max(anchor.bottom, bar.bottom),
      upper = Math.min(anchor.top, bar.top);
    const below = Math.max(1, height - lower - 20),
      above = Math.max(1, upper - 20),
      downward = box.height <= below || below >= above;
    popup.style.maxHeight = Math.min(480, downward ? below : above) + 'px';
    const actualHeight = popup.getBoundingClientRect().height;
    popup.style.left = Math.max(12, Math.min(width - box.width - 12, anchor.left)) + 'px';
    popup.style.top = Math.max(12, downward ? lower + 8 : upper - actualHeight - 8) + 'px';
  }
  button.addEventListener(
    'click',
    () =>
      queueMicrotask(() => {
        if (!signal.aborted && opened()) {
          popup.scrollTop = 0;
          position();
        }
      }),
    { signal },
  );
  popup.addEventListener(
    'toggle',
    () => {
      button.setAttribute('aria-expanded', String(opened()));
      if (opened()) position();
    },
    {
      signal,
    },
  );
  popup.addEventListener(
    'click',
    (event) => {
      if ((event.target as Element).closest('button') && opened()) popup.hidePopover();
    },
    { signal },
  );
  wrapper.addEventListener(
    'keydown',
    (event) => {
      // Dismiss the menu without also cancelling the editor's current tool.
      if (opened() && event.key === 'Escape') event.stopPropagation();
    },
    { signal },
  );
  window.addEventListener('resize', position, { signal });
  document.addEventListener(
    'scroll',
    (event) => {
      if (!(event.target instanceof Node) || !popup.contains(event.target)) position();
    },
    { signal, capture: true, passive: true },
  );
  signal.addEventListener(
    'abort',
    () => {
      if (opened()) popup.hidePopover();
    },
    { once: true },
  );
}
