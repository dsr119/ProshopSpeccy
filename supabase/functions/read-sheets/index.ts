// Reads a paper spec sheet photo from the intake queue with Claude: the
// bowler's name and phone, plus every measurement it can find, saved on the
// sheet as a suggestion that pre-fills the digital sheet for whoever types it
// in. A person checks every value before it reaches the app.
//
// POST {"limit": n} reads up to n (1 to 25, default 10) sheets nobody has read
// yet, oldest first. POST {"ids": [...]} reads those sheets (a sheet is read at
// most MAX_READS times in all). Either may pass "model" (see MODELS).
// GET shows whether the key is set and how many sheets are left.
//
// Secrets: ANTHROPIC_API_KEY, plus the R2 ones photo-files uses. Optional:
// ANTHROPIC_MODEL (default claude-haiku-5-5), R2_BUCKET, R2_ENDPOINT, R2_REGION.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';

const AT_ONCE = 5;
const MAX_READS = 3;
const MODELS = ['claude-haiku-5-5', 'claude-sonnet-5-5'];

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

// The digital sheet's fields the reader fills, with what each holds. Keys match
// src/measurements/schema.ts; values are entered as text the editor checks.
const FIELDS: Record<string, string> = {
  hand: '"right" or "left" (the RIGHT HAND / LEFT HAND or RH / LH mark)',
  play_style: '"one_handed" or "two_handed", only if written',
  thumb_mode: '"no_thumb" if No Thumb is marked, "thumb_in" if a thumb hole is measured, else ""',
  finger_grips: '"grips" if the finger holes have grips/inserts with a grip size, "no_grips" if plain drilled holes',
  grip_type: '"std" or "vaccu", only if written',
  middle_hole: 'middle finger hole size, inches',
  middle_grip_size: 'middle finger grip/insert size, inches (17/32 to 29/32)',
  middle_lateral_pitch: 'middle finger lateral pitch, inches; dir "left" or "right"',
  middle_fr_pitch: 'middle finger forward/reverse pitch, inches; dir "forward" or "reverse"',
  middle_oval: 'middle finger oval, as written',
  middle_inserts: 'middle finger insert style, as written',
  ring_hole: 'ring finger hole size, inches',
  ring_grip_size: 'ring finger grip/insert size, inches (17/32 to 29/32)',
  ring_lateral_pitch: 'ring finger lateral pitch, inches; dir "left" or "right"',
  ring_fr_pitch: 'ring finger forward/reverse pitch, inches; dir "forward" or "reverse"',
  ring_oval: 'ring finger oval, as written',
  ring_inserts: 'ring finger insert style, as written',
  bridge: 'bridge, inches',
  span_type: '"cut_to_cut", "full_span" or "cut_to_outer": which span the sheet marks',
  middle_cut_to_cut: 'middle finger span when cut to cut (or unmarked), inches',
  ring_cut_to_cut: 'ring finger span when cut to cut (or unmarked), inches',
  middle_full_span: 'middle finger span when marked full span, inches',
  ring_full_span: 'ring finger span when marked full span, inches',
  middle_actual_cut: 'middle finger "actual" span when a sheet gives both actual and cut, inches',
  ring_actual_cut: 'ring finger "actual" span when a sheet gives both actual and cut, inches',
  thumb_hole: 'thumb hole size, inches',
  thumb_od: 'thumb slug size (7/8, 1 1/8, 1 1/4 or 1 3/8)',
  thumb_insert_type: '"IT", "JOPO", "Turbo", "Turbo NX" or "Thumb Slug"',
  thumb_oval: 'thumb oval, as written (e.g. width)',
  thumb_oval_angle: 'thumb oval angle, degrees',
  thumb_lateral_pitch: 'thumb lateral pitch, inches; dir "left" or "right"',
  thumb_fr_pitch: 'thumb forward/reverse pitch, inches; dir "forward" or "reverse"',
  pap_horizontal: 'P.A.P. horizontal (over), inches',
  pap_vertical: 'P.A.P. vertical, inches; dir "up" or "down"',
  rev_rate: 'rev rate, rpm',
  axis_rotation: 'axis rotation, degrees',
  axis_tilt: 'axis tilt, degrees',
  speed: 'ball speed, mph',
  written_by: 'who took the measurements, if a name is written',
  finger_insert_details: 'any other finger insert detail written',
  thumb_system_details: 'any other thumb insert/slug detail written (e.g. "Turbo MS Oval", "No slug")',
  fitting_notes: 'everything else written by hand that has no box above: notes, grip (fingertip/conventional), weight, ball, layout, the sheet date',
};

