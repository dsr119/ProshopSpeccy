import { supabase } from '../lib/supabase';
import { unwrap } from '../lib/errors';

export interface Customer {
  id: string;
  shop_id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  last_spec_at: string | null;
  last_spec_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerSearchRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  last_spec_at: string | null;
  updated_at: string;
  photo_count: number;
  has_specs: boolean;
  total_count: number;
}

export interface DuplicateRow {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  reason: string;
}

export const PAGE_SIZE = 25;

export async function searchCustomers(query: string, offset = 0, signal?: AbortSignal): Promise<CustomerSearchRow[]> {
  let req = supabase.rpc('search_customers', { p_query: query, p_limit: PAGE_SIZE, p_offset: offset });
  if (signal) req = req.abortSignal(signal);
  return unwrap(await req) as CustomerSearchRow[];
}

export async function findPossibleDuplicates(name: string, phone: string): Promise<DuplicateRow[]> {
  return unwrap(await supabase.rpc('find_possible_duplicates', { p_name: name, p_phone: phone || null })) as DuplicateRow[];
}

export async function getCustomer(id: string): Promise<Customer> {
  return unwrap(await supabase.from('customers').select('*').eq('id', id).single()) as Customer;
}

export interface CustomerInput {
  name: string;
  phone: string;
  notes: string;
}

export function validateCustomer(input: CustomerInput): Partial<Record<keyof CustomerInput, string>> {
  const errors: Partial<Record<keyof CustomerInput, string>> = {};
  if (!input.name.trim()) errors.name = 'Enter the customer name';
  else if (input.name.length > 200) errors.name = 'Keep the name under 200 characters';
  if (input.phone.length > 40) errors.phone = 'Phone is too long';
  if (input.notes.length > 4000) errors.notes = 'Keep notes under 4000 characters';
  return errors;
}

export async function createCustomer(shopId: string, input: CustomerInput): Promise<Customer> {
  return unwrap(
    await supabase
      .from('customers')
      .insert({ shop_id: shopId, name: input.name.trim(), phone: input.phone.trim() || null, notes: input.notes.trim() || null })
      .select('*')
      .single(),
  ) as Customer;
}

export async function updateCustomer(id: string, input: CustomerInput): Promise<Customer> {
  return unwrap(
    await supabase
      .from('customers')
      .update({ name: input.name.trim(), phone: input.phone.trim() || null, notes: input.notes.trim() || null })
      .eq('id', id)
      .select('*')
      .single(),
  ) as Customer;
}

export async function getStaffName(shopId: string, userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('staff_memberships')
    .select('display_name, email')
    .eq('shop_id', shopId)
    .eq('user_id', userId)
    .maybeSingle();
  return data ? data.display_name || data.email : null;
}
