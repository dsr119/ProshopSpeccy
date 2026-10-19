// Reads the whole paper spec sheet (pitches, hole and grip sizes, spans, thumb,
// notes) off sheet photos in the intake queue with Claude, following the way
// the shop reads its sheets (Doug's walkthrough, with his example sheet shown
// to the model each time). Saves the reading on the sheet's read_sheet for a
// person to review; it never changes the sheet's place in the queue.
//
// POST {"ids": [...]} reads those sheets (1 to 25). POST {"limit": n} reads up
// to n sheets that have no reading yet, oldest first. Either may pass "model".
// GET shows whether the key is set.
//
// Secrets: ANTHROPIC_API_KEY, plus the R2 ones photo-files uses. Optional:
// ANTHROPIC_MODEL (default claude-sonnet-5-5), R2_BUCKET, R2_ENDPOINT, R2_REGION.

import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import Anthropic from 'npm:@anthropic-ai/sdk@0.131.0';

const AT_ONCE = 5;
const MODELS = ['claude-sonnet-5-5', 'claude-opus-5-5'];
/** Saved with each reading so the review page knows which instructions made it. */
const VERSION = 2;

// Doug's walkthrough sheet (Frank Alu), shown to the model as a worked example.
const EXAMPLE_ID = 'b9b0e013-e7ec-4dc6-aa26-35f996c79f05';

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

// The digital sheet's fields, keyed as in src/measurements/schema.ts.
const FIELDS: Record<string, string> = {
  hand: '"right" or "left" (the RIGHT HAND / LEFT HAND mark, or RH / LH)',
  thumb_mode: '"fingertip", "conventional" or "no_thumb" (the GRIP line: Finger Tip / Conventional / No Thumb)',
  finger_grips: '"grips" when the finger holes have grips (a grip size or Lift/insert written), "no_grips" for plain drilled holes',
  grip_type: '"std" or "vaccu", only if written',
  middle_grip_brand: '"Turbo", "Vise" or "Other", only if a brand is written for the middle finger grip',
  ring_grip_brand: '"Turbo", "Vise" or "Other", only if a brand is written for the ring finger grip',
  middle_hole: 'middle finger hole size',
  middle_grip_size: 'middle finger grip size',
  middle_inserts: 'middle finger insert: "Lifts", "Oval Mesh" or "Oval No Mesh"',
  middle_lateral_pitch: 'middle finger lateral pitch; dir "left" or "right"',
  middle_fr_pitch: 'middle finger forward/reverse pitch; dir "forward" or "reverse"',
  middle_oval: 'middle finger oval, as written',
  ring_hole: 'ring finger hole size',
  ring_grip_size: 'ring finger grip size',
  ring_inserts: 'ring finger insert: "Lifts", "Oval Mesh" or "Oval No Mesh"',
  ring_lateral_pitch: 'ring finger lateral pitch; dir "left" or "right"',
  ring_fr_pitch: 'ring finger forward/reverse pitch; dir "forward" or "reverse"',
  ring_oval: 'ring finger oval, as written',
  bridge: 'bridge (the small box between the finger holes)',
  span_type: '"cut_to_cut", "full_span" or "cut_to_outer"',
  middle_span: 'the span under the LEFT finger circle (whichever span type)',
  ring_span: 'the span under the RIGHT finger circle (whichever span type)',
  thumb_hole: 'thumb hole size',
  thumb_insert_type: '"IT", "JOPO", "Turbo", "Turbo NX" or "Thumb Slug"',
  thumb_od: 'thumb slug size: 7/8, 1 1/8, 1 1/4 or 1 3/8',
  thumb_oval: 'thumb oval, as written',
  thumb_lateral_pitch: 'thumb lateral pitch; dir "left" or "right"',
  thumb_fr_pitch: 'thumb forward/reverse pitch; dir "forward" or "reverse"',
  pap_horizontal: 'P.A.P. amount over',
  pap_vertical: 'P.A.P. amount up or down; dir "up" or "down"',
  written_by: 'who took the measurements, if a name is written',
  thumb_system_details: 'thumb insert or slug details that fit no box above',
  fitting_notes: 'everything written in NOTES and in the OVAL INFO box, word for word; the weight (WGT) as "Weight: 15"',
};

