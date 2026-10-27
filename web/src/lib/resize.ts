/**
 * Shrink a photo to at most `max` px on the long edge and re-encode it as WebP
 * (JPEG where the browser can't encode WebP, e.g. Safari). Decoding in the browser
 * is also what turns iPhone HEIC into something the server can read.
 */
/**
 * Clothing photos go up large: the piece often fills only part of the frame, and the cutout
 * is cropped from it, so the extra pixels are what keep it sharp on the tablet.
 */
export const ITEM_PHOTO_MAX = 2400;

export async function resizeImage(file: Blob, max = 1200): Promise<Blob> {
  const source = await decode(file);
  const { width, height } = source;
  const scale = Math.min(1, max / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ('close' in source) source.close();

  const webp = await toBlob(canvas, 'image/webp', 0.88);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.9);
  if (!jpeg) throw new Error("Couldn't process this photo");
  return jpeg;
}

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => c.toBlob(resolve, type, quality));

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Older Safari can't createImageBitmap some formats but can still show them in <img>.
    const url = URL.createObjectURL(file);
    try {
      const el = new Image();
      el.src = url;
      await el.decode();
      return el;
    } catch {
      throw new Error("This photo format isn't supported here");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** POST a blob as multipart form data, reporting upload progress (0–1). */
export function upload<T>(
  url: string,
  blob: Blob,
  onProgress?: (fraction: number) => void,
  fields: Record<string, string> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
    form.append('photo', blob, `photo.${ext}`);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () =>
      xhr.status < 300
        ? resolve(xhr.response as T)
        : reject(new Error(xhr.response?.error ?? `Upload failed (${xhr.status})`));
    xhr.onerror = () => reject(new Error('Upload failed. Check the connection.'));
    xhr.send(form);
  });
}
