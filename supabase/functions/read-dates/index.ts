// Reads the date written on each paper spec sheet in the intake queue with
// Claude, from the front photo only. Saves the raw answer on sheet_date_read and
// the date on sheet_date; private.copy_sheet_dates() then puts it on the photos.
//
// The photo is shrunk first, which costs about a third as much. A date the
// model is unsure of on the small photo isn't saved; POST with "full": true
// reads those sheets again at full size, and that date is kept.
//
// POST {"ids": [...]} reads those sheets. POST {"limit": n} reads up to n
// sheets with no date reading yet (or a failed one), oldest first; with
// "full": true, sheets whose small reading was unsure. At most 5 sheets per call
// (25 with "full"), since shrinking uses a lot of memory. GET shows whether the
// key is set.
//
// Secrets: ANTHROPIC_API_KEY, plus the R2 ones photo-files uses. Optional:
// ANTHROPIC_MODEL (default claude-sonnet-5-5), R2_BUCKET, R2_ENDPOINT, R2_REGION.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';
import { Image } from 'https://deno.land/x/imagescript@1.3.0/mod.ts';

const AT_ONCE = 5;
const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const VERSION = 1;
/** The photo is shrunk to this long edge: the date is still big enough to read. */
const LONG_EDGE = 1100;

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

const SYSTEM = `You read the date handwritten on a paper bowling ball spec (drill) sheet from a pro shop. It is usually on a DATE line near the top, but can be anywhere on the top sheet. Read only handwriting on the top sheet; ignore printed text, other sheets around it, and anything crossed out. If several dates are written (such as a redrill date), give the most recent one. Some writers make a 2 that looks like a d, a or Q; where a digit belongs, read it as 2.

Return:
- written: the date exactly as written ("" when there is none).
- date: the same date as YYYY-MM-DD, or "" when there is none or it can't be read. Dates are US style, month first. A two-digit year means 20YY, unless that would be after 2026, then 19YY. If the day or month is missing, give "" for date (keep written).
- unsure: true when the date is hard to read or partly a guess.`;

const SCHEMA = {
  type: 'object',
  properties: {
    written: { type: 'string' },
    date: { type: 'string' },
    unsure: { type: 'boolean' },
  },
  required: ['written', 'date', 'unsure'],
  additionalProperties: false,
};

/** A real calendar date from 1970 to today, else null. */
function validDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  if (s < '1970-01-01' || d.getTime() > Date.now()) return null;
  return s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405, { error: 'Use POST' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
  const defaultModel = Deno.env.get('ANTHROPIC_MODEL')?.trim() || MODELS[0];
  if (req.method === 'GET') return reply(200, { ok: !!apiKey, keySet: !!apiKey, model: defaultModel, version: VERSION });
  if (!apiKey) return reply(503, { error: 'ANTHROPIC_API_KEY is not set yet.' });

  let body: { limit?: unknown; ids?: unknown; model?: unknown; full?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // No body: read the default number of sheets.
  }
  const full = body.full === true;
  const most = full ? 25 : 5;
  const limit = body.limit === undefined ? most : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > most) return reply(400, { error: `limit must be 1 to ${most}` });
  const ids = body.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > most || ids.some((i) => typeof i !== 'string'))) {
    return reply(400, { error: `ids must be 1 to ${most} sheet ids` });
  }
  const model = body.model === undefined ? defaultModel : String(body.model);
  if (!MODELS.includes(model) && model !== defaultModel) return reply(400, { error: `model must be one of ${MODELS.join(', ')}` });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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

  let query = db.from('intake_items').select('id, object_path, mime_type').is('removed_at', null).eq('store', 'r2');
  query = ids
    ? query.in('id', ids as string[])
    : full
      ? query.eq('sheet_date_read->>unsure', 'true').is('sheet_date_read->>full', null).order('created_at').order('id').limit(limit)
      : query.or('sheet_date_read.is.null,sheet_date_read->>error.not.is.null').order('created_at').order('id').limit(limit);
  const picked = await query;
  if (picked.error) return reply(502, { error: picked.error.message });

  const client = new Anthropic({ apiKey });
  const results: unknown[] = [];

  async function readOne(item: { id: string; object_path: string; mime_type: string }) {
    let read: Record<string, unknown>;
    let date: string | null = null;
    let usage: unknown = null;
    try {
      const file = await r2.fetch(base + encodeKey(item.object_path));
      if (!file.ok) throw new Error(`Photo download failed (${file.status})`);
      let bytes = new Uint8Array(await file.arrayBuffer());
      let media = ['image/png', 'image/webp'].includes(item.mime_type) ? item.mime_type : 'image/jpeg';
      if (!full) {
        const img = await Image.decode(bytes);
        const scale = LONG_EDGE / Math.max(img.width, img.height);
        if (scale < 1) img.resize(Math.round(img.width * scale), Math.round(img.height * scale));
        bytes = await img.encodeJPEG(85);
        media = 'image/jpeg';
      }
      const res = await client.messages.create({
        model,
        max_tokens: 1000,
        system: SYSTEM,
        output_config: { ...(model.includes('haiku') ? {} : { effort: 'low' }), format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: media, data: toBase64(bytes) } },
              { type: 'text', text: 'What date is written on this sheet?' },
            ],
          },
        ],
      } as Anthropic.MessageCreateParamsNonStreaming);
      usage = res.usage;
      if (res.stop_reason === 'refusal') throw new Error('The model declined to read this photo');
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error(`No answer (${res.stop_reason})`);
      const out = JSON.parse(text.text) as { written: string; date: string; unsure: boolean };
      date = out.unsure && !full ? null : validDate(out.date.trim());
      read = { v: VERSION, model, at: new Date().toISOString(), ...out, ...(full ? { full: true } : {}), usage };
    } catch (e) {
      read = { v: VERSION, model, at: new Date().toISOString(), error: (e as Error).message.slice(0, 300), usage };
      // A failed full-size read leaves the small reading as it was.
      if (full) {
        results.push({ id: item.id, ...read });
        return;
      }
    }
    const upd = await db.from('intake_items').update({ sheet_date_read: read, sheet_date: date }).eq('id', item.id);
    results.push({ id: item.id, sheet_date: date, ...read, saveError: upd.error?.message });
  }

  const queue = [...(picked.data ?? [])];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await readOne(item);
    }),
  );
  return reply(200, { read: results.length, model, results });
});
