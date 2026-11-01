import { test, expect } from '@playwright/test';
import { emptyStage, newBody, newGoal } from '../../src/stages/factory';

for (const view of [
  { width: 1440, height: 1000, name: 'desktop' },
  { width: 390, height: 844, name: 'mobile' },
])
  for (const kind of ['impact', 'missed'] as const)
    test(`${view.name} ${kind} 결과 확인`, async ({ page }) => {
      await page.setViewportSize({ width: view.width, height: view.height });
      const s = emptyStage();
      s.spawn.placed = true;
      s.rules.maxTime = 1;
      s.rules.timelineDuration = 1;
      s.audit.timeLimit = 1;
      const g = newGoal();
      g.endTime = kind === 'missed' ? 0.1 : 1;
      g.condition = {
        kind: 'compare',
        operator: 'gte',
        left: { kind: 'metric', metric: 'x', targetId: '' },
        right: { kind: 'constant', value: 5 },
      };
      s.goals = [g];
      if (kind === 'impact') {
        const b = newBody();
        b.radius = 1;
        b.mu = 0.000001;
        s.bodies = [b];
        s.spawn.position = { x: 1.03, y: 0 };
        s.spawn.velocity = { x: -1, y: 0 };
      }
      await page.addInitScript(
        (s) => localStorage.setItem('orbit-editor-draft-v2', JSON.stringify(s)),
        s,
      );
      await page.goto('/editor.html');
      await page.locator('#test-stage').click();
      await page.locator('#launch').click();
      await expect(page.locator('#result')).toBeVisible({ timeout: 15000 });
      await expect(page.locator('#result-moment')).toBeVisible();
      if (kind === 'impact') await expect(page.locator('#result')).toContainText('충격');
      await page.screenshot({ path: `test-results/screens/result-${kind}-${view.name}.png` });
      await page.locator('#result-close').click();
      await expect(page.locator('#result')).toBeHidden();
    });
