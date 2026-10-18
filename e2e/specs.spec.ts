import { expect, test, type Page } from '@playwright/test';
import { USERS, chooseGrips, chooseSpanType, createCustomer, dirSlot, expectSpan, fillField, loginAsStaff, pickSpan, slot, unique } from './helpers';

const fill = fillField;

test('mixed fractions, pitch directions, blank and zero save and reload in the right places', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Fit Check'));
  await expect(page.getByText('No digital specs yet.')).toBeVisible();
  await page.getByRole('link', { name: 'Create digital specs' }).first().click();

  await page.getByLabel('Right-handed').check();
  await page.getByLabel('Thumb-in').check();
  await fill(page, 'middle_hole', '55/64');
  await fill(page, 'ring_actual_cut', '0');
  await fill(page, 'thumb_hole', '1 1/16');
  await fill(page, 'middle_cut_to_cut', '4 3/8');
  await fill(page, 'ring_cut_to_cut', '4 5/16');
  await fill(page, 'middle_actual_cut', '4.5');
  await fill(page, 'middle_lateral_pitch', '1/8', 'right');
  await fill(page, 'middle_fr_pitch', '1/4', 'forward');
  await fill(page, 'thumb_fr_pitch', '3/8', 'reverse');
  await fill(page, 'thumb_oval_angle', '15');
  await fill(page, 'middle_oval', '1/16 oval');

  // Selecting a box on the sheet focuses its form control.
  await page.locator('.sheet [data-field="bridge"]').click();
  await expect(page.locator('#field-bridge')).toBeFocused();

  await page.getByLabel(/Change note/).fill('First fitting');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await page.reload();
  await expect(slot(page, 'middle_hole')).toHaveText('55/64');
  await expect(slot(page, 'thumb_hole')).toHaveText('1 1/16');
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('4 3/8');
  await expect(slot(page, 'ring_cut_to_cut')).toHaveText('4 5/16');
  // Pitches print as fractions in the box on their arrow; finger lateral is signed.
  await expect(slot(page, 'middle_lateral_pitch')).toHaveText('+1/8');
  await expect(dirSlot(page, 'middle_fr_pitch', 'forward')).toHaveText('1/4');
  await expect(dirSlot(page, 'middle_fr_pitch', 'reverse')).toHaveText('');
  await expect(dirSlot(page, 'thumb_fr_pitch', 'reverse')).toHaveText('3/8');
  await expect(dirSlot(page, 'thumb_fr_pitch', 'forward')).toHaveText('');
  // Fields kept off the drawn sheet still show in the text table.
  await page.getByText('All measurements as text').click();
  await expect(page.locator('.sheet-table tr', { hasText: 'Middle span actual-cut' })).toContainText('4.5');
  await expect(page.locator('.sheet-table tr', { hasText: 'Thumb oval angle' })).toContainText('15°');
  // Blank stays blank (not zero).
  await expect(slot(page, 'bridge')).toHaveText('–');
  await expect(slot(page, 'bridge')).toHaveClass(/slot--empty/);
  await expect(slot(page, 'ring_hole')).toHaveClass(/slot--empty/);
  await expect(page.locator('.fit-identity')).toContainText('Right-handed');
  await expect(page.locator('.fit-identity')).toContainText('Thumb-in');
  await expect(page.getByText(/Last saved .* by Sam Staff/)).toBeVisible();

  await page.getByText('All measurements as text').click();
  const table = page.locator('.sheet-table');
  await expect(table.locator('tr', { hasText: 'Ring span actual-cut' })).toContainText('0"');
  await expect(table.locator('tr', { hasText: 'Ring finger hole size' })).toContainText('Not recorded');
  await expect(table.locator('tr', { hasText: 'Middle finger lateral pitch' })).toContainText('1/8" Right');
});

