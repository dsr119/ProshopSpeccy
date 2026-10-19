import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createCustomer, pickWheel, unique } from './helpers';

// Open-link mode: the shop is switched on directly in the local database
// (as the owner would in the SQL editor), then used without signing in.
const DB_URL = process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const SAMPLE = { name: 'fictional-sheet.png', mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

function setOpen(open: boolean) {
  execFileSync('psql', [DB_URL, '-qc', `update public.shops set open_access = ${open}`]);
}

test.afterEach(() => setOpen(false));

test('with the open link on, anyone can add a customer, save specs and upload a photo without signing in', async ({ page }) => {
  setOpen(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);

  const id = await createCustomer(page, unique('Fictional Open Link'));
  await page.getByRole('link', { name: 'Create digital specs' }).first().click();
  await pickWheel(page, 'field-middle_hole', '3/4');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/customers/${id}$`));
  await page.goto(`/customers/${id}/history`);
  await expect(page.getByText('Shared link').first()).toBeVisible();

  await page.goto(`/customers/${id}/photos`);
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.getByLabel('Spec sheet', { exact: true }).check();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();

  // Switching it off brings the sign-in page back.
  setOpen(false);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});
