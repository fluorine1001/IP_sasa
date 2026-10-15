import { it, expect } from 'vitest';
import { boxesOverlap, layoutHandles } from '../src/editor/handle-layout';
import { authoringHandles, hitAuthoringHandle } from '../src/editor/marker-feedback';
import { markerHandles } from '../src/render/goal-marker';
import { toWorld } from '../src/render/camera';
import stage from './fixtures/live-two-body-orbit.json';
import type { Stage } from '../src/world/types';

it('같은 자리에 모인 네 궤도 조절기의 이름·클릭 범위를 분리하고 화면 안에 둔다', () => {
  for (const [w, h] of [
    [540, 430],
    [320, 260],
    [900, 650],
  ]) {
    for (const anchor of [
      { x: w / 2, y: h / 2 },
      { x: w - 4, y: 4 },
      { x: 0, y: h - 4 },
    ]) {
      const handles = layoutHandles(
        ['긴 반경', '짧은 반경', '허용 폭', '방향'].map((label, i) => ({
          kind: `${i}`,
          label,
          anchor,
        })),
        w,
        h,
      );
      expect(handles).toHaveLength(4);
      for (const [i, handle] of handles.entries()) {
        expect(handle.box.x).toBeGreaterThanOrEqual(0);
        expect(handle.box.y).toBeGreaterThanOrEqual(0);
        expect(handle.box.x + handle.box.width).toBeLessThanOrEqual(w);
        expect(handle.box.y + handle.box.height).toBeLessThanOrEqual(h);
        for (const other of handles.slice(i + 1))
          expect(boxesOverlap(handle.box, other.box, 5)).toBe(false);
      }
    }
  }
});
it('이동한 라벨 전체를 클릭할 수 있고 드래그 기준점은 원래 물리 경계로 보존한다', () => {
  const s = stage as Stage,
    g = s.goals[0],
    camera = { x: 6.1, y: 2.7, zoom: 30 };
  const handles = authoringHandles(s, g, camera, 540, 430);
  for (const handle of handles) {
    expect(handle.physicalPosition).toEqual(
      markerHandles(s, g).find((h) => h.kind === handle.kind)!.position,
    );
    const b = handle.box!;
    const point = toWorld({ x: b.x + b.width - 2, y: b.y + 14 }, camera, 540, 430);
    expect(handles.filter((h) => hitAuthoringHandle(h, point, camera, 540, 430))).toEqual([handle]);
  }
});
