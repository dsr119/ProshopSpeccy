import { expect, test, type Page } from '@playwright/test';
import { USERS, createCustomer, loginAsStaff, slot, unique } from './helpers';

async function fill(page: Page, field: string, value: string, dir?: string) {
  const input = page.locator(`#field-${field}`);
  // Span boxes appear once a span type is chosen.
  if (field.endsWith('_cut_to_cut') && !(await input.isVisible())) await page.getByLabel('Cut to Cut', { exact: true }).check();
  // Pitch amounts are picked from a list; everything else is typed.
  if (field.endsWith('_pitch')) await input.selectOption(value);
  else await input.fill(value);
  if (dir) await page.locator(`#field-${field} + select`).selectOption(dir);
}

test('mixed fractions, pitch directions, blank and zero save and reload in the right places', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Fit Check'));
  await expect(page.getByText('No digital specs yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Create digital specs' }).first().click();

  await page.getByLabel('Right-handed').check();
  await page.getByLabel('Thumb-in').check();
  await fill(page, 'middle_hole', '55/64');
  await fill(page, 'ring_hole', '0');
  await fill(page, 'thumb_hole', '1 1/16');
  await fill(page, 'middle_cut_to_cut', '4 3/8');
  await fill(page, 'ring_cut_to_cut', '4-5/16');
  await fill(page, 'middle_actual_cut', '4.5');
  await fill(page, 'middle_lateral_pitch', '1/8', 'right');
  await fill(page, 'middle_fr_pitch', '1/4', 'forward');
  await fill(page, 'thumb_fr_pitch', '3/8', 'reverse');
  await fill(page, 'thumb_oval_angle', '15');
  await fill(page, 'middle_oval', '1/16 oval');

  // Selecting a box on the sheet focuses its form control.
  await page.locator('.sheet [data-field="ring_actual_cut"]').click();
  await expect(page.locator('#field-ring_actual_cut')).toBeFocused();

  await page.getByLabel(/Change note/).fill('First fitting');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await page.reload();
  await expect(slot(page, 'middle_hole')).toHaveText('55/64');
  await expect(slot(page, 'ring_hole')).toHaveText('0');
  await expect(slot(page, 'thumb_hole')).toHaveText('1 1/16');
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('4 3/8');
  await expect(slot(page, 'ring_cut_to_cut')).toHaveText('4-5/16');
  await expect(slot(page, 'middle_actual_cut')).toHaveText('4.5');
  await expect(slot(page, 'middle_lateral_pitch')).toHaveText(/Lat\s*1\/8 →Right/);
  await expect(slot(page, 'middle_fr_pitch')).toHaveText(/F\/R\s*1\/4 ↑Forward/);
  await expect(slot(page, 'thumb_fr_pitch')).toHaveText(/F\/R\s*3\/8 ↓Reverse/);
  await expect(slot(page, 'thumb_oval_angle')).toHaveText('15°');
  // Blank stays blank (not zero).
  await expect(slot(page, 'ring_actual_cut')).toHaveText('–');
  await expect(slot(page, 'ring_actual_cut')).toHaveClass(/slot--empty/);
  await expect(slot(page, 'ring_hole')).toHaveClass(/slot--value/);
  await expect(page.locator('.fit-identity')).toContainText('Right-handed');
  await expect(page.locator('.fit-identity')).toContainText('Thumb-in');
  await expect(page.getByText(/Last saved .* by Sam Staff/)).toBeVisible();

  await page.getByText('All measurements as text').click();
  const table = page.locator('.sheet-table');
  await expect(table.locator('tr', { hasText: 'Ring finger hole size' })).toContainText('0"');
  await expect(table.locator('tr', { hasText: 'Ring span actual-cut' })).toContainText('Not recorded');
  await expect(table.locator('tr', { hasText: 'Middle finger lateral pitch' })).toContainText('1/8" Right');
});

test('invalid entries are flagged without being discarded', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Validation'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'middle_hole', '4 3/0');
  await fill(page, 'thumb_hole', '-1');
  await fill(page, 'ring_lateral_pitch', '1/8');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('The bottom of a fraction cannot be zero')).toBeVisible();
  await expect(page.getByText('Cannot be negative')).toBeVisible();
  await expect(page.getByText('Choose left or right')).toBeVisible();
  await expect(page.locator('#field-middle_hole')).toHaveValue('4 3/0');
  await expect(page).toHaveURL(/\/edit$/);
});

