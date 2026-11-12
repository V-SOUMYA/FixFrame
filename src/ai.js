// Claude vision: diagnose a broken thing from video frames, and verify a repair
// from an "after" clip. Without ANTHROPIC_API_KEY the app uses the pre-checked
// demo diagnosis and a conservative manual verification.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

async function claude(system, content, maxTokens = 2000) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.content.map((c) => c.text || '').join('').trim();
}

function json(text) {
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < 0) throw new Error('The model did not return JSON');
  return JSON.parse(text.slice(a, b + 1));
}

const frameBlocks = (frames) =>
  frames.flatMap((f) => [
    { type: 'text', text: `Frame at ${f.t.toFixed(1)}s:` },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: f.base64 } },
  ]);

// ---------------- diagnose ----------------
const DIAGNOSE_SYSTEM = `You are FixFrame, a careful home-repair technician. You get timestamped frames from a short video of something broken.
Diagnose it and plan the cheapest safe fix. Reply with JSON only, matching this schema exactly:
{
  "item": string,                       // what the object is
  "category": "plumbing"|"furniture"|"electronics"|"appliance"|"bike"|"clothing"|"other",
  "problem": string,                    // short name of the fault
  "summary": string,                    // 2-3 plain sentences: what you see and why
  "confidence": number,                 // 0-1, be honest
  "difficulty": "easy"|"medium"|"hard",
  "minutes": number,
  "markers": [ { "t": number, "label": string, "detail": string, "box": { "x": number, "y": number, "w": number, "h": number } } ],
  "steps": [ { "t": number, "title": string, "detail": string } ],
  "parts": [ { "key": string, "name": string, "query": string, "qty": number, "why": string, "marker": number, "required": boolean } ],
  "tools": [string],
  "safety": [string],
  "replace": { "item": string, "price": number },   // typical cost to replace instead, USD, incl. install if usual
  "waste_kg": number,                                // approx weight kept out of landfill by repairing
  "pro": { "type": string, "est_low": number, "est_high": number }
}
Rules:
- "t" values must be timestamps of the provided frames where the evidence is visible.
- "box" is normalized 0-1 (x,y = top-left) around the evidence in that frame. Keep boxes tight.
- 2-5 markers, 3-7 steps, 1-4 parts. "query" is a shopping search string for the exact part. "marker" is the index of the marker that shows why the part is needed.
- If it is unsafe for a beginner (gas, mains electrical, structural), set difficulty "hard" and say so in safety.
- If you cannot tell what is wrong, set confidence below 0.4 and explain what to film next in summary.`;

async function diagnose(frames, note) {
  const content = [
    { type: 'text', text: `Here are ${frames.length} frames from the user's video.${note ? ` The user says: "${String(note).slice(0, 300)}"` : ''}` },
    ...frameBlocks(frames),
    { type: 'text', text: 'Return the JSON diagnosis.' },
  ];
  return sanitize(json(await claude(DIAGNOSE_SYSTEM, content, 2500)), frames);
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
function sanitize(d, frames) {
  const ts = frames.map((f) => f.t);
  const near = (t) => ts.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a), ts[0] || 0);
  const box = (b = {}) => ({ x: clamp(b.x, 0, 0.98), y: clamp(b.y, 0, 0.98), w: clamp(b.w, 0.02, 1), h: clamp(b.h, 0.02, 1) });
  const markers = (d.markers || []).slice(0, 5).map((m) => ({ t: near(Number(m.t)), label: String(m.label || '').slice(0, 60), detail: String(m.detail || '').slice(0, 200), box: box(m.box) }));
  return {
    item: String(d.item || 'Unknown item').slice(0, 80),
    category: String(d.category || 'other'),
    problem: String(d.problem || '').slice(0, 80),
    summary: String(d.summary || '').slice(0, 500),
    confidence: clamp(d.confidence, 0, 1),
    difficulty: ['easy', 'medium', 'hard'].includes(d.difficulty) ? d.difficulty : 'medium',
    minutes: clamp(d.minutes, 5, 600),
    markers,
    steps: (d.steps || []).slice(0, 8).map((s) => ({ t: near(Number(s.t)), title: String(s.title || '').slice(0, 60), detail: String(s.detail || '').slice(0, 300) })),
    parts: (d.parts || []).slice(0, 4).map((p, i) => ({
      key: String(p.key || `part-${i}`).replace(/[^a-z0-9-]/gi, '-').toLowerCase(),
      name: String(p.name || '').slice(0, 80),
      query: String(p.query || p.name || '').slice(0, 120),
      qty: clamp(p.qty || 1, 1, 10),
      why: String(p.why || '').slice(0, 120),
      marker: Number.isInteger(p.marker) && p.marker < markers.length ? p.marker : 0,
      required: p.required !== false,
    })),
    tools: (d.tools || []).slice(0, 6).map(String),
    safety: (d.safety || []).slice(0, 4).map(String),
    replace: { item: String((d.replace && d.replace.item) || 'Replacement').slice(0, 80), price: clamp(d.replace && d.replace.price, 0, 20000) },
    waste_kg: clamp(d.waste_kg, 0, 500),
    pro: { type: String((d.pro && d.pro.type) || 'handyman'), est_low: clamp(d.pro && d.pro.est_low, 0, 5000), est_high: clamp(d.pro && d.pro.est_high, 0, 5000) },
  };
}

// ---------------- verify ----------------
const VERIFY_SYSTEM = `You verify home repairs for a payment hold. You get the original diagnosis and frames from an "after" video.
Decide if the specific problem is now fixed. Be strict: if the evidence is unclear, say not verified.
Reply with JSON only: { "fixed": boolean, "confidence": number, "reason": string, "evidence": [ { "t": number, "label": string } ] }`;

async function verify(diagnosis, frames) {
  const content = [
    { type: 'text', text: `Original diagnosis: ${diagnosis.item}: ${diagnosis.problem}. ${diagnosis.summary}\nWhat should now be true: ${diagnosis.markers.map((m) => m.label).join('; ')} are resolved.` },
    ...frameBlocks(frames),
    { type: 'text', text: 'Is it fixed? Return the JSON.' },
  ];
  const v = json(await claude(VERIFY_SYSTEM, content, 600));
  return { fixed: Boolean(v.fixed) && clamp(v.confidence, 0, 1) >= 0.6, confidence: clamp(v.confidence, 0, 1), reason: String(v.reason || '').slice(0, 400), evidence: (v.evidence || []).slice(0, 4) };
}

module.exports = { aiEnabled, diagnose, verify, sanitize, MODEL };
