import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Public browser key only (publishable or legacy anon). Access is enforced by
// row-level security and storage policies in the database.
const publicKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as
  | string
  | undefined;

export const supabaseUrl = url;
export const supabasePublicKey = publicKey;

export const isConfigured = Boolean(url && publicKey);

export const supabase = createClient(url || 'http://invalid.localhost', publicKey || 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const PHOTO_BUCKET = 'spec-photos';
export const INTAKE_BUCKET = 'intake-photos';
