import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createCustomer, loginAsStaff, unique } from './helpers';

const SAMPLE = { name: 'fictional-sheet.png', mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

test('balls go in beside the back of a sheet, and photos can be deleted and undone', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Back Photo'));
  await page.getByRole('link', { name: 'Add a photo' }).click();
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.getByLabel(/Caption/).fill('Back of the sheet');
  await page.getByLabel('Spec sheet', { exact: true }).check();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();

  // The back of a sheet has the balls right beside it.
  const back = page.locator('.back-balls');
  await back.getByRole('button', { name: 'Add a ball' }).click();
  await back.getByTestId('ball-row').getByLabel('Ball 1', { exact: true }).fill('Fictional Back Ball');
  await back.getByTestId('ball-row').getByLabel('Weight').selectOption('14');
  await back.getByTestId('ball-row').getByLabel('Layout').fill('4 x 5 x 3');
  await back.getByRole('button', { name: 'Save balls' }).click();
  await expect(back.getByText('Balls saved.')).toBeVisible();
  await page.getByRole('button', { name: 'Digital spec sheet' }).click();
  await expect(page.locator('.balls-list')).toContainText('Fictional Back Ball');

  // Photos can be deleted, and the deletion undone.
  await page.goto(`/customers/${id}?view=photos`);
  await page.getByRole('button', { name: 'Delete photo' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete photo' }).click();
  await expect(page.getByText('No photos yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.photo-list li')).toHaveCount(1);
});

test('a finger lateral pitch lists its own side first, and the grip is Finger Tip, Conventional or No Thumb', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Lateral'));
  await page.goto(`/customers/${id}/edit`);
  const middle = page.locator('#field-middle_lateral_pitch option');
  const ring = page.locator('#field-ring_lateral_pitch option');
  await expect(middle.nth(1)).toHaveText('0"');
  await expect(middle.nth(2)).toHaveText(/^Left 1\/16"/);
  await expect(ring.nth(2)).toHaveText(/^Right 1\/16"/);
  await expect(page.locator('#field-middle_lateral_pitch optgroup')).toHaveAttribute('label', 'The other way (right)');

  await page.getByLabel('Finger Tip').check();
  await page.locator('#field-middle_lateral_pitch').selectOption('-1/8');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  await expect(page.locator('.fit-identity')).toContainText('Finger Tip');
});
