// Renders scripts/demo-scene.html into public/media/demo-faucet.mp4 (12 s, 720p)
// plus a poster image. Run: node scripts/render-demo.js  (needs Playwright + ffmpeg)
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

async function render(query, name, scene = 'demo-scene.html') {
  const out = path.join(__dirname, '..', 'public', 'media');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ff-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: tmp, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.goto('file://' + path.join(__dirname, scene) + query);
  await page.waitForTimeout(12600);
  const video = page.video();
  await ctx.close();
  await browser.close();
  const webm = await video.path();
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '0.25', '-i', webm, '-t', '12', '-vf', 'fps=24', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', path.join(out, `${name}.mp4`)]);
  if (!query) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1.5', '-i', path.join(out, `${name}.mp4`), '-frames:v', '1', '-q:v', '3', path.join(out, name === 'demo-faucet' ? 'demo-poster.jpg' : `${name}-poster.jpg`)]);
  console.log(`Wrote public/media/${name}.mp4`);
}

(async () => {
  await render('', 'demo-faucet');
  await render('?fixed=1', 'demo-faucet-fixed');
  await render('', 'demo-chair', 'chair-scene.html');
  await render('?fixed=1', 'demo-chair-fixed', 'chair-scene.html');
})();