const SYSTEM = `You read paper bowling ball spec (drill) sheets from a pro shop and turn them into the shop's digital spec sheet. Shops used several printed forms (Ultimate, Storm, Vise, Turbo and others); find each value by its label or position on the form in front of you. Read only what is handwritten on the top sheet. Ignore printed text, other sheets visible around it, and anything crossed out. Never guess a value that isn't on the sheet: leave it out.

Return:
- name: the bowler's name. phone: their phone number as digits with dashes (570-555-1234), or "" when there is none. A phone can be written elsewhere, such as the E-mail line.
- fields: one entry for each key below that the sheet gives a value for. "written" is exactly what is on the paper (like "3/8+" or "27 Lift"); "text" is the value for the digital sheet after the rules below; "dir" is the pitch direction ("" for anything that isn't a pitch).
- needs_review: true when any value could not be read or the sheet is incomplete.
- review_reasons: a short plain sentence for each problem, like "Right finger forward/reverse pitch can't be read".
- unsure: the keys (or "name"/"phone") whose value was hard to read or is a guess.

Keys:
${Object.entries(FIELDS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

How the shop reads a sheet, in order:
1. Name and phone at the top. No phone written: phone is "". Note the bowling hand (the marked LEFT HAND / RIGHT HAND circle).
2. The two upper circles are the finger holes. The LEFT circle on the paper is the middle finger and the RIGHT circle is the ring finger, whatever the bowling hand. Each circle holds a hole size and a grip size, usually hole on top and grip below, but people sometimes swap them. If one of the two numbers is 1 1/32, 31/32 or 7/8, that is almost always the hole size and the other number is the grip size.
3. Grip sizes are often written as just the numerator: "27" means 27/32, "29" means 29/32. Write them as the fraction ("27/32"). The word "Lift" (or "Lifts", "L") next to a grip size means the insert is Lifts: middle_inserts / ring_inserts "Lifts", and finger_grips "grips".
4. A circle with only one size: put that size where it belongs (a hole size if it is 1 1/32, 31/32 or 7/8, otherwise the grip size), and set needs_review with the reason that the circle is incomplete.
5. Pitches are drawn as a small cross (+) beside each circle with arrows and amounts. The cross beside the left finger circle is the middle finger, beside the right finger circle the ring finger, beside the lower circle the thumb. An amount by a sideways arrow is lateral pitch toward that arrow ("left" or "right"). An amount by the DOWN arrow is REVERSE pitch; by the UP arrow, FORWARD pitch. A plain "0" on an axis is 0 with dir "". Boxes labeled FORWARD PITCH / REVERSE PITCH on other forms say so directly. If an amount can't be made out, leave that key out and set needs_review.
6. The lower circle is the thumb: the hole size, and the thumb option (slug or insert). "No Slug" means no thumb option: leave thumb_insert_type out. A slug size goes in thumb_od.
7. Spans are the numbers on the lines between each finger circle and the thumb. The word near them sets span_type: "Cut" means cut_to_cut; "Full" or "Total" means full_span; "cut to outer", "cut to switch", "cut to Turbo" or "cut to JoPo" means cut_to_outer. No word: cut_to_cut.
8. The GRIP line at the bottom (Finger Tip / Conventional / No Thumb) sets thumb_mode. Check WGT and P.A.P.; leave them out when blank.
9. Copy anything written in NOTES and in the OVAL INFO box word for word into fitting_notes.

Plus and minus signs (they mean 1/32 more or less, on every kind of value):
- A value whose denominator is 32 (like "1 3/32+") keeps the number and drops the sign: "1 3/32".
- Any other value moves 1/32 in the sign's direction: "4 7/8+" is "4 29/32", "4 13/16+" is "4 27/32", "4 1/4-" is "4 7/32", a pitch of "3/8+" is "13/32", a bridge of "1/4+" is "9/32".`;

const EXAMPLE_ANSWER = {
  name: 'Frank Alu',
  phone: '',
  fields: [
    { key: 'hand', written: 'LEFT HAND marked', text: 'left', dir: '' },
    { key: 'thumb_mode', written: 'Finger Tip marked', text: 'fingertip', dir: '' },
    { key: 'finger_grips', written: 'grip sizes with Lift', text: 'grips', dir: '' },
    { key: 'middle_hole', written: '1 1/32', text: '1 1/32', dir: '' },
    { key: 'middle_grip_size', written: '27 Lift', text: '27/32', dir: '' },
    { key: 'middle_inserts', written: 'Lift', text: 'Lifts', dir: '' },
    { key: 'middle_lateral_pitch', written: '0', text: '0', dir: '' },
    { key: 'middle_fr_pitch', written: '1/16 by the down arrow', text: '1/16', dir: 'reverse' },
    { key: 'ring_hole', written: '1 1/32', text: '1 1/32', dir: '' },
    { key: 'ring_grip_size', written: '29 Lift', text: '29/32', dir: '' },
    { key: 'ring_inserts', written: 'Lift', text: 'Lifts', dir: '' },
    { key: 'ring_lateral_pitch', written: '5/8 by the right arrow', text: '5/8', dir: 'right' },
    { key: 'bridge', written: '1/4+', text: '9/32', dir: '' },
    { key: 'span_type', written: 'Cut', text: 'cut_to_cut', dir: '' },
    { key: 'middle_span', written: '4 7/8+', text: '4 29/32', dir: '' },
    { key: 'ring_span', written: '4 13/16+', text: '4 27/32', dir: '' },
    { key: 'thumb_hole', written: '1 3/32+', text: '1 3/32', dir: '' },
    { key: 'thumb_lateral_pitch', written: '1/16 by the left arrow', text: '1/16', dir: 'left' },
    { key: 'thumb_fr_pitch', written: '3/8+ by the down arrow', text: '13/32', dir: 'reverse' },
  ],
  needs_review: true,
  review_reasons: ["Ring finger forward/reverse pitch by the down arrow is written over and can't be read"],
  unsure: ['ring_fr_pitch'],
};

