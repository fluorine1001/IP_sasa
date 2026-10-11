import { blankStage } from '../src/stages/factory';
import { it, expect } from 'vitest';
import { EditorModel, cloneCondition } from '../src/editor/model';
import { stages } from '../src/stages/catalog';
import { comparison } from '../src/world/conditions';
import { newGoal } from '../src/stages/factory';
it('실행 취소·다시 실행은 편집 전 스테이지를 복구한다', () => {
  const model = new EditorModel(stages[0]),
    name = model.stage.title;
  model.change((s) => (s.title = '새 이름'));
  model.undo();
  expect(model.stage.title).toBe(name);
  model.redo();
  expect(model.stage.title).toBe('새 이름');
});
it('여러 엔티티를 복제할 때 조건 블록과 선행 목표의 참조를 함께 바꾼다', () => {
  const model = new EditorModel(stages[0]),
    body = model.stage.bodies[0],
    goal = { ...newGoal(), condition: comparison('speed', body.id, 0.5) };
  model.stage.goals = [goal];
  model.selection = new Set([body.id, goal.id]);
  model.duplicate();
  const copy = model.stage.goals[1],
    copiedBody = model.stage.bodies[1];
  expect(copy.id).not.toBe(goal.id);
  expect(copy.condition?.kind).toBe('compare');
  if (copy.condition?.kind === 'compare' && copy.condition.left.kind === 'metric')
    expect(copy.condition.left.targetId).toBe(copiedBody.id);
  model.undo();
  expect(model.stage.bodies).toHaveLength(1);
});
it('삭제와 실행 취소가 장면의 엔티티를 복구한다', () => {
  const model = new EditorModel(stages[0]);
  model.selection = new Set([model.stage.bodies[0].id]);
  model.delete();
  expect(model.stage.bodies).toHaveLength(0);
  model.undo();
  expect(model.stage.bodies).toHaveLength(1);
});

it('실행 취소는 조건 편집 대상과 선택 상태도 복구한다', () => {
  const model = new EditorModel(stages[0]),
    id = model.stage.goals[0].id;
  model.selection.add(id);
  model.change((s) => (s.goals[0].title = '변경'));
  model.undo();
  expect([...model.selection]).toEqual([id]);
  model.redo();
  expect([...model.selection]).toEqual([id]);
});

it('기록을 포함한 블록 복제는 이름과 내부 참조를 함께 바꾼다', () => {
  const branch = {
    kind: 'sequence' as const,
    children: [
      {
        kind: 'capture' as const,
        key: 'start',
        value: { kind: 'constant' as const, value: 1 },
        when: comparison(),
      },
      {
        kind: 'compare' as const,
        left: { kind: 'recorded' as const, key: 'start' },
        operator: 'gte' as const,
        right: { kind: 'constant' as const, value: 1 },
      },
    ],
  };
  const copy = cloneCondition(branch, branch);
  if (copy.kind !== 'sequence') throw new Error('sequence');
  expect(copy.children[0].kind === 'capture' && copy.children[0].key).toBe('start_copy2');
  expect(
    copy.children[1].kind === 'compare' &&
      copy.children[1].left.kind === 'recorded' &&
      copy.children[1].left.key,
  ).toBe('start_copy2');
  expect(branch.children[0].kind === 'capture' && branch.children[0].key).toBe('start');
});

it('다른 스테이지에 장면 묶음을 붙이면 UUID와 내부 목표·공전 참조를 재연결하고 실행 취소된다', () => {
  const source = new EditorModel(blankStage());
  const body = source.stage.bodies[0];
  source.stage.goals[0].condition = {
    kind: 'compare',
    left: { kind: 'metric', metric: 'distance', targetId: body.id },
    operator: 'gte',
    right: { kind: 'constant', value: 1 },
  };
  source.selection = new Set([body.id, source.stage.goals[0].id]);
  const destination = new EditorModel(blankStage()),
    count = destination.stage.bodies.length;
  destination.paste(source.copy());
  const copy = destination.stage.goals.at(-1)!,
    copiedBody = destination.stage.bodies.at(-1)!;
  expect(copiedBody.id).not.toBe(body.id);
  expect(
    copy.condition.kind === 'compare' &&
      copy.condition.left.kind === 'metric' &&
      copy.condition.left.targetId,
  ).toBe(copiedBody.id);
  destination.undo();
  expect(destination.stage.bodies).toHaveLength(count);
});
