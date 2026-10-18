import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { fillField, loginAsStaff, slot, unique } from './helpers';

const SHEET = { mimeType: 'image/png', buffer: readFileSync('public/assets/specSheet550wide.png') };

test('paper sheets go into the queue, get typed in, and land in the app with their photo', async ({ page }) => {
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
  await expect(page.getByRole('status')).toHaveText('2 added to the queue');
  await page.getByRole('link', { name: '← Queue' }).click();
  await expect(page.locator('[data-count="waiting"] dd')).toHaveText(String(waitingBefore + 2));

  // Skip ahead to this test's own sheets if older ones are waiting.
  for (let i = 0; i < waitingBefore; i++) {
    await page.getByRole('button', { name: 'Type in the next sheet' }).click();
    await page.getByRole('button', { name: 'Can\'t read it' }).click();
    await page.getByRole('button', { name: 'Set aside' }).click();
    await expect(page.getByRole('heading', { name: 'Paper spec sheets' })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Type in the next sheet' }).click();
  await expect(page.locator('.intake-photo img')).toBeVisible();
  const bowler = unique('Fictional Paper Bowler');
  await page.getByRole('button', { name: 'Add a new bowler' }).click();
  await page.getByLabel(/^Name/).fill(bowler);
  await page.getByRole('button', { name: 'Add bowler and continue' }).click();
  await fillField(page, 'bridge', '1/4');
  const first = page.url();
  await page.getByRole('button', { name: 'Save and send to the app' }).click();

  // The next sheet opens straight away.
  await expect(page).not.toHaveURL(first);
  await expect(page.getByText('1. Find the bowler.')).toBeVisible();
  await page.getByRole('button', { name: 'Can\'t read it' }).click();
  await page.getByLabel(/What's wrong/).fill('Blurry');
  await page.getByRole('button', { name: 'Set aside' }).click();
  await expect(page.locator('.intake-list', { hasText: 'Set aside as unreadable' })).toContainText('Blurry');

  const open = page.locator('.intake-list', { hasText: 'Recently put in the app' }).getByRole('link', { name: 'Open in the app' }).first();
  const href = await open.getAttribute('href');
  await page.goto(href!);
  await expect(page.getByRole('heading', { level: 1, name: bowler })).toBeVisible();
  await expect(slot(page, 'bridge')).toHaveText('1/4');
  await expect(page.getByRole('button', { name: 'Photos (1)' })).toBeVisible();
});
