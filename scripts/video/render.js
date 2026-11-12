const { chromium } = require('playwright');
const { spawn } = require('child_process'); const fs = require('fs');
(async () => {
  const scene = process.argv[2], out = `/tmp/claude-0/vid/out/${scene}`;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on('pageerror', e => console.error(e.message));
  await p.goto(`file:///home/claude/FixFrame/scripts/video/film.html?scene=${scene}`);
  await p.evaluate(() => document.fonts.ready);
  const dur = await p.evaluate(() => window.SCENE.dur);
  const ff = spawn('ffmpeg', ['-y','-loglevel','error','-f','image2pipe','-framerate','30','-i','-','-c:v','libx264','-crf','18','-preset','veryfast','-pix_fmt','yuv420p','-r','30', out + '.tmp.mp4']);
  const n = Math.round(dur * 30);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.render(t), i / 30);
    const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  ff.on('close', c => { if (c === 0) fs.renameSync(out + '.tmp.mp4', out + '.mp4'); console.log(scene, n, 'frames', c); });
  await b.close();
})();
