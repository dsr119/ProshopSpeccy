import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

export const PASSWORD = 'dev-password-123';
export const USERS = {
  admin: 'admin@example.test',
  staff: 'staff@example.test',
  staff2: 'staff2@example.test',
  outsider: 'outsider@example.test',
};

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
// Local development publishable key printed by `supabase start` (not a secret).
export const PUBLIC_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';

export async function login(page: Page, email: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function loginAsStaff(page: Page, email = USERS.staff) {
  await login(page, email);
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
}

export function unique(prefix: string) {
  return `${prefix} ${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
}

export async function createCustomer(page: Page, name: string, phone = '') {
  await page.goto('/customers/new');
  await page.getByLabel(/^Name/).fill(name);
  if (phone) await page.getByLabel(/^Phone/).fill(phone);
  await page.getByRole('button', { name: /Create/ }).click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  return page.url().split('/customers/')[1].split('?')[0];
}

export async function apiClient(email?: string) {
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (email) {
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw error;
  }
  return client;
}

/** Text shown in a sheet slot. */
export function slot(page: Page, field: string) {
  return page.locator(`.sheet [data-field="${field}"]`).first();
}

/** A pitch box for one direction on the sheet. */
export function dirSlot(page: Page, field: string, dir: string) {
  return page.locator(`.sheet [data-field="${field}"][data-dir="${dir}"]`);
}

/** Picks a span such as "4 3/8" on the two-wheel picker: whole inches, then the fraction. */
export async function pickSpan(page: Page, field: string, value: string) {
  const [whole, fraction = '0'] = value.split(' ');
  await page.locator(`#field-${field}`).click();
  const picker = page.getByRole('dialog');
  await picker.getByRole('listbox', { name: 'Inches' }).getByRole('option', { name: whole, exact: true }).click();
  await picker.getByRole('listbox', { name: 'Fraction' }).getByRole('option', { name: fraction, exact: true }).click();
  await picker.getByRole('button', { name: 'Done' }).click();
  await expect(picker).toHaveCount(0);
}

/** Expects a span box to hold this value. */
export async function expectSpan(page: Page, field: string, value: string) {
  await expect(page.locator(`#field-${field}`)).toHaveAttribute('data-value', value);
}

/** Chooses the span measured with the F / C / CTO circles on the sheet, unless it's already chosen. */
export async function chooseSpanType(page: Page, label: 'Full Span' | 'Cut to Cut' | 'Cut to Outer') {
  const button = page.getByRole('button', { name: label, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
}

/**
 * Enters a value on the sheet. Pitch boxes are pickers per direction (finger
 * lateral is one amount picker, turned by tapping its arrow), spans are two wheels on the chosen span type,
 * sizes are lists, and the rest is typed.
 */
export async function fillField(page: Page, field: string, value: string, dir?: string) {
  const span = /^(middle|ring)_(cut_to_cut|full_span|cut_to_outer)$/.exec(field);
  if (span) {
    await chooseSpanType(page, SPAN_TYPE_BUTTONS[span[2]]);
    await pickSpan(page, field, value);
  } else if (/^(middle|ring)_lateral_pitch$/.test(field)) {
    await page.locator(`#field-${field}`).selectOption(value);
    const flip = page.locator(`#flip-${field}`);
    if (dir && dir !== 'none' && value !== '0' && (await flip.getAttribute('data-dir')) !== dir) await flip.click();
  } else if (field.endsWith('_pitch')) {
    const box = !dir || dir === 'none' ? (field.endsWith('fr_pitch') ? 'forward' : 'left') : dir;
    await page.locator(`#field-${field}-${box}`).selectOption(value);
  } else {
    const input = page.locator(`#field-${field}`);
    // Measurements kept off the sheet are under "More measurements".
    if (!(await input.isVisible())) await page.getByText('More measurements').click();
    // Holes, grip sizes, bridge and slug size scroll through a list; the rest are typed.
    if ((await input.evaluate((el) => el.tagName)) === 'SELECT') await input.selectOption(value);
    else await input.fill(value);
  }
}

const SPAN_TYPE_BUTTONS = { cut_to_cut: 'Cut to Cut', full_span: 'Full Span', cut_to_outer: 'Cut to Outer' } as const;

/** Chooses Grips or No Grips above the bridge, and STD or Vaccu when there are grips. */
export async function chooseGrips(page: Page, grips: 'Grips' | 'No Grips', type?: 'STD' | 'Vaccu') {
  const button = page.getByRole('button', { name: grips, exact: true });
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
  if (type) await page.getByRole('button', { name: type, exact: true }).click();
}

/** Picks a name on the intake sign-in list; a name not on it is added by signing in as Admin first. */
export async function intakeSignIn(page: Page, name: string) {
  const pick = page.getByRole('list', { name: 'Your name' }).getByRole('button', { name, exact: true });
  await expect(page.getByRole('list', { name: 'Your name' })).toBeVisible();
  if (name !== 'Admin' && (await pick.count()) === 0) {
    await intakeSignIn(page, 'Admin');
    await page.getByLabel('Add a name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`${name} is on the list.`);
    await page.getByRole('button', { name: 'Not you?' }).click();
  }
  await pick.click();
}

/** Passes the open intake sheet with a reason. */
export async function passSheet(page: Page, reason: string, note?: string) {
  await page.getByRole('button', { name: 'Pass', exact: true }).click();
  await page.getByRole('radio', { name: reason }).check();
  if (note) await page.getByRole('dialog').getByLabel(/^Note/).fill(note);
  await page.getByRole('button', { name: 'Pass and get the next one' }).click();
}
