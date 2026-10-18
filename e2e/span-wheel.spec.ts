import { expect, test } from '@playwright/test';
import { chooseSpanType, createCustomer, loginAsStaff, unique } from './helpers';
test('a span box opens two wheels, inches and sixteenths, that pick by scrolling', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Wheel'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/customers/${id}/edit`);
  await chooseSpanType(page, 'Cut to Cut');
  await page.locator('#field-middle_cut_to_cut').click();
  // Scroll the fraction wheel to 3/8 and the inches wheel to 3.
  await page.getByRole('listbox', { name: 'Fraction' }).evaluate((el) => (el.scrollTop = 6 * 44));
  await page.getByRole('listbox', { name: 'Inches' }).evaluate((el) => (el.scrollTop = 1 * 44));
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#field-middle_cut_to_cut')).toHaveAttribute('data-value', '3 3/8');
});

test('the page behind an open picker stays put, and comes back where it was', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Still Page'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/customers/${id}/edit`);
  await page.locator('#field-pap').scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => window.scrollY);
  await page.locator('#field-pap').click();
  await expect(page.getByRole('dialog', { name: 'P.A.P' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('fixed');
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(200);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(before);
});
