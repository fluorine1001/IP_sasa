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
      'focus-selection',
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
  const nav = document.createElement('nav');
  nav.className = 'palette-tabs';
  nav.setAttribute('aria-label', '제작 도구 분류');
  nav.innerHTML =
    '<button data-palette-tab="world" aria-pressed="true">장면</button><button data-palette-tab="craft" aria-pressed="false">기체</button><button data-palette-tab="goals" aria-pressed="false">판정</button>';
  const panes = new Map<string, HTMLElement>();
  for (const id of ['world', 'craft', 'goals']) {
    const pane = document.createElement('section');
    pane.dataset.palettePane = id;
    pane.hidden = id !== 'world';
    palette.append(pane);
    panes.set(id, pane);
  }
  const groups = [...palette.querySelectorAll<HTMLElement>(':scope > details')];
  for (const group of groups) {
    const label = group.querySelector('summary')?.textContent ?? '';
    panes
      .get(
        label === '판정 오브젝트' || label.includes('조건') || label === '시작 예시'
          ? 'goals'
          : 'world',
      )!
      .append(group);
    if (label === '천체' || label === '실제 비행 물체·착륙 지점')
      (group as HTMLDetailsElement).open = true;
  }
  if (spawn) panes.get('craft')!.append(spawn);
  const craftHint = document.createElement('p');
  craftHint.className = 'palette-note';
  craftHint.textContent = '로켓을 놓고 선택하면 연료·추력·단 구성을 편집합니다.';
  panes.get('craft')!.append(craftHint);
  for (const name of ['sensor', 'select']) {
    const node = palette.querySelector<HTMLElement>(`[data-tool="${name}"]`);
    if (node) (name === 'select' ? palette : panes.get('world')!).prepend(node);
  }
  const compose = root.querySelector('#compose-goal');
  if (compose) panes.get('goals')!.append(compose);
  const snap = root.querySelector('#snap')?.closest('label');
  if (snap) panes.get('world')!.append(snap);
  palette.prepend(nav);
  guideButton.textContent = '? 도구 안내';
  palette.append(guideButton);
  const tree = document.createElement('section');
  tree.id = 'scene-list';
  palette.append(tree);
  nav.addEventListener(
    'click',
    (e) => {
      const button = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-palette-tab]');
      if (!button) return;
      for (const [id, pane] of panes) pane.hidden = id !== button.dataset.paletteTab;
      nav
        .querySelectorAll<HTMLButtonElement>('button')
        .forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      root.querySelector<HTMLButtonElement>('[data-tool="select"]')?.click();
    },
    { signal },
  );
  const hints: Record<string, string> = {
    planet: '중력을 가진 천체를 배치',
    moon: '작은 천체를 배치',
    star: '중심 별을 배치',
    'black-hole': '흡수 경계를 가진 천체',
    binary: '서로 중력을 주고받는 두 천체',
    satellite: '비행하는 위성',
    station: '랑데부 대상 정거장',
    debris: '충돌 가능한 비행 물체',
    belt: '소행성을 띠 모양으로 배치',
    'landing-site': '천체 표면의 착륙 지점',
  };
  for (const [id, hint] of Object.entries(hints)) {
    const node = palette.querySelector<HTMLButtonElement>(`[data-tool="${id}"]`);
    if (node) {
      node.title = hint;
      node.classList.add('scene-tool');
    }
  }
  top.querySelector<HTMLButtonElement>('#publish-stage')!.textContent = '게임에 공개';
  top.querySelector<HTMLButtonElement>('#open-library')!.textContent = '보관함';
  top.querySelector<HTMLButtonElement>('#new-stage')!.textContent = '＋ 새 문서';
  top.querySelector<HTMLButtonElement>('#test-stage')!.textContent = '▶ 시험 비행 · F5';
  top.querySelector<HTMLButtonElement>('#focus-selection')!.title = '선택한 오브젝트로 카메라 이동';
}

/** Keep one scene navigator and disclose alternate authoring systems only on demand. */
export function organizeInspector(root: HTMLElement) {
  const inspector = root.querySelector<HTMLElement>('#inspector')!,
    tree = root.querySelector('#scene-list');
  if (tree) {
    tree.replaceChildren();
    for (const d of [...inspector.querySelectorAll<HTMLDetailsElement>(':scope > details')]) {
      if (/^(장면 목록|목표 목록)/.test(d.querySelector('summary')?.textContent ?? '')) {
        d.open = true;
        tree.append(d);
      }
    }
  }
  const advanced = document.createElement('details');
  advanced.className = 'inspector-advanced';
  advanced.innerHTML = '<summary>고급 제작 도구</summary>';
  for (const d of [...inspector.querySelectorAll<HTMLDetailsElement>(':scope > details')]) {
    if (
      /^(시작 예시|개별 물리|고급 조건|선행 목표|관측·단서|설계 순서)/.test(
        d.querySelector('summary')?.textContent ?? '',
      )
    )
      advanced.append(d);
  }
  if (advanced.children.length > 1) inspector.append(advanced);
  inspector.querySelectorAll('.marker-coverage > span:not(.tested)').forEach((e) => e.remove());
  const badge = inspector.querySelector('.badge');
  if (badge) {
    const hint = document.createElement('p');
    hint.className = 'inspector-hint';
    hint.textContent = badge.textContent?.includes('선택')
      ? '지도에서 드래그 · 노란 손잡이로 형태 조절'
      : '장면에서 오브젝트를 선택하면 여기에 편집 항목이 나타납니다.';
    badge.after(hint);
  }
}
