import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createCustomer, intakeSignIn, loginAsStaff, unique } from './helpers';

const SHEET = { mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

test('a bowler can be deleted, undone, and brought back from the deleted list', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Deleted Bowler');
  await createCustomer(page, name);

  await page.getByRole('button', { name: 'Delete bowler' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete bowler' }).click();
  await expect(page.getByText(`${name} was deleted.`)).toBeVisible();
  await page.getByLabel('Search by name or phone').fill(name);
  await expect(page.getByText(/No customers match/)).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.results li', { hasText: name })).toHaveCount(1);

  // Delete again, then bring them back from the list at the bottom.
  await page.locator('.results li', { hasText: name }).click();
  await page.getByRole('button', { name: 'Delete bowler' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete bowler' }).click();
  await expect(page.getByText(`${name} was deleted.`)).toBeVisible();
  await page.getByText('Recently deleted bowlers').click();
  await page.locator('.removed-list li', { hasText: name }).getByRole('button', { name: 'Bring back' }).click();
  await expect(page.locator('.removed-list li', { hasText: name })).toHaveCount(0);
  await page.getByLabel('Search by name or phone').fill(name);
  await expect(page.locator('.results li', { hasText: name })).toHaveCount(1);
});

test('a queue sheet can be deleted and brought back', async ({ page }) => {
  await loginAsStaff(page);
  await page.goto('/intake/');
  // A new name is added to the sign-in list by the admin, then picked.
  await intakeSignIn(page, unique('Fictional Deleter'));
  await expect(page.locator('[data-count="waiting"] dd')).not.toHaveText('–');
  const waiting = () => page.locator('[data-count="waiting"] dd');
  const before = Number((await waiting().textContent())?.replace(/\D/g, '') || 0);

  await page.getByRole('link', { name: 'Take photos of sheets' }).click();
  await page.getByTestId('library-input').setInputFiles([{ name: 'dup.png', ...SHEET }]);
  await expect(page.getByRole('status')).toHaveText('1 sheet added to the queue');
  await page.getByRole('link', { name: '← Queue' }).click();
  await expect(waiting()).toHaveText(String(before + 1));

  // Delete the next sheet (this one, unless older ones are waiting), then undo.
  await page.getByRole('button', { name: 'Type in the next sheet' }).click();
  await page.getByRole('button', { name: 'Delete sheet' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete sheet' }).click();
  await expect(page.getByText('That sheet was deleted from the queue.')).toBeVisible();
  await expect(waiting()).toHaveText(String(before));

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(waiting()).toHaveText(String(before + 1));
  await page.getByText('Recently deleted sheets').click();
  await expect(page.locator('.removed-list')).toContainText('No deleted sheets.');
});
