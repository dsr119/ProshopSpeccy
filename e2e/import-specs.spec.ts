import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createCustomer, fillField, loginAsStaff, slot, unique } from './helpers';

// Any image works as a stand-in for a photographed paper sheet.
const SAMPLE = { name: 'fictional-sheet.png', mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

async function uploadSheet(page: Page, caption: string) {
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.getByLabel('Spec sheet', { exact: true }).check();
  await page.locator('.upload').getByLabel(/Caption/).fill(caption);
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();
}

test('specs imported from a paper sheet photo become the current version, and current can be switched', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Importer'));
  await page.goto(`/customers/${id}/edit`);
  await fillField(page, 'middle_hole', '3/4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/revision #1/)).toBeVisible();

  await page.goto(`/customers/${id}?view=photos`);
  await uploadSheet(page, '2019 paper sheet');
  // The newest spec sheet photo counts as current until someone picks one.
  await expect(page.locator('.photo-list li', { hasText: '2019 paper sheet' })).toContainText('Current');

  // Import specs: the photo beside the digital sheet, starting from the current values.
  await page.getByRole('link', { name: 'Import specs' }).click();
  await expect(page.getByAltText('Paper spec sheet')).toBeVisible();
  await expect(page.getByText(/Import specs for Fictional Importer/)).toBeVisible();
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');
  await fillField(page, 'middle_hole', '13/16');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/screens/import-specs.png', fullPage: false });
  await page.getByRole('button', { name: 'Save as the current version' }).click();

  await expect(page.getByText('Specs imported.')).toBeVisible();
  await expect(page.getByText(/revision #2/)).toBeVisible();
  await expect(slot(page, 'middle_hole')).toHaveText('13/16');
  await expect(page.locator('.saved-by')).toContainText('current paper sheet: 2019 paper sheet');

  // A newer photo doesn't take over: the imported sheet stays current until someone switches.
  await page.goto(`/customers/${id}?view=photos`);
  await uploadSheet(page, '2023 paper sheet');
  await expect(page.locator('.photo-list li', { hasText: '2019 paper sheet' })).toContainText('Current');
  await expect(page.locator('.photo-list li', { hasText: '2023 paper sheet' })).not.toContainText('Current');
  // It has no digital version of its own, so switching asks nothing.
  const current = page.getByRole('switch', { name: /Current paper sheet/ });
  await expect(current).not.toBeChecked();
  await current.click({ force: true });
  await expect(current).toBeChecked();
  await expect(page.locator('.photo-list li', { hasText: '2023 paper sheet' })).toContainText('Current');
  await expect(page.locator('.photo-list li', { hasText: '2019 paper sheet' })).not.toContainText('Current');
  await page.screenshot({ path: 'test-results/screens/current-paper-sheet.png', fullPage: true });

  // Make the first version current from the history: nothing is copied.
  await page.goto(`/customers/${id}/history`);
  await page.locator('.history__item', { hasText: 'Revision #1' }).getByRole('button', { name: 'Make current…' }).click();
  await expect(page.getByRole('dialog')).toContainText('becomes the digital spec sheet');
  await page.screenshot({ path: 'test-results/screens/make-current.png', fullPage: false });
  await page.getByRole('button', { name: 'Make it current' }).click();
  await expect(page.getByText(/revision #1\b/)).toBeVisible();
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');

  // Picking the imported photo again offers to bring its version back too.
  await page.goto(`/customers/${id}?view=photos`);
  await page.locator('.photo-list li', { hasText: '2019 paper sheet' }).click();
  await page.getByRole('switch', { name: /Current paper sheet/ }).click({ force: true });
  await expect(page.getByRole('dialog')).toContainText('Also make version #2 the current digital sheet');
  await page.screenshot({ path: 'test-results/screens/photo-also-version.png', fullPage: false });
  await page.getByRole('button', { name: 'Make it current' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Digital spec sheet' }).click();
  await expect(page.getByText(/revision #2\b/)).toBeVisible();

  await page.goto(`/customers/${id}/history`);
  await expect(page.locator('.history__item')).toHaveCount(2);
});
