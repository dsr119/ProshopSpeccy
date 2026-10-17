import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { USERS, apiClient, createCustomer, loginAsStaff, unique } from './helpers';

// Any image works as a stand-in for a photographed paper sheet.
const SAMPLE = { name: 'fictional-sheet.png', mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

test('a customer can have an uploaded sheet photo before any digital specs', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Photo Only');
  const id = await createCustomer(page, name);
  await page.getByRole('link', { name: 'Add a photo' }).click();
  // One photo at a time.
  await expect(page.locator('input[type=file][multiple]')).toHaveCount(0);

  // Unsupported files get a clear message.
  const chooser = page.locator('input[type=file]').first();
  await chooser.setInputFiles({ name: 'sheet.heic', mimeType: 'image/heic', buffer: Buffer.from('fake') });
  await expect(page.getByText(/HEIC photos are not supported yet/)).toBeVisible();
  await chooser.setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(16 * 1024 * 1024, 1) });
  await expect(page.getByText(/The limit is 15 MB/)).toBeVisible();

  await chooser.setInputFiles(SAMPLE);
  await expect(page.getByAltText('Preview of the selected photo')).toBeVisible();
  await page.getByRole('button', { name: 'Rotate right' }).click();
  await page.getByLabel(/Caption/).fill('2019 paper sheet');
  // Staff say whether it's a spec sheet or a ball before uploading.
  await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled();
  await page.getByLabel('Spec sheet', { exact: true }).check();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();
  await expect(page.getByAltText('Original sheet: 2019 paper sheet')).toBeVisible();
  // Signed, expiring URL rather than a public link.
  const src = await page.getByAltText('Original sheet: 2019 paper sheet').getAttribute('src');
  expect(src).toContain('/object/sign/spec-photos/');
  expect(src).toContain('token=');

  // A spec sheet photo can be marked as confirmed against the digital sheet.
  const confirmed = page.getByRole('switch', { name: /Digital spec sheet confirmed/ });
  await expect(confirmed).not.toBeChecked();
  await confirmed.click({ force: true });
  await expect(confirmed).toBeChecked();
  await expect(page.locator('.photo-list')).toContainText('Confirmed');

  // A ball picture is labelled as a ball and has no confirmed switch.
  await page.getByRole('button', { name: 'Add a photo' }).click();
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.getByLabel('Picture of a ball').check();
  await page.locator('.upload').getByLabel(/Caption/).fill('Fictional test ball');
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByAltText('Ball photo: Fictional test ball')).toBeVisible();
  await expect(page.getByRole('switch')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('.photo-list li')).toHaveCount(2);
  await page.locator('.photo-list li', { hasText: '2019 paper sheet' }).click();
  await expect(page.getByRole('switch', { name: /Digital spec sheet confirmed/ })).toBeChecked();

  await page.goto(`/customers/${id}`);
  await expect(page.getByText('No digital specs yet.')).toBeVisible();
  await expect(page.getByText(/photos only/)).toBeVisible();

  await page.goto('/');
  await page.getByLabel('Search by name or phone').fill(name);
  await expect(page.locator('.results')).toContainText('2 photos');
  await expect(page.locator('.results')).toContainText('No digital specs');

  // Recorded files cannot be removed through the Storage API, and nonmembers cannot read them.
  const staff = await apiClient(USERS.staff);
  const { data: rows } = await staff.from('spec_photos').select('object_path').eq('customer_id', id);
  const path = rows![0].object_path as string;
  await staff.storage.from('spec-photos').remove([path]);
  const stillThere = await staff.storage.from('spec-photos').createSignedUrl(path, 60);
  expect(stillThere.error).toBeNull();
  const outsider = await apiClient(USERS.outsider);
  const denied = await outsider.storage.from('spec-photos').createSignedUrl(path, 60);
  expect(denied.data).toBeNull();
  const download = await outsider.storage.from('spec-photos').download(path);
  expect(download.data).toBeNull();
});

test('a failed photo record write removes the uploaded file and allows retry', async ({ page }) => {
  await loginAsStaff(page);
  const id = await createCustomer(page, unique('Fictional Upload Retry'));
  await page.goto(`/customers/${id}/photos?upload=1`);
  await page.locator('input[type=file]').first().setInputFiles(SAMPLE);
  await page.getByLabel('Spec sheet', { exact: true }).check();
  await page.route('**/rest/v1/spec_photos*', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  );
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(page.getByText(/Your photo is still selected/)).toBeVisible();

  const staff = await apiClient(USERS.staff);
  const { data: customer } = await staff.from('customers').select('shop_id').eq('id', id).single();
  const listing = await staff.storage.from('spec-photos').list(`${customer!.shop_id}/${id}`);
  expect(listing.data ?? []).toEqual([]);

  await page.unroute('**/rest/v1/spec_photos*');
  await page.getByRole('button', { name: 'Retry upload' }).click();
  await expect(page.getByText('Photo uploaded.')).toBeVisible();
});
