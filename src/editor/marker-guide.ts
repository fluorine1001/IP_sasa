import type { GoalMarker } from '../stages/goal-marker';
export const markerGuides: Record<
  GoalMarker['kind'],
  { title: string; role: string; pass: string; fail: string; handles: string }
> = {
  area: {
    title: '영역',
    role: '어디에 있는지',
    pass: '그린 원의 안쪽 또는 바깥쪽에 위치',
    fail: '속도·궤도 모양은 검사하지 않음',
    handles: '원 중심과 테두리를 끌어 위치·크기 조절',
  },
  orbit: {
    title: '궤도',
    role: '어떤 궤도로 도는지',
    pass: '표시한 궤도 형태·크기를 지키며 실제 한 바퀴',
    fail: '같은 높이를 잠깐 지나거나 그 높이에 머무르기만 하면 불충족',
    handles: '긴 반경·짧은 반경·띠 폭을 끌어 조절',
  },
  velocity: {
    title: '상대속도',
    role: '얼마나·어느 방향으로 움직이는지',
    pass: '기준 대상에 대한 속도 화살표 끝이 허용 원 안에 위치',
    fail: '가까이 지나가도 상대속도가 크면 불충족',
    handles: '화살표 끝=요구 속도, 끝의 원=허용 차이',
  },
  surface: {
    title: '착륙',
    role: '어디에 어떻게 내려앉는지',
    pass: '선택 천체의 지정 지점에 안전한 속도·자세로 실제 접촉',
    fail: '지점을 스치거나 고속 충돌하면 불충족',
    handles: '지점 원=착륙 위치, 부채꼴=허용 자세',
  },
  state: {
    title: '물리 상태',
    role: '어떤 물리 상태인지',
    pass: '선택한 실제 물리량이 색칠한 범위에 위치',
    fail: '다른 상태·속성을 자동으로 추가하지 않음',
    handles: '속성을 고르고 색칠한 구간 끝을 조절',
  },
  passage: {
    title: '전후 변화',
    role: '접근 전후 무엇이 달라졌는지',
    pass: '접근→최근접 띠→이탈 뒤 실제 변화가 허용 구간에 위치',
    fail: '추가 추진 금지라면 엔진으로 얻은 변화는 불충족',
    handles: '바깥 원=진입·이탈, 안쪽 띠=최근접 범위',
  },
};
export function markerDiagram(kind: GoalMarker['kind']) {
  const geometry = {
    area: '<circle cx="60" cy="55" r="33" stroke-dasharray="5 4"/><circle cx="60" cy="55" r="6" fill="#9acaab"/><path d="M113 40h40" stroke="#d48579"/>',
    orbit:
      '<circle cx="58" cy="54" r="32"/><path d="M58 22a32 32 0 0 1 32 32l-5-6m5 6 4-7" stroke="#9acaab"/><circle cx="58" cy="54" r="9" fill="#6f9b91"/><path d="M113 68l40-28m-27 15 8 8m-8 0 8-8" stroke="#d48579"/>',
    velocity:
      '<path d="M22 54h95m-10-8 10 8-10 8"/><circle cx="117" cy="54" r="21" stroke-dasharray="5 4"/><circle cx="110" cy="60" r="4" fill="#9acaab"/>',
    surface:
      '<path d="M18 75a85 85 0 0 1 144 0"/><path d="M73 65V26l7-10 7 10v39M70 65h20" stroke="#9acaab"/><path d="M65 35l15 35 15-35" stroke-dasharray="4 5"/>',
    state:
      '<path d="M20 55h140" stroke="#476577" stroke-width="16"/><path d="M70 55h45" stroke="#9acaab" stroke-width="12"/><path d="M88 30v50"/>',
    passage:
      '<circle cx="87" cy="52" r="35" stroke-dasharray="5 4"/><circle cx="87" cy="52" r="12"/><path d="M8 76Q72-5 165 74m-8-9 8 9-11-1" stroke="#9acaab"/>',
  }[kind];
  return `<svg viewBox="0 0 180 104" class="marker-diagram" aria-label="${markerGuides[kind].title} 판정 그림" fill="none" stroke="#ebc577" stroke-width="2">${geometry}</svg>`;
}
export function markerGuide(kind: GoalMarker['kind']) {
  const g = markerGuides[kind];
  return `<section class="marker-guide">${markerDiagram(kind)}<h3>${g.title} · ${g.role}</h3><p class="guide-pass">✓ ${g.pass}</p><p class="guide-fail">× ${g.fail}</p><details><summary>조절 방법</summary><p>${g.handles}</p><p>여러 판정은 ‘판정 연결’로 모두·하나 이상·순서 중 선택합니다. 각 표식은 힘이나 충돌을 만드는 물체가 아닙니다.</p></details></section>`;
}
