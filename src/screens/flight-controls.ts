import { escape } from '../app/core';
const glyphs: Record<string, string> = {
  aim: '<path d="M5 19L19 5M9 5h10v10"/><circle cx="5" cy="19" r="2"/>',
  sensor: '<circle cx="12" cy="12" r="4"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5M5 5l3 3m8 8 3 3"/>',
  speed: '<path d="M3 18a9 9 0 1 1 18 0M12 14l5-6M5 18h14"/><circle cx="12" cy="14" r="2"/>',
  engine: '<path d="M8 3h8v10H8zM9 16l3 5 3-5M6 8H3m18 0h-3"/>',
  separate: '<path d="M9 1h6v6H9zM8 16h8v7H8zM5 10l-3 2 3 2m14-4 3 2-3 2M12 9v5"/>',
  add: '<path d="M12 4v16M4 12h16"/>',
  sliders:
    '<path d="M4 6h16M4 18h16"/><circle cx="9" cy="6" r="3"/><circle cx="16" cy="18" r="3"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  play: '<path d="M7 3l14 9-14 9z"/>',
  follow: '<circle cx="12" cy="12" r="5"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>',
  vehicle:
    '<path d="M3 7h16l-4-4m6 14H5l4 4"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="7" r="2"/>',
  records:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 8h4m-4 8h4m10-8h4m-4 8h4M10 8l5 4-5 4z"/>',
  replay: '<path d="M4 9a9 9 0 1 1 0 7M4 3v6h6M11 8l6 4-6 4z"/>',
  retry: '<path d="M4 9a9 9 0 1 1 0 7M4 3v6h6"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  close: '<path d="M5 5l14 14M19 5L5 19"/>',
  rocket:
    '<path d="M9 15l-4 4m4-11L3 9v6l6-2m7-4 5 6-6 1M9 15l-1-6C10 5 15 2 21 3c1 6-2 11-6 13z"/><circle cx="15" cy="9" r="2"/><path d="M4 17l-2 5 5-2"/>',
};
export function controlIcon(kind: string) {
  return (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    glyphs[kind] +
    '</svg>'
  );
}
export function controlButton(id: string, kind: string, label: string, extra = '') {
  return (
    '<button id="' +
    id +
    '" class="console-button ' +
    extra +
    '" aria-label="' +
    escape(label) +
    '" title="' +
    escape(label) +
    '" data-tip="' +
    escape(label) +
    '">' +
    controlIcon(kind) +
    '<span class="control-label">' +
    escape(label) +
    '</span></button>'
  );
}
export function setControl(
  root: HTMLElement,
  id: string,
  kind: string,
  label: string,
  pressed?: boolean,
) {
  const button = root.querySelector<HTMLButtonElement>('#' + id)!;
  if (button.dataset.label !== label || button.dataset.icon !== kind) {
    button.innerHTML =
      controlIcon(kind) + '<span class="control-label">' + escape(label) + '</span>';
    button.dataset.label = label;
    button.dataset.icon = kind;
    button.setAttribute('aria-label', label);
    button.title = label;
    button.dataset.tip = label;
  }
  if (pressed !== undefined) button.setAttribute('aria-pressed', String(pressed));
}
