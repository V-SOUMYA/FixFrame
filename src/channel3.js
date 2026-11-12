// Channel3 product search: real products and offers for each part.
// Docs: https://channel3.ai/docs/api-reference/v1/search
// Without CHANNEL3_API_KEY, clearly-labeled sample offers are used instead.
const fallback = require('../data/fallback-parts.json');

const URL = 'https://api.trychannel3.com/v1/search';
const enabled = () => Boolean(process.env.CHANNEL3_API_KEY);

async function search({ query, base64Image, limit = 6, maxPrice }) {
  const body = { limit };
  if (query) body.query = query;
  if (base64Image) body.base64_image = base64Image;
  if (maxPrice) body.filters = { price: { max_price: maxPrice } };
  body.config = { country: 'US', currency: 'USD' };
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.CHANNEL3_API_KEY },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return normalize(data.products || []);
}

// Flatten products into one row per offer (product x merchant).
function normalize(products) {
  const rows = [];
  for (const p of products) {
    const img = p.images && p.images[0] ? p.images[0].cleaned_url || p.images[0].url : null;
    for (const o of p.offers || []) {
      if (!o.price || typeof o.price.price !== 'number') continue;
      rows.push({
        productId: p.id || null,
        title: p.title,
        brand: p.brands && p.brands[0] ? p.brands[0].name : null,
        merchant: o.domain,
        url: o.url,
        price: o.price.price,
        compareAt: o.price.compare_at_price || null,
        currency: o.price.currency || 'USD',
        availability: o.availability || 'Unknown',
        condition: o.condition || 'New',
        image: img,
      });
    }
  }
  return rows;
}

/** Offers for one diagnosed part. Returns { source, offers }. */
async function offersFor(part, base64Image) {
  if (enabled()) {
    try {
      const offers = await search({ query: base64Image ? undefined : part.query, base64Image, limit: 6 });
      if (offers.length) return { source: 'channel3', offers: offers.slice(0, 8) };
    } catch (err) {
      console.warn('[channel3] search failed, using samples:', err.message);
    }
  }
  const sample = fallback[part.key] || fallback.generic;
  return { source: 'sample', offers: sample.map((o) => ({ ...o, url: null, brand: null, condition: 'New', compareAt: null, currency: 'USD' })) };
}

module.exports = { enabled, offersFor, search, normalize };
