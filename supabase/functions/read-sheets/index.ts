// Reads the bowler's name and phone number off paper sheet photos in the intake
// queue with Claude, and saves them on the sheet as a suggestion for whoever
// types it in. Each sheet is read at most once, so calling this repeatedly can
// never cost more than one read per sheet.
//
// POST {"limit": n} reads up to n (1 to 25, default 10) sheets nobody has read
// yet, oldest first. GET shows whether the key is set and how many are left.
//
// Secrets: ANTHROPIC_API_KEY, plus the R2 ones photo-files uses. Optional:
// ANTHROPIC_MODEL (default claude-haiku-5-5), R2_BUCKET, R2_ENDPOINT, R2_REGION.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';

const AT_ONCE = 5;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');

function toBase64(bytes: Uint8Array) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

const PROMPT = `This is a photo of a paper bowling ball spec (drill) sheet from a pro shop. Read only two things from it:

- name: the bowler's name, as written on the Name line. Keep "Jr", "Sr" and the like. Skip anything crossed out.
- phone: the bowler's phone number. It is usually on the Phone or Cell line, but some forms have no phone line and it gets written elsewhere, often on the E-mail line. Write it as digits with dashes, like 570-555-1234. If some digits are missing, write only what is there.

Ignore everything printed by the form maker (company names, addresses, 800 numbers) and anything on other sheets visible around this one. Use "" for a field that is blank or not on the sheet. Set unsure to true if any letter or digit you returned was hard to read or a guess.`;

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    phone: { type: 'string' },
    unsure: { type: 'boolean' },
  },
  required: ['name', 'phone', 'unsure'],
  additionalProperties: false,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405, { error: 'Use POST' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
  const model = Deno.env.get('ANTHROPIC_MODEL')?.trim() || 'claude-haiku-5-5';

  const unread = () =>
    db
      .from('intake_items')
      .select('id', { count: 'exact', head: true })
      .is('removed_at', null)
      .eq('store', 'r2')
      .neq('status', 'done')
      .is('read_at', null);

  if (req.method === 'GET') {
    const left = await unread();
    return reply(200, { ok: !!apiKey, keySet: !!apiKey, model, unread: left.count, error: left.error?.message });
  }
  if (!apiKey) return reply(503, { error: 'ANTHROPIC_API_KEY is not set yet.' });

  let limit = 10;
  try {
    const body = await req.json();
    if (body?.limit !== undefined) limit = Number(body.limit);
  } catch {
    // No body: read the default number of sheets.
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return reply(400, { error: 'limit must be 1 to 25' });

  const accessKeyId = Deno.env.get('R2_ACCESS_KEY_ID')?.trim();
  const secretAccessKey = Deno.env.get('R2_SECRET_ACCESS_KEY')?.trim();
  const account = (Deno.env.get('R2_ACCOUNT_ID') ?? '')
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\.r2\.cloudflarestorage\.com.*$/, '')
    .replace(/\/.*$/, '');
  const endpoint = Deno.env.get('R2_ENDPOINT') || (account ? `https://${account}.r2.cloudflarestorage.com` : '');
  if (!accessKeyId || !secretAccessKey || !endpoint) return reply(503, { error: "Photo storage isn't set up yet." });
  const r2 = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: Deno.env.get('R2_REGION') || 'auto' });
  const base = `${endpoint.replace(/\/$/, '')}/${Deno.env.get('R2_BUCKET') || 'proshop-photos'}/`;

  const picked = await db
    .from('intake_items')
    .select('id, object_path, mime_type')
    .is('removed_at', null)
    .eq('store', 'r2')
    .neq('status', 'done')
    .is('read_at', null)
    .order('created_at')
    .order('id')
    .limit(limit);
  if (picked.error) return reply(502, { error: picked.error.message });

  const client = new Anthropic({ apiKey });
  const results: unknown[] = [];

  async function readOne(item: { id: string; object_path: string; mime_type: string }) {
    let saved: Record<string, unknown>;
    try {
      const file = await r2.fetch(base + encodeKey(item.object_path));
      if (!file.ok) throw new Error(`Photo download failed (${file.status})`);
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      const media = ['image/png', 'image/webp'].includes(item.mime_type) ? item.mime_type : 'image/jpeg';
      const res = await client.messages.create({
        model,
        max_tokens: 4000,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data } },
              { type: 'text', text: PROMPT },
            ],
          },
        ],
      } as Anthropic.MessageCreateParamsNonStreaming);
      if (res.stop_reason === 'refusal') throw new Error('The model declined to read this photo');
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error(`No answer (${res.stop_reason})`);
      const out = JSON.parse(text.text) as { name: string; phone: string; unsure: boolean };
      saved = {
        read_name: out.name.trim().slice(0, 120) || null,
        read_phone: out.phone.trim().slice(0, 40) || null,
        read_unsure: !!out.unsure,
        read_error: null,
      };
    } catch (e) {
      saved = { read_name: null, read_phone: null, read_unsure: null, read_error: (e as Error).message.slice(0, 300) };
    }
    const upd = await db
      .from('intake_items')
      .update({ ...saved, read_at: new Date().toISOString(), read_by: model })
      .eq('id', item.id)
      .is('read_at', null);
    results.push({ id: item.id, ...saved, saveError: upd.error?.message });
  }

  const queue = [...(picked.data ?? [])];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await readOne(item);
    }),
  );

  const left = await unread();
  return reply(200, { read: results.length, unread: left.count, results });
});
