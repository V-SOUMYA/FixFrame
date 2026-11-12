// PayPal Orders v2 + Payments v2 (sandbox by default).
// - Parts: intent CAPTURE (pay now).
// - Pro repair: intent AUTHORIZE. The money is held, then captured only when the
//   AI verifies the repair from an "after" video, or voided if it isn't fixed.
// Docs: https://developer.paypal.com/docs/api/orders/v2/ and /docs/api/payments/v2/

const BASE = process.env.PAYPAL_API_BASE || 'https://api-m.sandbox.paypal.com';
const enabled = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

let token = null;
async function accessToken() {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const auth = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`PayPal auth failed (${res.status})`);
  const d = await res.json();
  token = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return token.value;
}

async function call(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`PayPal ${path} failed (${res.status}): ${JSON.stringify(data).slice(0, 400)}`);
  return data;
}

/**
 * @param {Array<{name:string, description?:string, sku?:string, price:number, qty?:number, category?:string}>} items
 * @param {{intent?:'CAPTURE'|'AUTHORIZE', description?:string, reference?:string}} opts
 */
function createOrder(items, opts = {}) {
  const currency = process.env.CURRENCY || 'USD';
  const cents = items.reduce((s, i) => s + Math.round(i.price * 100) * (i.qty || 1), 0);
  const total = (cents / 100).toFixed(2);
  return call('/v2/checkout/orders', {
    intent: opts.intent || 'CAPTURE',
    purchase_units: [{
      reference_id: opts.reference || `fixframe-${Date.now()}`,
      description: (opts.description || 'FixFrame repair').slice(0, 127),
      amount: { currency_code: currency, value: total, breakdown: { item_total: { currency_code: currency, value: total } } },
      items: items.map((i) => ({
        name: i.name.slice(0, 127),
        description: (i.description || '').slice(0, 127),
        sku: (i.sku || '').slice(0, 127),
        quantity: String(i.qty || 1),
        category: i.category || 'PHYSICAL_GOODS',
        unit_amount: { currency_code: currency, value: i.price.toFixed(2) },
      })),
    }],
    payment_source: { paypal: { experience_context: { brand_name: 'FixFrame', user_action: opts.intent === 'AUTHORIZE' ? 'CONTINUE' : 'PAY_NOW', shipping_preference: opts.intent === 'AUTHORIZE' ? 'NO_SHIPPING' : 'GET_FROM_FILE' } } },
  });
}

const captureOrder = (id) => call(`/v2/checkout/orders/${encodeURIComponent(id)}/capture`);
const authorizeOrder = (id) => call(`/v2/checkout/orders/${encodeURIComponent(id)}/authorize`);
const captureAuthorization = (authId, note) => call(`/v2/payments/authorizations/${encodeURIComponent(authId)}/capture`, { final_capture: true, note_to_payer: (note || 'Repair verified by FixFrame').slice(0, 255) });
const voidAuthorization = (authId) => call(`/v2/payments/authorizations/${encodeURIComponent(authId)}/void`);

module.exports = { enabled, createOrder, captureOrder, authorizeOrder, captureAuthorization, voidAuthorization };
