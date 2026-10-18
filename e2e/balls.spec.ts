import { expect, test } from '@playwright/test';
import { createCustomer, loginAsStaff, unique } from './helpers';

test('bowling balls with weight and layout save with the spec sheet, can be changed and removed', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Ball Owner'));
  await expect(page.locator('.balls-list')).toContainText('No balls recorded.');
  await page.goto(`/customers/${id}/edit`);

  const editor = page.locator('.balls-editor');
  await editor.getByRole('button', { name: 'Add a ball' }).click();
  await editor.getByRole('button', { name: 'Add a ball' }).click();
  const rows = page.getByTestId('ball-row');
  await rows.nth(0).getByLabel('Ball 1', { exact: true }).fill('Fictional Phaze');
  await rows.nth(0).getByLabel('Weight').selectOption('15');
  await rows.nth(0).getByLabel('Layout').fill('4 1/2 x 4 x 2');
  // A ball needs a name once anything about it is filled in.
  await rows.nth(1).getByLabel('Layout').fill('50 x 4 1/2 x 40');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(rows.nth(1)).toContainText('Give the ball a name.');
  await rows.nth(1).getByLabel('Ball 2', { exact: true }).fill('Fictional Spare');
  await rows.nth(1).getByLabel('Weight').selectOption('14');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  const list = page.locator('.balls-list tbody tr');
  await expect(list).toHaveCount(2);
  await expect(list.nth(0)).toContainText('Fictional Phaze');
  await expect(list.nth(0)).toContainText('15 lb');
  await expect(list.nth(0)).toContainText('4 1/2 x 4 x 2');
  await expect(list.nth(1)).toContainText('50 x 4 1/2 x 40');

  // Changing only the balls is a save too, and the other ball stays as it was.
  await page.goto(`/customers/${id}/edit`);
  await expect(rows).toHaveCount(2);
  await rows.nth(0).getByRole('button', { name: 'Remove ball 1' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  await expect(list).toHaveCount(1);
  await expect(list.nth(0)).toContainText('Fictional Spare');
  await expect(list.nth(0)).toContainText('14 lb');

  await page.goto(`/customers/${id}/print`);
  await expect(page.locator('.print-sheet .balls-list')).toContainText('Fictional Spare');
});
