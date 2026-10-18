import { expect, test } from '@playwright/test';
import { USERS, apiClient, createCustomer, login, loginAsStaff, unique } from './helpers';

test('signed-out visitors only see the sign-in page', async ({ page }) => {
  await page.goto('/customers/00000000-0000-4000-8000-0000000c0001');
  await expect(page.getByRole('heading', { name: 'Pro Shop Spec Sheets' })).toBeVisible();
  await expect(page.getByText('Fictional Pat Example')).toHaveCount(0);
});

test('an account without shop membership gets no customer data', async ({ page }) => {
  await login(page, USERS.outsider);
  await expect(page.getByRole('heading', { name: 'No shop access' })).toBeVisible();
  await page.goto('/customers/00000000-0000-4000-8000-0000000c0001');
  await expect(page.getByText('Fictional Pat Example')).toHaveCount(0);
});

test('direct API requests from signed-out and nonmember users read and change nothing', async () => {
  const anon = await apiClient();
  const anonRead = await anon.from('customers').select('*');
  expect(anonRead.data ?? []).toHaveLength(0);
  const anonRpc = await anon.rpc('save_fit_revision', {
    p_customer_id: '00000000-0000-4000-8000-0000000c0001',
    p_expected_lock_version: 1,
    p_snapshot: {},
  });
  expect(anonRpc.error).not.toBeNull();

  const outsider = await apiClient(USERS.outsider);
  expect((await outsider.from('customers').select('*')).data).toEqual([]);
  expect((await outsider.from('fit_revisions').select('*')).data).toEqual([]);
  expect((await outsider.from('spec_photos').select('*')).data).toEqual([]);
  const insert = await outsider.from('customers').insert({ shop_id: '00000000-0000-4000-8000-00000000005a', name: 'Intruder' });
  expect(insert.error).not.toBeNull();
  const update = await outsider.from('customers').update({ name: 'Hacked' }).eq('id', '00000000-0000-4000-8000-0000000c0001').select();
  expect(update.data ?? []).toEqual([]);
  const save = await outsider.rpc('save_fit_revision', {
    p_customer_id: '00000000-0000-4000-8000-0000000c0001',
    p_expected_lock_version: 1,
    p_snapshot: { middle_hole: { entered: '1' } },
  });
  expect(save.error?.code).toBe('PT404');
  const list = await outsider.storage.from('spec-photos').list('00000000-0000-4000-8000-00000000005a');
  expect(list.data ?? []).toEqual([]);

  const staff = await apiClient(USERS.staff);
  expect(((await staff.from('customers').select('id')).data ?? []).length).toBeGreaterThan(0);
});

test('recently viewed customers do not carry over to the next person after sign out', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Recent');
  await createCustomer(page, name);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Recently viewed on this device' })).toBeVisible();
  await expect(page.locator('.recent')).toContainText(name);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await loginAsStaff(page, USERS.staff2);
  await expect(page.locator('.recent')).toHaveCount(0);
});

test('an expired session sends staff to sign in with a clear message', async ({ page }) => {
  await loginAsStaff(page);
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('sb-')) localStorage.removeItem(k);
  });
  // A server rejection of the token triggers the session-expired path.
  await page.route('**/rest/v1/rpc/list_customers', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST303', message: 'JWT expired' }) }),
  );
  await page.getByLabel('Search by name or phone').fill('pat');
  await expect(page.getByText('Your session expired')).toBeVisible();
});
