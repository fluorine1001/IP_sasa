/** Move existing controls, retaining handlers and IDs; no extra render/worker loop. */
import { markerGuides, markerDiagram, markerGuide } from './marker-guide';
import type { GoalMarker } from '../stages/goal-marker';
import { commandMenu } from './command-menu';
export function organizeEditor(root: HTMLElement, signal: AbortSignal) {
  const top = root.querySelector<HTMLElement>('.editor-top')!,
    palette = root.querySelector<HTMLElement>('.editor-palette')!;
  const menu = (label: string, ids: string[], destination: HTMLElement) => {
    const controls = ids
      .map((id) => root.querySelector<HTMLElement>('#' + id))
      .filter((node) => node !== null);
    commandMenu(label, controls, destination, signal);
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
  const help = document.createElement('dialog');
  help.className = 'workshop-dialog marker-help';
  help.innerHTML =
    '<header><h2>판정 도구 안내</h2><button data-help-close aria-label="판정 도구 안내 닫기">×</button></header><p>위치와 궤도는 다른 판정입니다. 원하는 결과를 검사하는 표식만 배치하고 필요할 때 연결하세요.</p><div class="marker-help-grid">' +
    Object.keys(markerGuides)
      .map((k) => markerGuide(k as GoalMarker['kind']))
      .join('') +
    '</div><section class="guide-combinations"><h3>연결하는 경우</h3><p>랑데부: 영역 + 상대속도를 ‘동시 충족’으로 연결합니다.</p><p>원 궤도: ‘궤도’ 하나를 원으로 그리고 ‘실제 한 바퀴 내내’를 선택합니다. ‘영역 + 시간’으로 대신하지 않습니다.</p><p>착륙: ‘착륙’ 표식의 기준 천체와 회수할 기체를 선택합니다.</p></section>';
  root.append(help);
  const guideButton = document.createElement('button');
  guideButton.id = 'marker-help';
  guideButton.textContent = '? 판정 도구 안내';
  palette.prepend(guideButton);
  guideButton.onclick = () => help.showModal();
  help.querySelector<HTMLButtonElement>('[data-help-close]')!.onclick = () => help.close();
  help.addEventListener(
    'click',
    (e) => {
      if (e.target === help) help.close();
    },
    { signal },
  );
  for (const [kind, g] of Object.entries(markerGuides)) {
    const button = palette.querySelector<HTMLButtonElement>(`[data-tool="marker:${kind}"]`)!;
    button.innerHTML =
      markerDiagram(kind as GoalMarker['kind']) + `<span>${g.title}<small>${g.role}</small></span>`;
    button.classList.add('marker-tool');
    button.title = g.pass;
    button.setAttribute('aria-label', g.title + ' 판정 배치');
  }
  const spawn = palette.querySelector<HTMLElement>('[data-tool="spawn"]');
  if (spawn) spawn.textContent = '＋ 로켓·출발 위치';
  const topBadge = top.querySelector('.badge');
  if (topBadge) topBadge.textContent = '제작소';
  const rules = palette.querySelector<HTMLElement>('#stage-properties');
  if (rules) top.append(rules);
  signal.addEventListener('abort', () => help.remove(), { once: true });
  palette.querySelectorAll('.badge, hr').forEach((node) => node.remove());
}
