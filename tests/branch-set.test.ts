import { expect, it } from 'vitest';
import { BranchSet } from '../src/world/branch-set';

it('분기 복사·정확한 ID 조회·삽입 순서가 Set과 같고 원본 과거를 변경하지 않는다', () => {
  const persistent = new BranchSet(),
    native = new Set<string>();
  for (let i = 0; i < 2000; i++) {
    const id = `id-${(i * 7919) % 997}`;
    persistent.add(id);
    native.add(id);
  }
  expect([...persistent]).toEqual([...native]);
  expect(persistent.size).toBe(native.size);
  for (let i = 0; i < 1100; i++) expect(persistent.has(`id-${i}`)).toBe(native.has(`id-${i}`));
  const branch = new BranchSet(persistent);
  branch.add('new');
  expect(branch.since(persistent)).toEqual(['new']);
  expect(persistent.has('new')).toBe(false);
  branch.delete('id-0');
  expect(persistent.has('id-0')).toBe(true);
  expect(branch.since(persistent)).toBeUndefined();
  branch.clear();
  expect(branch.size).toBe(0);
  expect(persistent.size).toBe(997);
});