const EXAMPLE_NOTE = `Above is an example sheet read the shop's way. "No Slug" is in the thumb circle, so there is no thumb option. Nothing is written in NOTES, OVAL INFO, WGT or P.A.P., so they are left out. The reading:
${JSON.stringify(EXAMPLE_ANSWER, null, 1)}`;

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    phone: { type: 'string' },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', enum: Object.keys(FIELDS) },
          written: { type: 'string' },
          text: { type: 'string' },
          dir: { type: 'string' },
        },
        required: ['key', 'written', 'text', 'dir'],
        additionalProperties: false,
      },
    },
    needs_review: { type: 'boolean' },
    review_reasons: { type: 'array', items: { type: 'string' } },
    unsure: { type: 'array', items: { type: 'string' } },
  },
  required: ['name', 'phone', 'fields', 'needs_review', 'review_reasons', 'unsure'],
  additionalProperties: false,
};

type Reading = {
  name: string;
  phone: string;
  fields: Array<{ key: string; written: string; text: string; dir: string }>;
  needs_review: boolean;
  review_reasons: string[];
  unsure: string[];
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') return reply(405, { error: 'Use POST' });

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')?.trim();
  const defaultModel = Deno.env.get('ANTHROPIC_MODEL')?.trim() || MODELS[0];
  if (req.method === 'GET') return reply(200, { ok: !!apiKey, keySet: !!apiKey, model: defaultModel, version: VERSION });
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

  async function photo(item: { object_path: string; mime_type: string }) {
    const file = await r2.fetch(base + encodeKey(item.object_path));
    if (!file.ok) throw new Error(`Photo download failed (${file.status})`);
    const media = ['image/png', 'image/webp'].includes(item.mime_type) ? item.mime_type : 'image/jpeg';
    return { type: 'base64' as const, media_type: media as 'image/jpeg', data: toBase64(new Uint8Array(await file.arrayBuffer())) };
  }

  const example = await db.from('intake_items').select('object_path, mime_type').eq('id', EXAMPLE_ID).single();
  if (example.error) return reply(502, { error: `Example sheet: ${example.error.message}` });
  let exampleImage: Awaited<ReturnType<typeof photo>>;
  try {
    exampleImage = await photo(example.data);
  } catch (e) {
    return reply(502, { error: `Example sheet: ${(e as Error).message}` });
  }

  let query = db
    .from('intake_items')
    .select('id, object_path, mime_type')
    .is('removed_at', null)
    .eq('store', 'r2')
    .neq('id', EXAMPLE_ID);
  query = ids ? query.in('id', ids as string[]) : query.neq('status', 'done').is('read_sheet', null).order('created_at').order('id').limit(limit);
  const picked = await query;
  if (picked.error) return reply(502, { error: picked.error.message });

  const client = new Anthropic({ apiKey });
  const results: unknown[] = [];

  async function readOne(item: { id: string; object_path: string; mime_type: string }) {
    let sheet: Record<string, unknown>;
    let usage: unknown = null;
    try {
      const image = await photo(item);
      const res = await client.messages.create({
        model,
        max_tokens: 8000,
        system: SYSTEM,
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: exampleImage },
              // The instructions and example are the same for every sheet, so they are cached.
              { type: 'text', text: EXAMPLE_NOTE, cache_control: { type: 'ephemeral' } },
              { type: 'image', source: image },
              { type: 'text', text: 'Now read this sheet the same way.' },
            ],
          },
        ],
      } as Anthropic.MessageCreateParamsNonStreaming);
      usage = res.usage;
      if (res.stop_reason === 'refusal') throw new Error('The model declined to read this photo');
      const text = res.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') throw new Error(`No answer (${res.stop_reason})`);
      const out = JSON.parse(text.text) as Reading;
      sheet = { v: VERSION, model, at: new Date().toISOString(), ...out, usage };
    } catch (e) {
      sheet = { v: VERSION, model, at: new Date().toISOString(), error: (e as Error).message.slice(0, 300), usage };
    }
    const upd = await db.from('intake_items').update({ read_sheet: sheet }).eq('id', item.id);
    results.push({ id: item.id, ...sheet, saveError: upd.error?.message });
  }

  const queue = [...(picked.data ?? [])];
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) await readOne(item);
    }),
  );
  return reply(200, { read: results.length, model, results });
});
