import { expect, test } from '@playwright/test';
import { chooseSpanType, createCustomer, loginAsStaff, unique } from './helpers';
test('a span box opens two wheels, inches and thirty-seconds, that pick by scrolling', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Wheel'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/customers/${id}/edit`);
  await chooseSpanType(page, 'Cut to Cut');
  await page.locator('#field-middle_cut_to_cut').click();
  // Scroll the fraction wheel to 3/8 (12/32) and the inches wheel to 3.
  await page.getByRole('listbox', { name: 'Fraction' }).evaluate((el) => (el.scrollTop = 12 * 32));
  await page.getByRole('listbox', { name: 'Inches' }).evaluate((el) => (el.scrollTop = 1 * 32));
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

test('a picker opened on a pinch-zoomed page shows at normal size on screen', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Zoom'));
  await page.setViewportSize({ width: 820, height: 1180 });
  await page.goto(`/customers/${id}/edit`);
  await page.locator('#field-middle_lateral_pitch').scrollIntoViewIfNeeded();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 2.5 });
  await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThan(2);
  // Mouse clicks miss on a zoomed page in the test browser, so these taps are sent to the element.
  await page.locator('#field-middle_lateral_pitch').dispatchEvent('click');
  const sheet = page.locator('.wheel-sheet');
  await expect(sheet).toBeVisible();
  // On screen the sheet is as wide as the screen and sits inside the zoomed-in view.
  const box = await sheet.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const vv = window.visualViewport!;
    return { left: (r.left - vv.offsetLeft) * vv.scale, right: (r.right - vv.offsetLeft) * vv.scale, bottom: (r.bottom - vv.offsetTop) * vv.scale, screenW: vv.width * vv.scale, screenH: vv.height * vv.scale };
  });
  expect(box.left).toBeGreaterThanOrEqual(-1);
  expect(box.right).toBeLessThanOrEqual(box.screenW + 1);
  expect(box.bottom).toBeLessThanOrEqual(box.screenH + 1);
  expect(box.bottom).toBeGreaterThan(box.screenH - 2);
  await page.getByRole('dialog').getByRole('option', { name: '1/8', exact: true }).dispatchEvent('click');
  await page.getByRole('button', { name: 'Done' }).dispatchEvent('click');
  await expect(page.locator('#field-middle_lateral_pitch')).toHaveAttribute('data-value', '1/8');
});

test('the wheels fill the picker, so a finger anywhere across it scrolls one', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Wide Wheel'));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/customers/${id}/edit`);
  await chooseSpanType(page, 'Cut to Cut');
  await page.locator('#field-middle_cut_to_cut').click();
  const wheels = page.locator('.wheel-sheet__wheels');
  const inches = page.getByRole('listbox', { name: 'Inches' });
  const fraction = page.getByRole('listbox', { name: 'Fraction' });
  const [w, a, b] = await Promise.all([wheels.boundingBox(), inches.boundingBox(), fraction.boundingBox()]);
  expect(a!.x).toBeLessThanOrEqual(w!.x + 1);
  expect(Math.abs(a!.x + a!.width - b!.x)).toBeLessThanOrEqual(1);
  expect(b!.x + b!.width).toBeGreaterThanOrEqual(w!.x + w!.width - 1);
});
