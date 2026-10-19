import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fillField, loginAsStaff, passSheet, slot, unique } from './helpers';

const SHEET = { mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

test('paper sheets go into the queue, get typed in, and land in the app with their photos, front and back', async ({ page }) => {
  await loginAsStaff(page);
  // The app itself has no way into the queue.
  await expect(page.locator('a[href*="intake"]')).toHaveCount(0);

  await page.goto('/intake/');
  await page.getByLabel('Your name').fill('Sam Intake');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Paper spec sheets' })).toBeVisible();
  await expect(page.locator('[data-count="waiting"] dd')).not.toHaveText('–');
  const waitingBefore = Number((await page.locator('[data-count="waiting"] dd').textContent())?.replace(/\D/g, '') || 0);

  await page.getByRole('link', { name: 'Take photos of sheets' }).click();
  await page.getByTestId('library-input').setInputFiles([
    { name: 'paper-1.png', ...SHEET },
    { name: 'paper-2.png', ...SHEET },
  ]);
  await expect(page.getByRole('status')).toHaveText('2 sheets added to the queue');
  // The first sheet has something written on the back.
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.intake-uploads li', { hasText: 'paper-1.png' }).getByRole('button', { name: 'Add the back' }).click();
  await (await chooser).setFiles({ name: 'paper-1-back.png', ...SHEET });
  await expect(page.getByRole('status')).toHaveText('2 sheets added to the queue (1 with a back)');
  await expect(page.locator('.intake-uploads li', { hasText: 'paper-1.png' })).toContainText('Front and back in the queue');
  await page.getByRole('link', { name: '← Queue' }).click();
  await expect(page.locator('[data-count="waiting"] dd')).toHaveText(String(waitingBefore + 2));

  // Skip ahead to this test's own sheets if older ones are waiting; passing opens the next one.
  await page.getByRole('button', { name: 'Type in the next sheet' }).click();
  for (let i = 0; i < waitingBefore; i++) {
    const url = page.url();
    await passSheet(page, 'Too blurry');
    await expect(page).not.toHaveURL(url);
  }

  await expect(page.locator('.intake-photo img')).toBeVisible();
  const frontSrc = await page.locator('.intake-photo img').getAttribute('src');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('.intake-photo img')).not.toHaveAttribute('src', frontSrc!);
  const bowler = unique('Fictional Paper Bowler');
  await page.getByRole('button', { name: 'Add a new bowler' }).click();
  await page.getByLabel(/^Name/).fill(bowler);
  await page.getByRole('button', { name: 'Add bowler and continue' }).click();
  await fillField(page, 'bridge', '1/4');
  // The balls from the back of the paper sheet go in too.
  await page.locator('.balls-editor').getByRole('button', { name: 'Add a ball' }).click();
  await page.getByTestId('ball-row').getByLabel('Ball 1', { exact: true }).fill('Fictional Paper Ball');
  await page.getByTestId('ball-row').getByLabel('Weight').selectOption('15');
  await page.getByTestId('ball-row').getByLabel('Layout').fill('5 x 4 1/2 x 2');
  const first = page.url();
  await page.getByRole('button', { name: 'Save and send to the app' }).click();

  // The next sheet opens straight away.
  await expect(page).not.toHaveURL(first);
  await expect(page.getByText('1. Find the bowler.')).toBeVisible();
  await passSheet(page, 'Incomplete specs', 'Ring span missing');
  await expect(page.getByText('That sheet is in the passed pile.')).toBeVisible();
  const passed = page.locator('.intake-list', { hasText: 'Passed sheets' }).locator('li').first();
  await expect(passed).toContainText('Incomplete specs · Ring span missing');
  await expect(passed).toContainText('passed by');

  const open = page.locator('.intake-list', { hasText: 'Recently put in the app' }).getByRole('link', { name: 'Open in the app' }).first();
  const href = await open.getAttribute('href');
  await page.goto(href!);
  await expect(page.getByRole('heading', { level: 1, name: bowler })).toBeVisible();
  await expect(slot(page, 'bridge')).toHaveText('1/4');
  await expect(page.getByRole('button', { name: 'Photos (2)' })).toBeVisible();
  await expect(page.locator('.balls-list')).toContainText('Fictional Paper Ball');
  await expect(page.locator('.balls-list')).toContainText('5 x 4 1/2 x 2');

  // Signing in as "admin" shows who has done what; nobody else sees it.
  await page.goto('/intake/');
  await expect(page.getByRole('heading', { name: 'Who has done what' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Not you?' }).click();
  await page.getByLabel('Your name').fill('Admin');
  await page.getByRole('button', { name: 'Continue' }).click();
  const row = page.locator('.intake-people__table tbody tr', { hasText: 'Sam Intake' });
  await expect(row.locator('td').nth(0)).not.toHaveText('0');
  await expect(row.locator('td').nth(3)).not.toHaveText('0');
});
