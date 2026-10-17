import { expect, test } from '@playwright/test';
import { createCustomer, loginAsStaff, unique } from './helpers';

test('create a customer and find them by partial name in any case, or by phone', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Casey Bowler');
  const id = await createCustomer(page, name, '(555) 019-8765');
  await expect(page.getByText('Customer created')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create digital specs' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Upload original sheet' })).toBeVisible();

  await page.goto('/');
  const search = page.getByLabel('Search by name or phone');
  await search.fill(name.split(' ').slice(-1)[0].toUpperCase().slice(0, 6));
  await expect(page.locator('.results')).toContainText(name);
  await search.fill('casey BOWL');
  await expect(page.locator('.results')).toContainText(name);
  await search.fill('555.019.8765');
  await expect(page.locator('.results')).toContainText(name);
  await search.fill('zzzz-no-such-customer');
  await expect(page.getByText(/No customers match/)).toBeVisible();

  // Keyboard navigation opens the highlighted result.
  await search.fill(name);
  await expect(page.locator('.results li')).toHaveCount(1);
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/customers/${id}`));
});

test('two customers with the same name coexist and are distinguishable', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Same Name');
  await createCustomer(page, name, '555-010-1111');
  await page.goto('/customers/new');
  await page.getByLabel(/^Name/).fill(name.toLowerCase());
  await page.getByLabel(/^Phone/).fill('555-010-2222');
  await expect(page.getByText(/Possible existing customer/)).toBeVisible();
  await page.getByRole('button', { name: 'Create as new customer' }).click();
  await expect(page.getByText('Customer created')).toBeVisible();

  await page.goto('/');
  await page.getByLabel('Search by name or phone').fill(name);
  const results = page.locator('.results li');
  await expect(results).toHaveCount(2);
  await expect(results.nth(0)).toContainText(/555-010-(1111|2222)/);
  await expect(results.nth(1)).toContainText(/555-010-(1111|2222)/);
});

test('blank names are refused and customer details can be edited', async ({ page }) => {
  await loginAsStaff(page);
  await page.goto('/customers/new');
  await page.getByLabel(/^Name/).fill('   ');
  await page.getByRole('button', { name: /Create/ }).click();
  await expect(page.getByText('Enter the customer name')).toBeVisible();

  const name = unique('Fictional Editable');
  await createCustomer(page, name);
  await page.getByRole('button', { name: 'Edit customer details' }).click();
  await page.getByRole('dialog').getByLabel(/^Phone/).fill('555 010 3333');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.customer-head')).toContainText('555 010 3333');
});
