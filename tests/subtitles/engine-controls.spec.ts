import { expect, test } from '@playwright/test';

const queue = { paused: false, waiting_extraction: 1, extracting: 1, caching: 0, queue_limit: 50 };
const json = (route: import('@playwright/test').Route, status: number, body: unknown) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('restart asks first, forces it, and waits until the engine answers again', async ({ page }) => {
  const calls: string[] = [];
  let restarted = false;
  let polls = 0;
  await page.route('**/api/admin/evo/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push(`${route.request().method()} ${url.pathname}${url.search}`);
    if (url.pathname.endsWith('/config')) return json(route, 200, { data: [] });
    if (url.pathname.endsWith('/restart')) { restarted = true; return json(route, 200, { data: { restarting: true, running: 2 } }); }
    if (url.pathname.endsWith('/queue')) {
      // After the restart the engine is unreachable for two polls, then answers.
      if (restarted && polls++ < 2) return json(route, 502, { message: 'The Evo engine did not answer' });
      return json(route, 200, { data: queue });
    }
    return json(route, 404, {});
  });
  await page.goto('/engine-controls.html');
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: /Restart engine/ }).click();

  // Nothing is sent until the admin says yes, and the dialog says what will be lost.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('2 job(s) are running or waiting and will be lost');
  expect(calls.some((c) => c.includes('/restart'))).toBe(false);
  await dialog.getByRole('button', { name: 'Restart' }).click();

  await expect(page.getByText('The engine is back')).toBeVisible({ timeout: 25000 });
  expect(calls).toContain('POST /api/admin/evo/restart?engine=engine-a&force=1');
});

test('cancelling the dialog restarts nothing', async ({ page }) => {
  const calls: string[] = [];
  await page.route('**/api/admin/evo/**', async (route) => {
    calls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.request().url().includes('/queue') ? json(route, 200, { data: queue }) : json(route, 200, { data: [] });
  });
  await page.goto('/engine-controls.html');
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: /Restart engine/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /cancel/i }).click();
  await page.waitForTimeout(500);
  expect(calls.some((c) => c.includes('/restart'))).toBe(false);
});

test('clearing the Sinhala cache says how many files went', async ({ page }) => {
  await page.route('**/api/admin/evo/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/sinhala-cache')) return json(route, 200, { data: { removed: 7 } });
    return p.endsWith('/queue') ? json(route, 200, { data: queue }) : json(route, 200, { data: [] });
  });
  await page.goto('/engine-controls.html');
  await page.getByRole('button', { name: /^More/ }).click();
  await page.getByRole('menuitem', { name: /Clear Sinhala cache/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear cache' }).click();
  await expect(page.getByText('7 cached translation(s) removed')).toBeVisible();
});

const settings = [
  { key: 'MAX_CONCURRENT_EXTRACTIONS', label: 'Parallel extractions', description: 'At once.', kind: 'int', min: 1, max: 8, choices: [], value: 2, default: 2, overridden: false },
  { key: 'PROVIDER_COOLDOWN_S', label: 'Provider cool-down (s)', description: 'Skip time.', kind: 'int', min: 10, max: 86400, choices: [], value: 600, default: 300, overridden: true },
  { key: 'TRANSLATE_MODEL', label: 'Translation model', description: 'Hidden here.', kind: 'text', min: 0, max: 0, choices: [], value: 'google/x', default: 'google/x', overridden: false },
];

test('settings come in groups, and only real changes reach the save bar and the engine', async ({ page }) => {
  const puts: unknown[] = [];
  await page.route('**/api/admin/evo/**', async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith('/config') && route.request().method() === 'PUT') { puts.push(route.request().postDataJSON()); return json(route, 200, { data: settings }); }
    if (p.endsWith('/config')) return json(route, 200, { data: settings });
    return json(route, 200, { data: queue });
  });
  await page.goto('/engine-controls.html');
  await expect(page.getByRole('heading', { name: 'Capacity' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Providers' })).toBeVisible();
  await expect(page.getByText('Translation model')).toHaveCount(0); // set under OpenRouter, not here
  await expect(page.getByText('changed')).toHaveCount(1); // the overridden one says so, with its .env value
  const bar = page.getByRole('region', { name: 'Unsaved changes' });
  await expect(bar).toContainText('No changes');

  const field = page.getByLabel('Parallel extractions');
  await field.fill('3');
  await expect(bar).toContainText('1 unsaved change(s)');
  await field.fill('2'); // back to what it is: not a change
  await expect(bar).toContainText('No changes');

  await field.fill('4');
  await bar.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.getByText('Settings applied')).toBeVisible();
  expect(puts).toEqual([{ MAX_CONCURRENT_EXTRACTIONS: 4 }]);
});
