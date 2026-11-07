/**
 * Background removal for the Windows app: the same HTTP API as the rembg container, so the
 * Closet server talks to it exactly as it does in Docker (REMBG_URL), minus Python and the
 * 2.5 GB image. It runs IS-Net ("isnet-general-use") directly with ONNX Runtime and follows
 * rembg's steps, so cutouts look the same as the Docker setup's (masks agree to about 99 %;
 * what's left is libvips and Pillow resizing slightly differently):
 *   - resize to 1024×1024, scale by the brightest value, subtract 0.5
 *   - run the model, stretch its output to 0–255, resize that mask back to the photo's size
 *   - multiply the photo by the mask and use the mask as alpha (rembg's naive_cutout)
 *
 * It's a separate process so the model's memory (over a gigabyte while working) can't take
 * the app down with it. The model is unloaded when idle, because this runs on someone's
 * everyday PC rather than a server.
 */
import http from 'node:http';
import { Readable } from 'node:stream';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';

const PORT = Number(process.env.PORT ?? 7000);
const MODEL = process.env.CUTOUT_MODEL ?? 'isnet-general-use.onnx';
const IDLE_MS = Number(process.env.CUTOUT_IDLE_SECONDS ?? 120) * 1000;
const SIZE = 1024;

let session = null;
let idleTimer = null;
/** One photo at a time, like the Closet server's queue: two at once would double the memory. */
let turn = Promise.resolve();

async function loadModel() {
  clearTimeout(idleTimer);
  session ??= await ort.InferenceSession.create(MODEL, {
    executionProviders: ['cpu'],
    // The arena keeps every peak allocation for the life of the session; off, it stays smaller.
    enableCpuMemArena: false,
  });
  return session;
}

function unloadWhenIdle() {
  idleTimer = setTimeout(() => {
    const old = session;
    session = null;
    turn = turn.then(() => old?.release()).catch((err) => console.error('unloading the model failed', err));
  }, IDLE_MS);
}

/** The photo as the 1×3×1024×1024 tensor IS-Net expects. */
function toTensor(rgb) {
  const pixels = SIZE * SIZE;
  const peak = Math.max(rgb.reduce((a, b) => Math.max(a, b), 0), 1e-6);
  const input = new Float32Array(pixels * 3);
  for (let p = 0; p < pixels; p++) {
    input[p] = rgb[p * 3] / peak - 0.5;
    input[pixels + p] = rgb[p * 3 + 1] / peak - 0.5;
    input[pixels * 2 + p] = rgb[p * 3 + 2] / peak - 0.5;
  }
  return new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]);
}

/** Stretch the model's raw output to a 0–255 mask. */
function toMask(output) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of output) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const scale = 255 / (max - min || 1);
  return Uint8Array.from(output, (v) => (v - min) * scale);
}

/** A transparent PNG of the photo with its background removed. */
async function removeBackground(photo) {
  const { data: rgb, info } = await sharp(photo, { failOn: 'none' })
    .rotate()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const raw = { width, height, channels: 3 };

  const small = await sharp(rgb, { raw }).resize(SIZE, SIZE, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  const model = await loadModel();
  const results = await model.run({ [model.inputNames[0]]: toTensor(small) });
  const mask = await sharp(toMask(results[model.outputNames[0]].data), {
    raw: { width: SIZE, height: SIZE, channels: 1 },
  })
    .resize(width, height, { fit: 'fill', kernel: 'lanczos3' })
    .extractChannel(0) // sharp would otherwise hand back 3-channel sRGB
    .raw()
    .toBuffer();

  const rgba = Buffer.alloc(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    const alpha = mask[p];
    rgba[p * 4] = (rgb[p * 3] * alpha) / 255;
    rgba[p * 4 + 1] = (rgb[p * 3 + 1] * alpha) / 255;
    rgba[p * 4 + 2] = (rgb[p * 3 + 2] * alpha) / 255;
    rgba[p * 4 + 3] = alpha;
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png({ compressionLevel: 3 }).toBuffer();
}

async function handleRemove(req, res) {
  const form = await new Request('http://local/', {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] ?? '' },
    body: Readable.toWeb(req),
    duplex: 'half',
  }).formData();
  const file = form.get('file');
  if (!(file instanceof Blob)) {
    res.writeHead(400).end('No file');
    return;
  }
  const photo = Buffer.from(await file.arrayBuffer());
  const png = await (turn = turn.catch(() => {}).then(() => removeBackground(photo)));
  unloadWhenIdle();
  res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length }).end(png);
}

const server = http.createServer((req, res) => {
  const { pathname } = new URL(req.url, 'http://local');
  if (req.method === 'GET' && pathname === '/api') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"ok":true}');
  } else if (req.method === 'POST' && pathname === '/api/remove') {
    handleRemove(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500);
      res.end(err.message);
    });
  } else {
    res.writeHead(404).end();
  }
});

// Only the Closet server on this PC talks to it.
server.listen(PORT, '127.0.0.1', () => console.log(`cutouts listening on 127.0.0.1:${PORT}`));
