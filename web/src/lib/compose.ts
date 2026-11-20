import type { FrameInfo, SlotRect } from '../../../shared/protocol';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`gagal memuat gambar: ${url}`));
    img.src = url;
  });
}

/** Gambar foto memenuhi kotak slot (potong tengah, seperti object-fit: cover). */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, slot: SlotRect): void {
  const scale = Math.max(slot.width / img.naturalWidth, slot.height / img.naturalHeight);
  const sw = slot.width / scale;
  const sh = slot.height / scale;
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) / 2;
  ctx.drawImage(img, sx, sy, sw, sh, slot.x, slot.y, slot.width, slot.height);
}

/**
 * Rakit strip portrait: foto di tiap slot, lalu PNG frame di atasnya.
 * `photoUrls[i]` = foto untuk slot i+1.
 */
export async function composeStrip(frame: FrameInfo, photoUrls: string[]): Promise<Blob> {
  if (photoUrls.length < frame.slots.length) throw new Error('foto kurang dari jumlah slot');
  const [frameImg, ...photos] = await Promise.all([
    loadImage(frame.imageUrl),
    ...photoUrls.slice(0, frame.slots.length).map(loadImage),
  ]);

  const canvas = document.createElement('canvas');
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  frame.slots.forEach((slot, i) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(slot.x, slot.y, slot.width, slot.height);
    ctx.clip();
    drawCover(ctx, photos[i]!, slot);
    ctx.restore();
  });
  ctx.drawImage(frameImg!, 0, 0, frame.width, frame.height);

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('gagal membuat PNG'))), 'image/png'),
  );
}
