import { expect, test } from '@playwright/test';
import { createCustomer, loginAsStaff, unique } from './helpers';

test('create a customer and find them by partial name in any case, or by phone', async ({ page }) => {
  await loginAsStaff(page);
  const name = unique('Fictional Casey Bowler');
  const id = await createCustomer(page, name, '(555) 019-8765');
  await expect(page.getByText('Customer created')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Create digital specs' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Add a photo' })).toBeVisible();

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
  await page.getByRole('button', { name: 'Edit bowler details' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Phone/).fill('555 010 3333');
  await dialog.getByLabel('Mobile').check();
  await dialog.getByLabel(/^Email/).fill('casey@example.test');
  await dialog.getByLabel(/^Address/).fill('100 Fictional Lane');
  await dialog.getByLabel('City').fill('Springfield');
  await dialog.getByLabel('State').fill('IL');
  await dialog.getByLabel('Zip code').fill('62701');
  await dialog.getByRole('button', { name: 'Save' }).click();
  // Bowler details sit at the top, like the paper sheet.
  const bowler = page.locator('.bowler');
  await expect(bowler).toContainText('555 010 3333');
  await expect(bowler).toContainText('Mobile');
  await expect(bowler).toContainText('casey@example.test');
  await expect(bowler).toContainText('100 Fictional Lane');
  await expect(bowler).toContainText('Springfield, IL 62701');
  await dialog.getByLabel(/^Email/).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Edit bowler details' }).click();
  await dialog.getByLabel(/^Email/).fill('not an email');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByText('Enter an email like name@example.com')).toBeVisible();
});

test('the dashboard lists every customer alphabetically by last name, with other sorts', async ({ page }) => {
  await loginAsStaff(page);
  const tag = unique('Fictionalsort').split(' ')[1];
  await createCustomer(page, `Aaron ${tag} Zimmer`, '555-010-7001');
  await createCustomer(page, `Zoe ${tag} Adams`, '555-010-7002');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Everyone, by last name/ })).toBeVisible();
  await page.getByLabel('Search by name or phone').fill(tag);
  const cards = page.locator('.results li');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('Adams');
  await expect(cards.nth(0)).toContainText('ZA');
  await expect(cards.nth(0)).toContainText('0 spec sheets');
  await expect(cards.nth(0)).toContainText('0 balls');
  await page.getByLabel('Sort by').selectOption('name');
  await expect(cards.nth(0)).toContainText('Zimmer');
  await page.getByLabel('Sort by').selectOption('created');
  await expect(cards.nth(0)).toContainText('Adams');
});