test('invalid entries are flagged without being discarded', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Validation'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'middle_actual_cut', '4 3/0');
  await fill(page, 'ring_actual_cut', '-1');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('The bottom of a fraction cannot be zero').first()).toBeVisible();
  await expect(page.getByText('Cannot be negative').first()).toBeVisible();
  await expect(page.locator('#field-middle_actual_cut')).toHaveValue('4 3/0');
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
  await expect(page.locator('#field-middle_hole')).toHaveValue('7/8');
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
  await expectSpan(page, 'middle_cut_to_cut', '4 1/2');

  // Reloading the tab keeps the unsaved work too.
  await page.unroute('**/rest/v1/rpc/save_fit_revision');
  await page.reload();
  await expect(page.getByText('Your unsaved changes from earlier in this tab were restored.')).toBeVisible();
  await expectSpan(page, 'middle_cut_to_cut', '4 1/2');
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
  await expect(page.getByText(/thumb and span part of the sheet is hidden/).first()).toBeVisible();
  await expect(page.locator('#field-thumb_hole')).toHaveCount(0);
  await expect(page.locator('#field-thumb_system_details')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.fit-identity')).toContainText('Left-handed');
  await expect(page.locator('.fit-identity')).toContainText('No-thumb');
  // Without a thumb the sheet stops under the fingers: no thumb, spans or span type.
  await expect(page.locator('.sheet--no-thumb')).toBeVisible();
  await expect(slot(page, 'thumb_hole')).toHaveCount(0);
  await expect(slot(page, 'middle_cut_to_cut')).toHaveCount(0);
  await expect(page.locator('[data-span-heading]')).toHaveCount(0);
  await expect(page.locator('.sheet__name')).toHaveText(['MIDDLE', 'RING']);
  await expect(page.locator('.fit-notes')).not.toContainText('Thumb system');

  await page.getByText('All measurements as text').click();
  await expect(page.locator('.sheet-table')).not.toContainText('Thumb hole size');

  // Switching back to thumb-in brings the saved thumb values back.
  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await page.getByLabel('Thumb-in').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(slot(page, 'thumb_hole')).toHaveText('1');
});

test('the digital spec sheet can be confirmed, and new measurements need confirming again', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Confirmed'));
  await page.goto(`/customers/${id}/edit`);
  await fill(page, 'bridge', '1/4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  const confirm = page.getByRole('switch', { name: /Digital spec sheet confirmed/ });
  await expect(confirm).not.toBeChecked();
  await page.locator('.confirm-sheet .switch').click();
  await expect(confirm).toBeChecked();
  await expect(page.locator('.confirm-sheet')).toContainText(/ by /);
  await page.reload();
  await expect(confirm).toBeChecked();

  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await fill(page, 'bridge', '3/8');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  await expect(confirm).not.toBeChecked();
  await expect(page.locator('.confirm-sheet')).toContainText('changed since it was last confirmed');
});

test('each span type keeps its own spans and the sheet shows the chosen one', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Full Span'));
  await page.goto(`/customers/${id}/edit`);
  await expect(page.locator('[data-span-heading]')).toHaveText('Cut to Cut');

  await fill(page, 'middle_cut_to_cut', '4 3/8');
  await fill(page, 'middle_full_span', '4 3/4');
  await fill(page, 'ring_full_span', '4 11/16');
  await expect(page.locator('[data-span-heading]')).toHaveText('Full Span');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await expect(page.locator('[data-span-heading]')).toHaveText('Full Span');
  await expect(slot(page, 'middle_full_span')).toHaveText('4 3/4');
  const table = page.locator('.sheet-table');
  await page.getByText('All measurements as text').click();
  await expect(table.locator('tr', { hasText: 'Span shown' })).toContainText('Full Span');
  await expect(table.locator('tr', { hasText: 'Middle finger cut to cut' })).toContainText('4 3/8"');
  await expect(table.locator('tr', { hasText: 'Ring finger full span' })).toContainText('4 11/16"');

  // F / C / CTO switch the spans shown without editing, and leave the record alone.
  await page.getByRole('button', { name: 'Cut to Cut', exact: true }).click();
  await expect(page.locator('[data-span-heading]')).toHaveText('Cut to Cut');
  await expect(slot(page, 'middle_cut_to_cut')).toHaveText('4 3/8');
  await page.reload();
  await expect(page.locator('[data-span-heading]')).toHaveText('Full Span');

  // Switching back to Cut to Cut in the editor shows the cut-to-cut span that was saved alongside.
  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await chooseSpanType(page, 'Cut to Cut');
  await expectSpan(page, 'middle_cut_to_cut', '4 3/8');
});

