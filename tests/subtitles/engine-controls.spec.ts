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
  await page.getByRole('button', { name: 'Restart engine' }).click();

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
  await page.getByRole('button', { name: 'Restart engine' }).click();
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
  await page.getByRole('button', { name: 'Clear Sinhala cache' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Clear cache' }).click();
  await expect(page.getByText('7 cached translation(s) removed')).toBeVisible();
});
