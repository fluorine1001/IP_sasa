// Usage: npm run dev, then AUDIT_URL=http://127.0.0.1:5173/ node scripts/readability-audit.mjs [desk|phone] [screen,...]
// Readability audit: every visible text element on each screen, its font size and WCAG
// contrast against the nearest opaque background. Flags < 13px and contrast below
// 4.5:1 (3:1 for large text: >= 24px, or >= 18.66px bold).
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
const root = process.cwd();
const { chromium } = createRequire(root + '/package.json')('playwright');
const stages = readdirSync(root + '/data/stages').map((f) =>
  JSON.parse(readFileSync(root + '/data/stages/' + f, 'utf8')),
);
const URL0 = process.env.AUDIT_URL ?? 'http://127.0.0.1:5173/';
const OUT = process.env.AUDIT_OUT ?? 'test-results/readability';
mkdirSync(OUT, { recursive: true });

function audit() {
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const [r, g, b, a = 1] = m[1]
      .split(/[ ,/]+/)
      .filter(Boolean)
      .map(Number);
    return { r, g, b, a };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const blend = (top, under) => ({
    r: top.r * top.a + under.r * (1 - top.a),
    g: top.g * top.a + under.g * (1 - top.a),
    b: top.b * top.a + under.b * (1 - top.a),
    a: 1,
  });
  function background(el) {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 0.99) break;
      }
    }
    let out = { r: 26, g: 31, b: 46, a: 1 }; // page / canvas space colour (--n-900)
    for (const l of layers.reverse()) out = blend(l, out);
    return out;
  }
  const seen = new Set();
  const issues = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    if (
      r.width < 1 ||
      r.height < 1 ||
      r.bottom < 0 ||
      r.right < 0 ||
      r.top > innerHeight ||
      r.left > innerWidth
    )
      continue;
    const cs = getComputedStyle(el);
    if (
      cs.visibility === 'hidden' ||
      +cs.opacity === 0 ||
      el.closest('.sr-only,[aria-hidden="true"],[hidden],dialog:not([open])')
    )
      continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= +getComputedStyle(e).opacity;
    const size = parseFloat(cs.fontSize);
    const bold = +cs.fontWeight >= 700;
    const bg = background(el);
    const fg0 = parse(cs.color);
    const fg = blend({ ...fg0, a: fg0.a * opacity }, bg);
    const L1 = lum(fg),
      L2 = lum(bg);
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const disabled = !!el.closest(':disabled,[aria-disabled="true"]');
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const path = [el, el.parentElement]
      .filter(Boolean)
      .map(
        (e) =>
          e.tagName.toLowerCase() +
          (e.id ? '#' + e.id : '') +
          (e.classList.length ? '.' + [...e.classList].slice(0, 2).join('.') : ''),
      )
      .reverse()
      .join(' > ');
    if (size < 14.9 || (!disabled && ratio < need))
      issues.push({
        path,
        text: text.slice(0, 40),
        size: +size.toFixed(1),
        ratio: +ratio.toFixed(2),
        need,
      });
  }
  return issues;
}

const screens = [
  ['title', async (p) => {}],
  [
    'campaign',
    async (p) => {
      await p.locator('#start').click();
    },
  ],
  [
    'plan1',
    async (p) => {
      await openStage(p, 1);
    },
  ],
  [
    'brief1',
    async (p) => {
      await openStage(p, 1);
      await p.locator('#goal-details').click();
    },
  ],
  [
    'flight1',
    async (p) => {
      await openStage(p, 1);
      await p.locator('#launch').click();
      await p.waitForTimeout(3000);
    },
  ],
  [
    'result1',
    async (p) => {
      await openStage(p, 1);
      await p.locator('#launch').click();
      await p.waitForTimeout(13000);
    },
  ],
  [
    'plan6',
    async (p) => {
      await openStage(p, 6);
    },
  ],
  [
    'records',
    async (p) => {
      await openStage(p, 1);
      await p.locator('#launch').click();
      await p.waitForTimeout(13000);
      await p
        .locator('#result-close')
        .click()
        .catch(() => {});
      await p.locator('#notes').click();
    },
  ],
  [
    'programeditor',
    async (p) => {
      await openStage(p, 1);
      await p.locator('#program-toggle').click();
    },
  ],
  [
    'pause',
    async (p) => {
      await openStage(p, 1);
      await p.keyboard.press('Escape');
    },
  ],
  [
    'tutorials',
    async (p) => {
      await p.locator('#tutorials').click();
    },
  ],
  [
    'lesson',
    async (p) => {
      await p.locator('#tutorials').click();
      await p.locator('[data-stage], .stage-card').first().click();
    },
  ],
  [
    'help',
    async (p) => {
      await p.locator('#help').click();
    },
  ],
  [
    'settings',
    async (p) => {
      await p.locator('#settings').click();
    },
  ],
];
async function openStage(p, order) {
  await p.locator('#start').click();
  const s = stages.find((x) => x.order === order);
  const card = p.locator(`[data-stage="${s.id}"]`);
  for (const ch of await p.locator('[data-chapter]').all()) {
    if (await card.isVisible()) break;
    await ch.click();
  }
  await card.click();
  await p.waitForTimeout(800);
}
const only = process.argv[3]?.split(',');
const device = process.argv[2] ?? 'desk';
const b = await chromium.launch();
const report = {};
for (const [name, go] of screens) {
  if (only && !only.includes(name)) continue;
  const p = await b.newPage({
    viewport: device === 'phone' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  });
  await p.goto(URL0);
  await p.evaluate((ids) => {
    localStorage.setItem('apollo-first-run-v1', 'true');
    localStorage.setItem('apollo-briefing-auto', 'false');
  }, []);
  await p.goto(URL0);
  await p.waitForTimeout(500);
  try {
    await go(p);
  } catch (e) {
    report[name] = 'NAV ' + e.message.split('\n')[0];
    await p.close();
    continue;
  }
  await p.waitForTimeout(500);
  report[name] = await p.evaluate(audit);
  await p.screenshot({ path: `${OUT}/${device}-${name}.png` });
  await p.close();
}
await b.close();
writeFileSync(`${OUT}/${device}.json`, JSON.stringify(report, null, 1));
for (const [k, v] of Object.entries(report)) console.log(k, Array.isArray(v) ? v.length : v);
