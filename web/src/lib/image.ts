/**
 * Уменьшение изображения перед отправкой.
 *
 * Снимок чека с телефона весит 3–5 МБ, а читать с него нужно только сумму
 * и дату. Без уменьшения бюджет вложений в 2 ГБ кончится на пятистах чеках,
 * причём большая часть места уйдёт на детали, которые никто не разглядывает.
 * Не-картинки и мелкие файлы отдаются как есть.
 */
const MAX_SIDE = 1600;
const QUALITY = 0.8;
const SKIP_BELOW = 300 * 1024;

export async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  // SVG — вектор, растрировать его бессмысленно
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
    // Если браузер не смог разобрать картинку — отправляем оригинал
    return file;
  }
}

export async function shrinkAll(files: File[]): Promise<File[]> {
  return Promise.all(files.map(shrinkImage));
}
