import { expect, test } from '@playwright/test';

test('the built app loads and shows its title', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  await expect(page).toHaveTitle('Cut Optimizer');
  await expect(page.getByRole('heading', { level: 1, name: 'Cut Optimizer' })).toBeVisible();
  expect(errors).toEqual([]);
});