test('grips add a grip type and grip sizes, and limit the finger holes', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Grips'));
  await page.goto(`/customers/${id}/edit`);
  // Without grips each finger has one drilled hole size.
  await expect(page.locator('#field-middle_grip_size')).toHaveCount(0);
  await chooseGrips(page, 'Grips', 'Vaccu');
  await fill(page, 'middle_grip_size', '37/64');
  await fill(page, 'middle_hole', '31/32');
  await expect(page.locator('#field-ring_hole option')).toHaveText(['–', '7/8"', '31/32"', '1 1/32"']);
  await fill(page, 'bridge', '1/4');
  await page.locator('#field-thumb_insert_type').selectOption('Turbo');
  await expect(page.locator('#field-thumb_hole')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await expect(slot(page, 'middle_grip_size')).toHaveText('37/64 (0.5)');
  await expect(slot(page, 'middle_hole')).toHaveText('31/32');
  await expect(slot(page, 'bridge')).toHaveText('1/4');
  await expect(slot(page, 'thumb_hole')).toHaveText('N/A');
  await expect(page.locator('.sheet [data-choice="vaccu"]')).toHaveClass(/is-on/);
});

test('ball motion, one or two handed and who wrote the specs save with the sheet', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Ball Motion'));
  await page.goto(`/customers/${id}/edit`);
  // The bowler block is at the top of the editor, with hand and style.
  await expect(page.locator('.bowler')).toBeVisible();
  await page.locator('.bowler').getByLabel('Two Handed', { exact: true }).check();
  await page.getByLabel('Right-handed').check();
  await page.locator('#field-rev_rate').fill('450');
  await page.locator('#field-axis_rotation').fill('45');
  await page.locator('#field-axis_tilt').fill('12');
  await page.locator('#field-speed').fill('17.5');
  // P.A.P opens wheels for horizontal and vertical, with Up or Down.
  await page.locator('#field-pap').click();
  const pap = page.getByRole('dialog', { name: 'P.A.P' });
  await pap.getByRole('listbox', { name: 'Horizontal inches' }).getByRole('option', { name: '5', exact: true }).click();
  await pap.getByRole('listbox', { name: 'Horizontal fraction' }).getByRole('option', { name: '1/2', exact: true }).click();
  await pap.getByRole('listbox', { name: 'Vertical inches' }).getByRole('option', { name: '0', exact: true }).click();
  await pap.getByRole('listbox', { name: 'Vertical fraction' }).getByRole('option', { name: '1/2', exact: true }).click();
  await pap.getByRole('button', { name: 'Up' }).click();
  await pap.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#field-pap')).toHaveAttribute('data-value', '5 1/2 over, 1/2 up');
  await page.locator('#field-written_by').fill('Fictional Pat');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));

  await expect(page.locator('.bowler')).toContainText('Two Handed');
  await expect(page.locator('.bowler')).toContainText('Right-handed');
  const footer = page.locator('.sheet-footer');
  await expect(footer.locator('[data-field="rev_rate"]')).toContainText('450');
  await expect(footer.locator('[data-field="speed"]')).toContainText('17.5');
  await expect(footer.locator('[data-field="pap"]')).toContainText('5 1/2 over, 1/2 up');
  await page.getByText('All measurements as text').click();
  await expect(page.locator('.sheet-table tr', { hasText: 'P.A.P vertical' })).toContainText('1/2" Up');
  await page.getByText('All measurements as text').click();
  await expect(footer.locator('[data-field="written_by"]')).toContainText('Fictional Pat');

  // Names used before are offered next time.
  await page.getByRole('link', { name: 'Edit measurements' }).click();
  await expect(page.locator('#spec-authors option[value="Fictional Pat"]')).toHaveCount(1);
  await page.locator('#field-axis_rotation').fill('95');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter 0 to 90').first()).toBeVisible();
});
