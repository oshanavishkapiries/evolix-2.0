import { expect, test } from '@playwright/test';

test('the overview leads with what needs someone, then the week against the week before', async ({ page }) => {
  await page.goto('/admin-overview.html?down=1');
  const engines = page.getByRole('link', { name: /Evo engines/ });
  await expect(engines).toHaveAttribute('data-tone', 'warn'); // one of two engines down
  await expect(engines).toContainText('1/2 up');
  await expect(engines).toContainText('3 job(s) running or waiting');
  await expect(page.getByRole('link', { name: /Errors/ })).toHaveAttribute('data-tone', 'warn'); // open, nothing new
  await expect(page.getByRole('link', { name: /Viewer reports/ })).toHaveAttribute('data-tone', 'bad'); // a new one today
  const plays = page.locator('.ov-trend', { hasText: 'Plays' });
  await expect(plays).toContainText('149'); // 4+8+7+12+20+60+38
  await expect(plays).toContainText('▲'); // up against the 24 of the week before
});

test('screenshots for humans (SHOT=/dir)', async ({ page }) => {
  test.skip(!process.env.SHOT, 'only runs when asked for pictures');
  for (const [name, width] of [['admin-overview', 1440], ['admin-overview-phone', 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/admin-overview.html');
    await page.screenshot({ path: `${process.env.SHOT}/${name}.png`, fullPage: true });
  }
});
