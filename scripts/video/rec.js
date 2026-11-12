const { chromium } = require('playwright');
const fs = require('fs');
const OUT = '/tmp/claude-0/vid/rec'; fs.rmSync(OUT, { recursive: true, force: true }); fs.mkdirSync(OUT);
const overlay = () => {
  const add = () => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style');
    st.textContent = `#__cur{position:fixed;left:0;top:0;width:30px;height:30px;z-index:2147483647;pointer-events:none;transition:transform .9s cubic-bezier(.45,0,.2,1);transform:translate(1500px,900px)}
#__cur svg{filter:drop-shadow(0 3px 5px rgba(0,0,0,.35))}
#__cur.dn .ring{opacity:1;transform:scale(1)}
#__cur .ring{position:absolute;left:-18px;top:-18px;width:36px;height:36px;border-radius:50%;background:rgba(201,96,58,.35);opacity:0;transform:scale(.3);transition:all .18s}
#__cap{position:fixed;left:50%;bottom:44px;transform:translateX(-50%) translateY(20px);z-index:2147483646;pointer-events:none;background:rgba(28,40,34,.92);color:#f3efe4;font:500 30px/1.25 'Inter',sans-serif;padding:16px 30px;border-radius:16px;opacity:0;transition:all .4s;white-space:nowrap;box-shadow:0 10px 30px rgba(0,0,0,.25)}
#__cap.on{opacity:1;transform:translateX(-50%) translateY(0)}
#__cap b{color:#e9a07f;font-weight:600}`;
    document.head.appendChild(st);
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = `<div class="ring"></div><svg width="30" height="30" viewBox="0 0 24 24"><path d="M3 2l17 10-7.5 1.6L9 21z" fill="#1d2a24" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.body.appendChild(c);
    const cap = document.createElement('div'); cap.id = '__cap'; document.body.appendChild(cap);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(overlay);
  const p = await ctx.newPage();
  const cdp = await ctx.newCDPSession(p);
  const frames = [];
  cdp.on('Page.screencastFrame', async (f) => {
    const i = frames.length; frames.push(f.metadata.timestamp);
    fs.writeFileSync(`${OUT}/${String(i).padStart(5, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const W = (ms) => p.waitForTimeout(ms);
  let cx = 1500, cy = 900;
  const move = async (x, y, ms = 900) => { cx = x; cy = y; await p.evaluate(([x, y, ms]) => { const c = document.getElementById('__cur'); c.style.transitionDuration = ms + 'ms'; c.style.transform = `translate(${x}px,${y}px)`; }, [x, y, ms]); await W(ms + 80); };
  const setCur = (x, y) => p.evaluate(([x, y]) => { const c = document.getElementById('__cur'); c.style.transitionDuration = '0ms'; c.style.transform = `translate(${x}px,${y}px)`; }, [x, y]);
  const press = async () => { await p.evaluate(() => document.getElementById('__cur').classList.add('dn')); await W(160); await p.evaluate(() => document.getElementById('__cur').classList.remove('dn')); };
  const to = async (sel, ms = 900) => { const el = p.locator(sel).first(); await el.scrollIntoViewIfNeeded(); const bb = await el.boundingBox(); await move(bb.x + bb.width / 2, bb.y + bb.height / 2, ms); return el; };
  const click = async (sel, ms) => { const el = await to(sel, ms); await press(); await el.click(); };
  const cap = (html) => p.evaluate((h) => { const c = document.getElementById('__cap'); if (!h) { c.classList.remove('on'); return; } c.innerHTML = h; c.classList.add('on'); }, html);
  const scrollTo = async (sel, off = 120, ms = 1400) => {
    await p.evaluate(([sel, off, ms]) => new Promise(res => { document.documentElement.style.scrollBehavior = 'auto';
      const y0 = scrollY, el = document.querySelector(sel), y1 = Math.max(0, el.getBoundingClientRect().top + scrollY - off); const t0 = performance.now();
      const f = (n) => { const k = Math.min(1, (n - t0) / ms), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; scrollTo(0, y0 + (y1 - y0) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), [sel, off, ms]);
  };
  const marks = {};
  const mark = (k) => { marks[k] = frames[frames.length - 1]; };

  await p.goto('http://localhost:3124/');
  await p.evaluate(() => document.fonts.ready); await W(600);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await W(300); mark('start');
  await cap('Option C: <b>FixFrame</b>'); await W(2200);
  await click('a.cta', 1100); await p.waitForLoadState('load'); await p.evaluate(() => document.fonts.ready);
  await setCur(cx, cy); await W(800);
  await cap('Frank uploads his 11-second chair video'); await to('#drop', 1000); await press();
  await p.setInputFiles('#file', '/tmp/claude-0/frank-chair.mp4');
  await W(500); await cap('<b>AI</b> watches every frame'); 
  await p.waitForSelector('#resultView:not(.hidden)', { timeout: 60000 }); await W(900);
  await cap('Diagnosis, pinned to the exact moments in his video');
  await move(1500, 700, 800); await W(1500);
  const chips = p.locator('#markerChips > *');
  if (await chips.count() > 1) { await click('#markerChips > *:nth-child(2)'); await W(2600); }
  await cap(null); await W(400);
  await scrollTo('#verdict', 140, 1500); await W(400);
  await cap('Repair: <b>about $9</b>. New chair: $289.'); await W(3600);
  await scrollTo('#stepsList', 160, 1400); await cap('Step-by-step, each step jumps to the proof in his clip'); await W(700);
  await click('#stepsList > *:nth-child(2)'); await W(1500);
  await scrollTo('#stepsList', 160, 700); await W(800);
  await scrollTo('#grid', 220, 1500); await cap('<b>Channel3</b> finds the real parts. Cheapest picked.'); await W(3800);
  await scrollTo('#demoPayParts', 380, 1100); await cap('Checkout with <b>PayPal</b>'); await W(400);
  await click('#demoPayParts'); await W(3200);
  await scrollTo('#proPanel', 100, 1500); await cap('Not handy? Book a pro. <b>Pay only if it\'s fixed.</b>'); await W(1800);
  await click('[data-book]', 1000); await W(1600);
  await click('#holdDemo'); await W(2600);
  await cap('PayPal <b>holds</b> the money. Frank films the result…'); 
  await p.waitForSelector('[data-demo="fixed"]'); await scrollTo('#proAction', 200, 1000); await W(900);
  await click('[data-demo="fixed"]'); await cap('…AI checks it\'s really fixed, then <b>releases</b> the payment'); await W(2600);
  await move(1700, 500, 700);
  await p.evaluate(() => new Promise(res => { const y0 = scrollY, y1 = document.documentElement.scrollHeight - innerHeight; const t0 = performance.now(); const f = (n) => { const k = Math.min(1, (n - t0) / 1400), e = k < .5 ? 2*k*k : 1 - Math.pow(-2*k+2, 2)/2; scrollTo(0, y0 + (y1 - y0) * e); k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }));
  await W(4200);
  mark('end');
  await cdp.send('Page.stopScreencast');
  fs.writeFileSync(`${OUT}/ts.json`, JSON.stringify({ frames, marks }));
  console.log(frames.length, 'frames', (marks.end - marks.start).toFixed(1), 's');
  await b.close();
})();
