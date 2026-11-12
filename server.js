require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
 
const ai = require('./src/ai');
const channel3 = require('./src/channel3');
const paypal = require('./src/paypal');
const { extractFrames, cropAt } = require('./src/frames');
const demoDiagnosis = require('./data/demo-diagnosis.json');
const DEMOS = {
  faucet: { diagnosis: demoDiagnosis, file: path.join(__dirname, 'public/media/demo-faucet.mp4') },
  chair: { diagnosis: require('./data/demo-chair-diagnosis.json'), file: path.join(__dirname, 'public/media/demo-chair.mp4') },
};
// Sample clips are recognised by content hash and get their pre-checked diagnosis.
const sha1 = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const SAMPLE_BY_HASH = {};
for (const [key, d] of Object.entries(DEMOS)) { try { SAMPLE_BY_HASH[sha1(d.file)] = key; } catch (e) { /* clip missing */ } }
// Earlier renders of the sample clips that are still floating around (e.g. wobbly-chair.mp4).
SAMPLE_BY_HASH.b3ce891f9b77ad7f1103c15bb592ff8e406e7f68 = 'chair';
// Without an AI key, fall back to matching the sample by file name.
const sampleByName = (name = '') => (/chair|stool|wobbl/i.test(name) ? 'chair' : /faucet|tap|sink|drip|leak/i.test(name) ? 'faucet' : null);
const pros = require('./data/pros.json');
 
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/ag-grid', express.static(path.join(__dirname, 'node_modules/ag-grid-community')));
app.use('/vendor/fonts', express.static(path.join(__dirname, 'node_modules/@fontsource')));
 
const UPLOADS = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const upload = multer({
  dest: UPLOADS,
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(video|image)\//.test(file.mimetype)),
});
 
const DEMO_VIDEO = path.join(__dirname, 'public/media/demo-faucet.mp4');
const jobs = new Map(); // id -> { diagnosis, file, mimetype, offers, pro }
const orders = new Map(); // demo-mode orders
 