test('editing creates a revision with the right author; cancel leaves saved data unchanged; restore keeps history', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional History'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'middle_hole', '3/4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');

  // Cancel with unsaved changes asks first and keeps saved data.
  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await fill(page, 'middle_hole', '7/8');
  await expect(slot(page, 'middle_hole')).toHaveText('7/8');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toContainText('Discard unsaved changes?');
  await page.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');

  // A no-change save does not add a revision.
  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('No changes were made')).toBeVisible();

  // Second edit by another staff member.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await loginAsStaff(page, USERS.staff2);
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'middle_hole', '13/16');
  await page.getByLabel(/Change note/).fill('Opened middle');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Last saved .* by Riley Staff · revision #2/)).toBeVisible();

  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.history__item')).toHaveCount(2);
  await expect(page.locator('.history__item').first()).toContainText('Riley Staff');
  await expect(page.locator('.history__item').first()).toContainText('Opened middle');
  await page.locator('.history__item').first().getByText(/field\(s\) changed/).click();
  await expect(page.locator('.history__item').first().locator('.changes')).toContainText('Middle finger hole size');
  await expect(page.locator('.history__item').first().locator('.changes')).toContainText('13/16');

  await page.locator('.history__item').nth(1).getByRole('link', { name: 'View full sheet' }).click();
  await expect(page.getByText('Older version')).toBeVisible();
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');
  await page.getByRole('button', { name: 'Restore this revision…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Revision #1 from');
  await page.getByRole('button', { name: 'Restore revision #1' }).click();
  await expect(page.getByText(/revision #3/)).toBeVisible();
  await expect(slot(page, 'middle_hole')).toHaveText('3/4');
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.history__item')).toHaveCount(3);
  await expect(page.locator('.history__item').first()).toContainText('Restored revision #1');
});

test('concurrent edits show a conflict instead of overwriting', async ({ page, browser }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Conflict'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'ring_hole', '1/2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'ring_hole')).toHaveText('1/2');

  // Both staff open the editor on revision #1.
  await page.goto(`/customers/${id}/edit`);
  const other = await browser.newContext();
  const page2 = await other.newPage();
  await loginAsStaff(page2, USERS.staff2);
  await page2.goto(`/customers/${id}/edit`);
  await fill(page2, 'ring_hole', '5/8');
  await page2.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page2, 'ring_hole')).toHaveText('5/8');

  await fill(page, 'ring_hole', '9/16');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Someone else saved this fit');
  await expect(dialog).toContainText('Riley Staff');
  await expect(dialog.locator('.changes')).toContainText('5/8');
  await expect(dialog.locator('.changes')).toContainText('9/16');
  await expect(page.locator('#field-ring_hole')).toHaveValue('9/16');

  // Keep mine, review, then save explicitly on top of theirs.
  await dialog.getByRole('button', { name: 'Keep my changes and review' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'ring_hole')).toHaveText('9/16');
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.locator('.history__item')).toHaveCount(3);
  await other.close();
});

test('a failed save keeps the entered values and can be retried', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Offline'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'middle_cut_to_cut', '4 1/2');
  await page.route('**/rest/v1/rpc/save_fit_revision', (route) => route.abort('internetdisconnected'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Couldn't reach the server/)).toBeVisible();
  await expect(page.locator('#field-middle_cut_to_cut')).toHaveValue('4 1/2');

  // Reloading the tab keeps the unsaved work too.
  await page.unroute('**/rest/v1/rpc/save_fit_revision');
  await page.reload();
  await expect(page.getByText('Your unsaved changes from earlier in this tab were restored.')).toBeVisible();
  await expect(page.locator('#field-middle_cut_to_cut')).toHaveValue('4 1/2');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('4 1/2');
});

test('left-handed no-thumb fits are labelled and keep earlier thumb values', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Lefty'));
  await page.goto(`/customers/${id}/edit`);
  await page.getByLabel('Left-handed').check();
  await page.getByLabel('Thumb-in').check();
  await fill(page, 'thumb_hole', '1');
  await fill(page, 'middle_cut_to_cut', '4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'thumb_hole')).toHaveText('1');

  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await page.getByLabel('No-thumb').check();
  await expect(page.getByText(/Not applicable in no-thumb mode/).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.fit-identity')).toContainText('Left-handed');
  await expect(page.locator('.fit-identity')).toContainText('No-thumb');
  await expect(slot(page, 'thumb_hole')).toHaveText('N/A');
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('N/A');
  // Orientation is labelled, not silently mirrored.
  await expect(page.locator('.sheet-legend')).toContainText('provisional');
  await expect(page.locator('.sheet__label').first()).toHaveText('Middle');

  await page.getByText('All measurements as text').click();
  await expect(page.locator('.sheet-table tr', { hasText: 'Thumb hole size' })).toContainText('saved, not applicable');
});

test('the span boxes record the chosen span type and the sheet names it', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Full Span'));
  await page.goto(`/customers/${id}/edit`);
  await expect(page.locator('#field-middle_cut_to_cut')).toHaveCount(0);
  await expect(page.locator('[data-span-heading]')).toHaveText('Span');

  await page.getByLabel('Full Span', { exact: true }).check();
  await expect(page.getByText('grip to thumb cut')).toBeVisible();
  await expect(page.getByLabel(/^Middle finger Full Span/)).toBeVisible();
  await page.locator('#field-middle_cut_to_cut').fill('4 3/4');
  await page.locator('#field-ring_cut_to_cut').fill('4 11/16');
  await expect(page.locator('[data-span-heading]')).toHaveText('Full Span');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await expect(page.locator('[data-span-heading]')).toHaveText('Full Span');
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('4 3/4');
  const table = page.locator('.sheet-table');
  await expect(table.locator('tr', { hasText: 'Span measured' })).toContainText('Full Span');
  await expect(table.locator('tr', { hasText: 'Ring finger span' })).toContainText('4 11/16"');
});
