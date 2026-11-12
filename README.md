# FixFrame

**Don't replace it. Film it.**

Point your phone at anything broken. FixFrame watches the video frame by frame, marks exactly what's wrong (with timestamps), finds the real parts from real stores, and walks you through the repair with steps pinned to your own clip. You pay for the parts with PayPal.

Rather not do it yourself? Book a pro and **pay only if it's fixed**. PayPal *authorizes* the payment when you book but doesn't charge it. After the repair you film it again; if the AI sees the fault is gone, the payment is *captured*. If it isn't fixed, you're not charged.

Built for *Build What's Next with PayPal and AI*.

---

## The problem

Most broken things need a $10 part, not a $200 replacement. People replace instead of repair because:

1. **They don't know what's wrong.** "The faucet drips" could be a washer, an O-ring, a cartridge or the valve seat.
2. **They don't know which part to buy.** Hardware aisles and online listings are a maze.
3. **Hiring someone is a gamble.** You pay up front and hope the job is actually done.

FixFrame solves all three: video diagnosis, exact parts, and payment that depends on the result.

Example from the demo clip: a dripping two-handle faucet.

- **Repair:** about $12 in parts, 25 minutes.
- **Replace:** about $189 for a new faucet plus install.
- **Water:** a faucet dripping once a second wastes about 3,000 gallons a year (EPA WaterSense estimate).
- **Waste:** about 1.6 kg of hardware stays out of landfill.

---

## Demo flow (under 3 minutes)

1. **Home** → *Watch the demo*. The AI's markers appear on the clip in real time: "Spout drips while closed" at 0:01, "Cracked O-ring at handle base" at 0:05.
2. **Verdict.** Repair $12 vs replace $189, so you save $177, plus water and waste saved.
3. **Steps.** Click "Replace the O-ring" and the video jumps to 0:06, where the cracked ring is visible.
4. **Parts.** Every fault becomes a real part from Channel3. Click *Find by photo* to search by the crop of the worn part straight from your video.
5. **Pay for parts** with PayPal, then see the savings summary.
6. **Or hire a pro.** Book Rivera Plumbing and PayPal holds $131. Upload the after-clip: "Still leaking" keeps the hold, "Repaired faucet" captures the payment.

---

## How we used each tool

### PayPal (Orders v2 + Payments v2)
- **Parts:** an Orders v2 order with `intent: CAPTURE`, with one line item per part. Prices are re-derived on the server from the offers it fetched, so the browser can't change them.
- **Pay only if fixed:** an Orders v2 order with `intent: AUTHORIZE`. Approval leads to `POST /v2/checkout/orders/{id}/authorize`, which creates the hold. Then:
  - **Verified fixed:** `POST /v2/payments/authorizations/{id}/capture`.
  - **Cancelled:** `POST /v2/payments/authorizations/{id}/void`.
- The PayPal JS SDK is loaded twice under separate namespaces (`intent=capture` and `intent=authorize`) so both flows share one page.

### AI: Claude vision (Anthropic Messages API)
- **Diagnosis:** ffmpeg pulls 3–8 timestamped frames from the upload. Claude returns a structured diagnosis: fault, confidence, difficulty, **markers with normalized bounding boxes at specific timestamps**, steps tied to timestamps, a parts list with search queries, a replace-cost estimate and waste weight. The server checks and clamps every field, and snaps timestamps to real frames.
- **Verification:** frames from the "after" clip are compared against the original diagnosis. Payment is captured only if Claude is confident (≥ 0.6) that the fault is resolved.

### Channel3 (product search)
- Each part's `query` is searched with `POST /v1/search`, and products are flattened into one row per offer (title, merchant domain, price, availability, image, link).
- **Find by photo:** the server crops the marked region of the video frame with ffmpeg and sends it as `base64_image`, searching by what the broken part actually looks like.

### AG Grid
- **Parts comparison grid:** one row per offer, grouped by part and sorted by price.
- **Cell renderers:** radio selection per part, product thumbnails, stock pills, store links.
- **Picks:** chosen rows are highlighted. Optional parts can be deselected, and the cart and verdict update live.

### Render
- `render.yaml` blueprint with a Docker runtime, so ffmpeg is installed for video processing. Add the four secret keys in the Render dashboard.

---

## Run it locally

Requirements: Node.js 18+ and ffmpeg (`brew install ffmpeg` / `apt install ffmpeg`).

```bash
git clone https://github.com/<you>/FixFrame.git
cd FixFrame
npm install
cp .env.example .env   # add keys (all optional)
npm start
```

Open http://localhost:3000.

| Key | Without it |
|---|---|
| `ANTHROPIC_API_KEY` | The demo clip uses its pre-checked diagnosis; uploads also fall back to it, with a notice |
| `CHANNEL3_API_KEY` | Parts show clearly labeled sample offers |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` | Checkout and the payment hold are simulated with the same flow |

The badges in the header show which mode is active. To pay in sandbox, log in with a sandbox personal account from the PayPal Developer Dashboard.

```bash
npm test             # diagnosis sanitizing, Channel3 parsing, full hold → verify → capture flow
npm run render:demo  # re-render the demo clips (needs Playwright)
```

---

## Project structure

```
server.js                 API: diagnose, parts, visual search, orders, pro hold / verify / capture / void
src/frames.js             ffmpeg: timestamped frames + region crops
src/ai.js                 Claude vision: diagnose + verify, with strict output sanitizing
src/channel3.js           Channel3 search + offer normalization (sample fallback)
src/paypal.js             Orders v2 (capture / authorize) + Payments v2 (capture / void)
data/demo-diagnosis.json  Pre-checked diagnosis for the demo clip
data/pros.json            Simulated local pros
public/                   index.html (home), fix.html (app), done.html (summary)
scripts/                  Demo clip scene + renderer
```

## Honest notes

- **Demo clip:** it's an illustrated animation, so the demo is reliable. Upload a real video to see live diagnosis.
- **Pros:** the local pros and their quotes are simulated. In production they'd be onboarded merchants paid through PayPal.
- **Payments:** all payments run in the PayPal sandbox.
- **Safety:** FixFrame flags unsafe jobs (gas, mains electrical, structural) as "hard" and recommends a pro.

## License

MIT, see [LICENSE](LICENSE).
# FixFrame
