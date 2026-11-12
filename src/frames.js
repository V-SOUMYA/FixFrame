// Turns an uploaded video (or photo) into a handful of timestamped JPEG frames
// for Claude vision, and crops regions for Channel3 image search.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

function run(bin, args) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(bin)} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function duration(file) {
  const out = await run(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  const d = parseFloat(out);
  return Number.isFinite(d) ? d : 0;
}

/**
 * Extract up to `max` evenly spaced frames.
 * @returns {Promise<{duration:number, frames:Array<{t:number, base64:string}>}>}
 */
async function extractFrames(file, mimetype, max = 8) {
  if (mimetype && mimetype.startsWith('image/')) {
    const tmp = path.join(os.tmpdir(), `ff-img-${Date.now()}.jpg`);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=960:-2', '-q:v', '4', tmp]);
    const base64 = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);
    return { duration: 0, frames: [{ t: 0, base64 }] };
  }
  const d = await duration(file);
  if (!d) throw new Error('Could not read that video. Try an MP4 or MOV under 60 seconds.');
  const n = Math.max(3, Math.min(max, Math.round(d / 1.5)));
  const times = Array.from({ length: n }, (_, i) => +(((i + 0.5) * d) / n).toFixed(2));
  const frames = [];
  for (const t of times) {
    const tmp = path.join(os.tmpdir(), `ff-${Date.now()}-${t}.jpg`);
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', tmp]);
    frames.push({ t, base64: fs.readFileSync(tmp).toString('base64') });
    fs.unlinkSync(tmp);
  }
  return { duration: d, frames };
}

/** Crop a normalized box out of a frame of a media file, returned as base64 JPEG. */
async function cropAt(file, t, box) {
  const tmp = path.join(os.tmpdir(), `ff-crop-${Date.now()}.jpg`);
  const pad = 0.04;
  const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad);
  const w = Math.min(1 - x, box.w + pad * 2), h = Math.min(1 - y, box.h + pad * 2);
  const crop = `crop=iw*${w.toFixed(3)}:ih*${h.toFixed(3)}:iw*${x.toFixed(3)}:ih*${y.toFixed(3)},scale=512:-2`;
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(t || 0), '-i', file, '-frames:v', '1', '-vf', crop, '-q:v', '4', tmp]);
  const b64 = fs.readFileSync(tmp).toString('base64');
  fs.unlinkSync(tmp);
  return b64;
}

module.exports = { extractFrames, cropAt };
