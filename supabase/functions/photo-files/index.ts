// Hands out short-lived links to photo files kept in Cloudflare R2, and removes
// unused ones. The database decides, as the caller, which files they may touch
// (public.r2_keys_allowed); the R2 key never leaves this function.
//
// Secrets: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ACCOUNT_ID. Optional:
// R2_BUCKET (default proshop-photos), R2_ENDPOINT and R2_REGION (local testing).

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';

const LINK_SECONDS = 3600;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405, { error: 'Use POST' });

  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
  const account = Deno.env.get('R2_ACCOUNT_ID');
  const endpoint = Deno.env.get('R2_ENDPOINT') || (account ? `https://${account}.r2.cloudflarestorage.com` : '');
  const bucket = Deno.env.get('R2_BUCKET') || 'proshop-photos';
  if (!accessKeyId || !secretAccessKey || !endpoint) {
    return reply(503, { error: "Photo storage isn't set up yet." });
  }
  // Opening the link in a browser shows whether the secrets are in place.
  if (req.method === 'GET') return reply(200, { ok: true, bucket });

  let op: string, keys: string[];
  try {
    ({ op, keys } = await req.json());
  } catch {
    return reply(400, { error: 'Send JSON with op and keys' });
  }
  if (!['status', 'get', 'put', 'delete'].includes(op)) return reply(400, { error: 'Unknown op' });
  if (op === 'status') return reply(200, { ok: true, bucket });
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 50 || keys.some((k) => typeof k !== 'string')) {
    return reply(400, { error: 'Send 1 to 50 keys' });
  }

  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, apikey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? `Bearer ${apikey}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const allowed = await db.rpc('r2_keys_allowed', { p_keys: keys, p_op: op });
  if (allowed.error) return reply(502, { error: allowed.error.message });
  if (allowed.data !== true) return reply(403, { error: "You can't use that photo." });

  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: Deno.env.get('R2_REGION') || 'auto' });
  const base = `${endpoint.replace(/\/$/, '')}/${bucket}/`;

  if (op === 'delete') {
    for (const key of keys) {
      const res = await r2.fetch(base + encodeKey(key), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) return reply(502, { error: `Delete failed (${res.status})` });
    }
    return reply(200, { deleted: keys.length });
  }

  const urls: Record<string, string> = {};
  for (const key of keys) {
    const signed = await r2.sign(new Request(`${base}${encodeKey(key)}?X-Amz-Expires=${LINK_SECONDS}`, { method: op === 'put' ? 'PUT' : 'GET' }), {
      aws: { signQuery: true },
    });
    urls[key] = signed.url;
  }
  return reply(200, { urls });
});