const newId = (p) => `${p}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const round2 = (n) => Math.round(n * 100) / 100;
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});
function job(req, res) {
  const j = jobs.get((req.body && req.body.jobId) || req.params.id);
  if (!j) res.status(404).json({ error: 'That diagnosis has expired. Please analyze the video again.' });
  return j;
}
 
// ---------------- config + demo ----------------
app.get('/api/config', (_req, res) => res.json({
  aiEnabled: ai.aiEnabled(),
  model: ai.aiEnabled() ? ai.MODEL : null,
  channel3Enabled: channel3.enabled(),
  paypalEnabled: paypal.enabled(),
  paypalClientId: process.env.PAYPAL_CLIENT_ID || null,
  currency: process.env.CURRENCY || 'USD',
}));
 
app.get('/api/demo', (req, res) => {
  const demo = DEMOS[req.query.item] || DEMOS.faucet;
  const id = newId('JOB');
  jobs.set(id, { diagnosis: demo.diagnosis, file: demo.file, mimetype: 'video/mp4', demo: true });
  res.json({ id, diagnosis: demo.diagnosis, source: 'demo', media: { url: demo.diagnosis.media.url, poster: demo.diagnosis.media.poster, type: 'video' } });
});
 
// ---------------- diagnose an upload ----------------
app.post('/api/diagnose', upload.single('media'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a short video or photo of the broken thing.' });
  const id = newId('JOB');
  const sample = SAMPLE_BY_HASH[sha1(req.file.path)] || (!ai.aiEnabled() && sampleByName(req.file.originalname));
  if (sample) {
    jobs.set(id, { diagnosis: DEMOS[sample].diagnosis, file: req.file.path, mimetype: req.file.mimetype, demo: true });
    return res.json({ id, diagnosis: DEMOS[sample].diagnosis, source: 'sample' });
  }
  if (!ai.aiEnabled()) {
    return res.status(400).json({ error: 'This server has no AI key yet, so it can only diagnose the sample chair and faucet clips. Add ANTHROPIC_API_KEY to .env to diagnose your own videos.' });
  }
  const { frames } = await extractFrames(req.file.path, req.file.mimetype);
  const diagnosis = await ai.diagnose(frames, req.body.note);
  jobs.set(id, { diagnosis, file: req.file.path, mimetype: req.file.mimetype });
  res.json({ id, diagnosis, source: 'claude' });
}));
 
// ---------------- parts (Channel3) ----------------
app.get('/api/jobs/:id/parts', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j) return;
  const parts = await Promise.all(j.diagnosis.parts.map(async (p) => ({ ...p, ...(await channel3.offersFor(p)) })));
  j.offers = Object.fromEntries(parts.map((p) => [p.key, p.offers]));
  res.json({ parts });
}));
 
// Visual search: crop the marked evidence from the video and search Channel3 by image.
app.post('/api/jobs/:id/visual-search', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j) return;
  const part = j.diagnosis.parts.find((p) => p.key === req.body.partKey);
  if (!part) return res.status(404).json({ error: 'Unknown part' });
  const m = j.diagnosis.markers[part.marker] || j.diagnosis.markers[0];
  const crop = await cropAt(j.file, j.mimetype.startsWith('image/') ? 0 : m.t, m.box);
  const result = channel3.enabled() ? await channel3.offersFor(part, crop) : await channel3.offersFor(part);
  j.offers = { ...(j.offers || {}), [part.key]: result.offers };
  res.json({ partKey: part.key, crop: `data:image/jpeg;base64,${crop}`, ...result });
}));
 
// ---------------- PayPal: parts checkout (capture now) ----------------
function pickedItems(j, selections) {
  return selections.map((s) => {
    const offers = (j.offers || {})[s.partKey];
    const part = j.diagnosis.parts.find((p) => p.key === s.partKey);
    const o = offers && offers[s.offer];
    if (!o || !part) throw new Error('Pick an offer for each part first.');
    return { name: `${part.name}`, description: `${o.title} · ${o.merchant}`.slice(0, 127), sku: part.key, price: round2(o.price), qty: part.qty || 1 };
  });
}
 
app.post('/api/orders/parts', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j) return;
  const items = pickedItems(j, req.body.selections || []);
  if (!items.length) return res.status(400).json({ error: 'Nothing selected' });
  const total = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  if (!paypal.enabled()) {
    const id = newId('DEMO');
    orders.set(id, { total, kind: 'parts' });
    return res.json({ id, demo: true, total });
  }
  const order = await paypal.createOrder(items, { intent: 'CAPTURE', description: `FixFrame parts: ${j.diagnosis.problem}` });
  res.json({ id: order.id, demo: false, total });
}));
 
app.post('/api/orders/:id/capture', wrap(async (req, res) => {
  const { id } = req.params;
  if (id.startsWith('DEMO-')) {
    const o = orders.get(id);
    if (!o) return res.status(404).json({ error: 'Unknown demo order' });
    return res.json({ id, status: 'COMPLETED', demo: true, total: o.total, captureId: `CAP-${id.slice(5)}` });
  }
  const data = await paypal.captureOrder(id);
  const cap = data.purchase_units?.[0]?.payments?.captures?.[0];
  res.json({ id: data.id, status: data.status, demo: false, total: cap ? Number(cap.amount.value) : null, captureId: cap ? cap.id : null });
}));
 
// ---------------- pros: pay only if it's fixed ----------------
app.get('/api/jobs/:id/pros', (req, res) => {
  const j = job(req, res);
  if (!j) return;
  const { est_low: lo, est_high: hi, type } = j.diagnosis.pro;
  const list = pros
    .filter((p) => p.skills.includes(j.diagnosis.category) || p.skills.includes('general'))
    .map((p) => ({ ...p, quote: Math.round(lo + (hi - lo) * p.priceFactor), trade: type }))
    .sort((a, b) => a.quote - b.quote);
  j.pros = list;
  res.json({ pros: list });
});
 
app.post('/api/pro/orders', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j) return;
  const pro = (j.pros || []).find((p) => p.id === req.body.proId);
  if (!pro) return res.status(404).json({ error: 'Unknown pro' });
  j.pro = { id: pro.id, name: pro.name, quote: pro.quote, status: 'CREATED' };
  if (!paypal.enabled()) {
    const id = newId('DEMO');
    orders.set(id, { total: pro.quote, kind: 'pro' });
    j.pro.orderId = id;
    return res.json({ id, demo: true, total: pro.quote });
  }
  const order = await paypal.createOrder(
    [{ name: `Repair: ${j.diagnosis.problem}`.slice(0, 127), description: `${pro.name} · paid only after FixFrame verifies the fix`, price: pro.quote, category: 'DIGITAL_GOODS' }],
    { intent: 'AUTHORIZE', description: `FixFrame repair hold: ${j.diagnosis.item}` }
  );
  j.pro.orderId = order.id;
  res.json({ id: order.id, demo: false, total: pro.quote });
}));
 
app.post('/api/pro/orders/:id/authorize', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j || !j.pro) return;
  if (req.params.id.startsWith('DEMO-')) {
    Object.assign(j.pro, { authorizationId: `AUTH-${req.params.id.slice(5)}`, status: 'HELD' });
    return res.json({ status: 'HELD', authorizationId: j.pro.authorizationId, demo: true, pro: j.pro });
  }
  const data = await paypal.authorizeOrder(req.params.id);
  const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  Object.assign(j.pro, { authorizationId: auth.id, status: 'HELD', expires: auth.expiration_time });
  res.json({ status: 'HELD', authorizationId: auth.id, demo: false, pro: j.pro });
}));
 
// Verify the repair from an "after" clip, then capture or keep the hold.
const DEMO_AFTER_FALLBACK = {
  fixed: { fixed: true, confidence: 0.91, reason: 'The spout stays dry with the handle closed, and no water seeps around the handle base. Both faults from the original video are resolved.', evidence: [{ t: 1.8, label: 'Spout dry' }, { t: 5.6, label: 'New O-ring, no seepage' }] },
  leaking: { fixed: false, confidence: 0.88, reason: 'The spout is still dripping at 0:02 and water still tracks down the valve body. The repair is not complete.', evidence: [{ t: 1.8, label: 'Still dripping' }] },
};
 
async function settle(j, verdict) {
  j.pro.verification = verdict;
  if (!verdict.fixed) {
    j.pro.status = 'HELD';
    return { verdict, payment: { status: 'HELD', message: 'Not verified. Your money stays on hold and the pro has been asked to come back.' } };
  }
  if (j.pro.authorizationId.startsWith('AUTH-')) {
    j.pro.status = 'CAPTURED';
    return { verdict, payment: { status: 'CAPTURED', demo: true, captureId: `CAP-${j.pro.authorizationId.slice(5)}`, amount: j.pro.quote } };
  }
  const cap = await paypal.captureAuthorization(j.pro.authorizationId, `Repair verified: ${j.diagnosis.problem}`);
  j.pro.status = 'CAPTURED';
  return { verdict, payment: { status: cap.status, demo: false, captureId: cap.id, amount: Number(cap.amount?.value || j.pro.quote) } };
}
 
app.post('/api/pro/verify', upload.single('media'), wrap(async (req, res) => {
  const j = job(req, res);
  if (!j) return;
  if (!j.pro || !j.pro.authorizationId) return res.status(400).json({ error: 'Book and authorize a pro first.' });
  let verdict;
  const afters = j.diagnosis.after || DEMO_AFTER_FALLBACK;
  if (req.body.demo === 'fixed' || req.body.demo === 'leaking') {
    const a = afters[req.body.demo];
    verdict = { fixed: a.fixed, confidence: a.confidence, reason: a.reason, evidence: a.evidence };
  }
  else if (req.file && ai.aiEnabled()) verdict = await ai.verify(j.diagnosis, (await extractFrames(req.file.path, req.file.mimetype, 6)).frames);
  else return res.status(400).json({ error: 'Live verification needs ANTHROPIC_API_KEY. Use one of the demo after-clips instead.' });
  res.json(await settle(j, verdict));
}));
 
app.post('/api/pro/void', wrap(async (req, res) => {
  const j = job(req, res);
  if (!j || !j.pro || !j.pro.authorizationId) return;
  if (!j.pro.authorizationId.startsWith('AUTH-')) await paypal.voidAuthorization(j.pro.authorizationId);
  j.pro.status = 'VOIDED';
  res.json({ status: 'VOIDED', message: 'Hold released. You were not charged.' });
}));
 
const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`FixFrame running on http://localhost:${PORT}`);
    console.log(`  Vision AI: ${ai.aiEnabled() ? `Claude (${ai.MODEL})` : 'demo diagnosis (set ANTHROPIC_API_KEY)'}`);
    console.log(`  Parts: ${channel3.enabled() ? 'Channel3 live search' : 'sample offers (set CHANNEL3_API_KEY)'}`);
    console.log(`  PayPal: ${paypal.enabled() ? 'sandbox' : 'demo checkout (set PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)'}`);
  });
}
module.exports = app;
 