const PROMPT = `This is a photo of a paper bowling ball spec (drill) sheet from a pro shop. Shops used several printed forms (Ultimate, Storm, Vise, Turbo and others), so find each value by its label or position on this form. Read only what is handwritten on the top sheet; ignore printed text, other sheets around it, and anything crossed out.

Return:
- name: the bowler's name from the Name line, keeping "Jr", "Sr" and the like.
- phone: the bowler's phone number, digits with dashes like 570-555-1234. Usually on the Phone or Cell line, but forms without a phone line often have it written elsewhere, such as the E-mail line. If digits are missing, write only what is there.
- fields: one entry per key below, each {"text", "dir"}. text is the value, "" when the sheet doesn't give it. dir is only for pitches ("" otherwise).
- unsure: the keys (and "name"/"phone") whose value was hard to read, ambiguous, or a guess.

Keys:
${Object.entries(FIELDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

How to read the forms:
- Inch values are fractions as written: "31/32", "1 1/32", "4 5/16". Keep the shop's notation (a span of "4 1/4-" or "4 1/4+" is "4 1/4", note the sign in unsure). A bare number in a hole circle like "31" is shorthand for 31/32; write "31/32" and mark it unsure.
- The two upper circles are the finger holes: the LEFT circle on the sheet is the middle finger and the RIGHT circle is the ring finger, whatever the bowling hand. Split circles: the top number is the hole size and the bottom number is the grip/insert size (a trailing "L" or "o" after it is a grip mark, leave it off and mention it in finger_insert_details). A single number is the hole size.
- The lower circle is the thumb: a size there is the thumb hole; insert words (JoPo, IT, Turbo, Slug) go to thumb_insert_type when they match an allowed value and to thumb_system_details otherwise.
- The box between the finger holes is the bridge. Numbers between each finger circle and the thumb are spans; "Total span" or a checked Full Span box means full span, otherwise cut to cut.
- Pitches. Boxes labeled FORWARD PITCH / REVERSE PITCH give forward/reverse; a box with a sideways arrow gives lateral pitch toward the arrow. On crosshairs (+) next to a hole, an amount by the up arrow is reverse pitch, by the down arrow forward pitch, and by a left/right arrow lateral pitch to that side. A circled 0 or an amount of 0 is "0" with dir "". The pitch drawn beside the left finger circle belongs to the middle finger, beside the right one to the ring finger, beside the lower circle to the thumb.
- P.A.P. is usually written as an amount over (horizontal) and an amount up or down with an arrow.
Do not guess values that aren't on the sheet.`;

const FIELD_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    Object.keys(FIELDS).map((k) => [
      k,
      {
        type: 'object',
        properties: { text: { type: 'string' }, dir: { type: 'string' } },
        required: ['text', 'dir'],
        additionalProperties: false,
      },
    ]),
  ),
  required: Object.keys(FIELDS),
  additionalProperties: false,
};

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    phone: { type: 'string' },
    fields: FIELD_SCHEMA,
    unsure: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'phone', 'fields', 'unsure'],
  additionalProperties: false,
};

type Reading = {
  name: string;
  phone: string;
  fields: Record<string, { text: string; dir: string }>;
  unsure: string[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405, { error: 'Use POST' });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
  const defaultModel = Deno.env.get('ANTHROPIC_MODEL')?.trim() || MODELS[0];

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
    return reply(200, { ok: !!apiKey, keySet: !!apiKey, model: defaultModel, unread: left.count, error: left.error?.message });
  }
  if (!apiKey) return reply(503, { error: 'ANTHROPIC_API_KEY is not set yet.' });

  let body: { limit?: unknown; ids?: unknown; model?: unknown } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // No body: read the default number of sheets.
  }
  const limit = body.limit === undefined ? 10 : Number(body.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 25) return reply(400, { error: 'limit must be 1 to 25' });
  const ids = body.ids;
  if (ids !== undefined && (!Array.isArray(ids) || ids.length < 1 || ids.length > 25 || ids.some((i) => typeof i !== 'string'))) {
    return reply(400, { error: 'ids must be 1 to 25 sheet ids' });
  }
  const model = body.model === undefined ? defaultModel : String(body.model);
  if (!MODELS.includes(model) && model !== defaultModel) return reply(400, { error: `model must be one of ${MODELS.join(', ')}` });

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

  let query = db
    .from('intake_items')
    .select('id, object_path, mime_type, read_count')
    .is('removed_at', null)
    .eq('store', 'r2')
    .neq('status', 'done')
    .lt('read_count', MAX_READS);
  query = ids ? query.in('id', ids as string[]) : query.is('read_at', null).order('created_at').order('id').limit(limit);
  const picked = await query;
  if (picked.error) return reply(502, { error: picked.error.message });

  const client = new Anthropic({ apiKey });
  const results: unknown[] = [];

  async function readOne(item: { id: string; object_path: string; mime_type: string; read_count: number }) {
    let saved: Record<string, unknown>;
    let usage: unknown = null;
    try {
      const file = await r2.fetch(base + encodeKey(item.object_path));
      if (!file.ok) throw new Error(`Photo download failed (${file.status})`);
      const data = toBase64(new Uint8Array(await file.arrayBuffer()));
      const media = ['image/png', 'image/webp'].includes(item.mime_type) ? item.mime_type : 'image/jpeg';
      const res = await client.messages.create({
        model,
        max_tokens: 16000,
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
      usage = res.usage;
      if (res.stop_reason === 'refusal') throw new Error('The model declined to read this photo');
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error(`No answer (${res.stop_reason})`);
      const out = JSON.parse(text.text) as Reading;
      const fields = Object.fromEntries(
        Object.keys(FIELDS)
          .map((k) => [k, { text: (out.fields[k]?.text ?? '').trim().slice(0, 4000), dir: (out.fields[k]?.dir ?? '').trim().slice(0, 20) }])
          .filter(([, v]) => (v as { text: string }).text !== ''),
      );
      const unsure = out.unsure.filter((k) => typeof k === 'string').slice(0, 60);
      saved = {
        read_name: out.name.trim().slice(0, 120) || null,
        read_phone: out.phone.trim().slice(0, 40) || null,
        read_unsure: unsure.includes('name') || unsure.includes('phone'),
        read_sheet: { fields, unsure },
        read_error: null,
      };
    } catch (e) {
      saved = { read_error: (e as Error).message.slice(0, 300) };
    }
    const upd = await db
      .from('intake_items')
      .update({ ...saved, read_at: new Date().toISOString(), read_by: model, read_count: item.read_count + 1 })
      .eq('id', item.id)
      .eq('read_count', item.read_count);
    results.push({ id: item.id, ...saved, usage, saveError: upd.error?.message });
  }

  const queue = [...(picked.data ?? [])];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await readOne(item);
    }),
  );

  const left = await unread();
  return reply(200, { read: results.length, model, unread: left.count, results });
});
