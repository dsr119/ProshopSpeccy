import { expect, test, type Page } from '@playwright/test';
import { createCustomer, loginAsStaff, unique } from './helpers';

// Long but valid values, to prove nothing clips or overlaps.
const LONG: Record<string, string | [string, string]> = {
  middle_hole: '1 63/64',
  ring_hole: '123456.123456',
  thumb_hole: '1 15/16',
  middle_oval: 'wide 1/16 oval toward palm',
  ring_oval: '1/32',
  thumb_oval: '3/64 oval, 45 deg',
  middle_cut_to_cut: '4 63/64',
  ring_cut_to_cut: '4 31/32',
  middle_actual_cut: '5 1/16',
  ring_actual_cut: '123456 99/100',
  middle_lateral_pitch: ['1 15/64', 'right'],
  middle_fr_pitch: ['1/4', 'forward'],
  ring_lateral_pitch: ['0', 'none'],
  ring_fr_pitch: ['123456.123456', 'reverse'],
  thumb_lateral_pitch: ['3/8', 'left'],
  thumb_fr_pitch: ['1 1/4', 'reverse'],
  thumb_oval_angle: '-135.5',
};

async function seedLongValues(page: Page) {
  const id = await createCustomer(page, unique('Fictional Layout Check With A Long Name'), '(555) 010-9999');
  await page.goto(`/customers/${id}/edit`);
  await page.getByLabel('Right-handed').check();
  await page.getByLabel('Thumb-in').check();
  for (const [field, v] of Object.entries(LONG)) {
    const [text, dir] = Array.isArray(v) ? v : [v, undefined];
    await page.locator(`#field-${field}`).fill(text);
    if (dir) await page.locator(`#field-${field}`).locator('xpath=..').locator('select').selectOption(dir);
  }
  await page.locator('#field-fitting_notes').fill('FICTIONAL: grip pressure notes for layout testing.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  return id;
}

async function checkSheet(page: Page) {
  await expect(page.locator('.sheet .slot').first()).toBeVisible();
  const problems = await page.evaluate(() => {
    const out: string[] = [];
    const sheet = document.querySelector('.sheet')!.getBoundingClientRect();
    const slots = [...document.querySelectorAll<HTMLElement>('.sheet .slot, .sheet .sheet__label')];
    const rects = slots.map((s) => ({ el: s, r: s.getBoundingClientRect() }));
    for (const { el, r } of rects) {
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push(`clipped: ${el.dataset.field ?? el.textContent}`);
      if (r.left < sheet.left - 1 || r.right > sheet.right + 1) out.push(`outside: ${el.dataset.field}`);
    }
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i].r, b = rects[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5)
          out.push(`overlap: ${rects[i].el.dataset.field ?? rects[i].el.textContent} / ${rects[j].el.dataset.field ?? rects[j].el.textContent}`);
      }
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page scrolls horizontally');
    return out;
  });
  expect(problems).toEqual([]);
}

test('the sheet stays legible without clipping at phone, tablet and desktop sizes, and prints cleanly', async ({ page }) => {
  await loginAsStaff(page);
  const id = await seedLongValues(page);

  for (const [w, h, name] of [
    [375, 812, 'phone'],
    [768, 1024, 'tablet'],
    [1280, 900, 'desktop'],
  ] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`/customers/${id}`);
    await expect(page.locator('.sheet .slot').first()).toBeVisible();
    await checkSheet(page);
    await page.screenshot({ path: `test-results/screens/customer-${name}.png`, fullPage: true });
    await page.goto(`/customers/${id}/edit`);
    await checkSheet(page);
    await page.screenshot({ path: `test-results/screens/edit-${name}.png`, fullPage: true });
  }

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/customers/${id}/print`);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.locator('.print-sheet')).toContainText('Right-handed');
  await expect(page.locator('.print-sheet')).toContainText('Thumb-in');
  await expect(page.locator('.print-sheet')).toContainText(/Revision #1 · saved/);
  await expect(page.locator('.print-sheet')).toContainText('grip pressure notes');
  await checkSheet(page);
  await page.screenshot({ path: 'test-results/screens/print.png', fullPage: true });
  await page.pdf({ path: 'test-results/screens/print.pdf', format: 'Letter', printBackground: true });
});

test('phone view toggles between the digital sheet and the original photo', async ({ page }) => {
  await loginAsStaff(page);
  const id = await seedLongValues(page);
  await page.goto(`/customers/${id}/photos?upload=1`);
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'fictional.png',
    mimeType: 'image/png',
    buffer: (await import('node:fs')).readFileSync('public/assets/specSheet550wide.png'),
  });
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/customers/${id}`);
  await expect(page.locator('.compare__sheet')).toBeVisible();
  await expect(page.locator('.compare__photo')).toBeHidden();
  await page.getByRole('button', { name: 'Original photo' }).click();
  await expect(page.locator('.compare__photo')).toBeVisible();
  await expect(page.locator('.compare__sheet')).toBeHidden();
  await page.screenshot({ path: 'test-results/screens/customer-phone-photo.png', fullPage: true });

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('.compare__photo')).toBeVisible();
  await expect(page.locator('.compare__sheet')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/customer-desktop-side-by-side.png', fullPage: true });
});

test('printing warns when there are unsaved edits', async ({ page }) => {
  await loginAsStaff(page);
  const id = await seedLongValues(page);
  await page.goto(`/customers/${id}/edit`);
  await page.locator('#field-middle_hole').fill('2');
  await page.goto(`/customers/${id}/print`);
  await expect(page.getByText(/Printing uses the last saved values/)).toBeVisible();
  await expect(page.locator('.print-sheet [data-field="middle_hole"]')).toHaveText('1 63/64');
});
