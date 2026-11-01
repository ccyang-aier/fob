export class AvatarUploadError extends Error {
  constructor(readonly code: 'type' | 'size' | 'decode') { super(code); }
}

/** Produce an opaque, centered portrait within the identity request's size limit. */
export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new AvatarUploadError('type');
  if (!file.size || file.size > 5*1024*1024) throw new AvatarUploadError('size');
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new AvatarUploadError('decode'); }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > 8192 || bitmap.height > 8192) throw new AvatarUploadError('decode');
    const canvas = document.createElement('canvas'); canvas.width = 192; canvas.height = 192;
    const context = canvas.getContext('2d');
    if (!context) throw new AvatarUploadError('decode');
    context.fillStyle = '#ffffff'; context.fillRect(0,0,192,192);
    const side = Math.min(bitmap.width,bitmap.height);
    context.drawImage(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side,0,0,192,192);
    for (const quality of [.85,.75,.65,.55,.45,.35]) {
      const data = canvas.toDataURL('image/webp',quality);
      if (data.startsWith('data:image/webp;base64,') && data.length <= 12_023) return data;
    }
    throw new AvatarUploadError('decode');
  } finally { bitmap.close(); }
}
