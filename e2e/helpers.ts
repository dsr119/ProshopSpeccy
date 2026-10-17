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
