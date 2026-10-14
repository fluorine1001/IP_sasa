/** Move existing controls, retaining handlers and IDs; no extra render/worker loop. */
export function organizeEditor(root: HTMLElement, signal: AbortSignal) {
  const top = root.querySelector<HTMLElement>('.editor-top')!,
    palette = root.querySelector<HTMLElement>('.editor-palette')!;
  const menu = (label: string, ids: string[], destination: HTMLElement) => {
    const details = document.createElement('details');
    details.className = 'editor-menu';
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    const content = document.createElement('div');
    content.className = 'editor-menu-content';
    details.append(content);
    for (const id of ids) {
      const node = root.querySelector<HTMLElement>('#' + id);
      if (node) content.append(node);
    }
    destination.append(details);
  };
  menu('스테이지 파일', ['stage-source', 'import-stage', 'export-stage'], top);
  menu(
    '편집',
    [
      'undo',
      'redo',
      'duplicate',
      'copy-selection',
      'paste-selection',
      'delete',
      'clear-references',
    ],
    top,
  );
  const group = (label: string, tools: string[], open = false) => {
    const details = document.createElement('details');
    details.className = 'palette-group';
    details.open = open;
    const summary = document.createElement('summary');
    summary.textContent = label;
    details.append(summary);
    for (const tool of tools) {
      const node = palette.querySelector<HTMLElement>(`[data-tool="${tool}"]`);
      if (node) details.append(node);
    }
    palette.append(details);
  };
  group('천체', ['planet', 'moon', 'star', 'black-hole', 'binary']);
  group('실제 비행 물체·착륙 지점', ['satellite', 'station', 'landing-site', 'debris', 'belt']);
  group(
    '판정 오브젝트',
    [
      'marker:area',
      'marker:orbit',
      'marker:velocity',
      'marker:surface',
      'marker:state',
      'marker:passage',
    ],
    true,
  );
  const manual = palette.querySelector<HTMLElement>('[data-tool="goal:condition"]');
  if (manual) {
    const details = document.createElement('details');
    details.innerHTML = '<summary>고급 조건 블록</summary>';
    details.append(manual);
    palette.append(details);
  }
  const markerPalette = palette.querySelector<HTMLElement>('.palette-group[open]');
  if (markerPalette)
    palette.insertBefore(markerPalette, palette.querySelector('[data-tool="sensor"]'));
  root.addEventListener(
    'pointerdown',
    (event) => {
      for (const menu of top.querySelectorAll<HTMLDetailsElement>('.editor-menu[open]'))
        if (!menu.contains(event.target as Node)) menu.open = false;
    },
    { signal },
  );
  palette.querySelectorAll('.badge, hr').forEach((node) => node.remove());
}
