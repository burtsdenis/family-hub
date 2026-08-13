/**
 * Downscale an image before upload.
 *
 * A receipt photo from a phone weighs 3–5 MB, yet all you read off it is
 * the amount and the date. Without downscaling the 2 GB attachment budget
 * runs out after five hundred receipts, with most of the space spent on
 * detail nobody ever inspects. Non-images and small files pass through
 * untouched.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
const SKIP_BELOW = 300 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  // SVG is a vector format — rasterizing it makes no sense
  if (file.type === 'image/svg+xml') return file;
  if (file.size < SKIP_BELOW) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
    return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    // Browser failed to decode the image — upload the original
    return file;
  }
}

export async function shrinkAll(files: File[]): Promise<File[]> {
  return Promise.all(files.map(shrinkImage));
}
