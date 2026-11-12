const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sanitize } = require('../src/ai');
const { normalize } = require('../src/channel3');
const demo = require('../data/demo-diagnosis.json');

test('Channel3 products flatten into one row per priced offer', () => {
  const rows = normalize([
    { id: 'p1', title: 'O-ring kit', images: [{ url: 'a.jpg', cleaned_url: 'b.jpg' }], brands: [{ name: 'Acme' }],
      offers: [{ domain: 'shop.example', url: 'https://shop.example/1', price: { price: 5.5, currency: 'USD' }, availability: 'InStock' }, { domain: 'x.example', price: {} }] },
  ]);
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual([rows[0].title, rows[0].merchant, rows[0].price, rows[0].image, rows[0].brand], ['O-ring kit', 'shop.example', 5.5, 'b.jpg', 'Acme']);
});

test('model output is clamped and snapped to real frame times', () => {
  const frames = [{ t: 1 }, { t: 4 }, { t: 9 }];
  const d = sanitize({ item: 'Chair', difficulty: 'impossible', confidence: 3, markers: [{ t: 4.4, label: 'Loose joint', box: { x: -1, y: 2, w: 0, h: 5 } }], parts: [{ name: 'Glue', marker: 7 }] }, frames);
  assert.strictEqual(d.difficulty, 'medium');
  assert.strictEqual(d.confidence, 1);
  assert.strictEqual(d.markers[0].t, 4);
  assert.ok(d.markers[0].box.x >= 0 && d.markers[0].box.y <= 0.98 && d.markers[0].box.w >= 0.02 && d.markers[0].box.h <= 1);
  assert.strictEqual(d.parts[0].marker, 0);
});

test('demo diagnosis is internally consistent', () => {
  assert.ok(demo.parts.every((p) => p.marker < demo.markers.length));
  assert.ok(demo.markers.every((m) => m.t >= 0 && m.t <= 12));
  const pub = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'demo-markers.json'), 'utf8'));
  assert.deepStrictEqual(pub, demo.markers, 'public/data/demo-markers.json is out of sync with data/demo-diagnosis.json');
});

test('pay-only-if-fixed: hold, failed check keeps hold, verified check captures', async () => {
  const app = require('../server');
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const j = (r) => r.json();
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j);
  const form = (p, obj) => { const f = new FormData(); Object.entries(obj).forEach(([k, v]) => f.append(k, v)); return fetch(base + p, { method: 'POST', body: f }).then(j); };
  try {
    const { id } = await fetch(base + '/api/demo').then(j);
    const { parts } = await fetch(`${base}/api/jobs/${id}/parts`).then(j);
    assert.ok(parts.length >= 2 && parts.every((p) => p.offers.length));
    const order = await post('/api/orders/parts', { jobId: id, selections: parts.map((p) => ({ partKey: p.key, offer: 0 })) });
    const expected = parts.reduce((s, p) => s + p.offers[0].price * p.qty, 0);
    assert.strictEqual(order.total, Math.round(expected * 100) / 100);
    const { pros } = await fetch(`${base}/api/jobs/${id}/pros`).then(j);
    const hold = await post('/api/pro/orders', { jobId: id, proId: pros[0].id });
    const auth = await post(`/api/pro/orders/${hold.id}/authorize`, { jobId: id });
    assert.strictEqual(auth.status, 'HELD');
    const bad = await form('/api/pro/verify', { jobId: id, demo: 'leaking' });
    assert.strictEqual(bad.payment.status, 'HELD');
    const good = await form('/api/pro/verify', { jobId: id, demo: 'fixed' });
    assert.strictEqual(good.payment.status, 'CAPTURED');
    assert.strictEqual(good.payment.amount, pros[0].quote);
  } finally {
    server.close();
  }
});
