/**
 * Client-side image downscaling for avatars.
 *
 * WHY THE CLIENT: avatars are stored as base64 data URIs, averaging ~319KB, so
 * any list that shows faces paid megabytes per page. Downscaling needs an image
 * decoder; doing it in the browser reuses the one already there, and avoids
 * adding a native dependency (sharp/jimp) to the Render deployment.
 *
 * Two sizes are produced from one upload:
 *   - display (512px)  replaces the full-size original on `users.avatar_url`
 *   - thumb   (96px)   stored on `users.avatar_thumb` for lists and headers
 *
 * Both are re-encoded as JPEG, which is dramatically smaller than PNG for
 * photographs. Transparency is irrelevant here because avatars render inside a
 * circular mask.
 */

const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the selected image.'));
    img.src = src;
});

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
});

/**
 * Downscale to a centre-cropped square of `size` px.
 * Cropping (rather than letterboxing) matches how avatars are displayed — in a
 * circle — so the subject stays centred instead of gaining dead margins.
 */
export const downscaleToSquare = async (source, size, quality = 0.82) => {
    const src = typeof source === 'string' ? source : await fileToDataUrl(source);
    const img = await loadImage(src);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Centre-crop the largest square that fits the source.
    const side = Math.min(img.width, img.height);
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);

    return canvas.toDataURL('image/jpeg', quality);
};

/** Produces the pair the API expects: { avatar_url, avatar_thumb }. */
export const buildAvatarPayload = async (source) => {
    const [avatar_url, avatar_thumb] = await Promise.all([
        downscaleToSquare(source, 512, 0.85),
        downscaleToSquare(source, 96, 0.8),
    ]);
    return { avatar_url, avatar_thumb };
};

/** Rough byte size of a data URI, for logging/telemetry. */
export const dataUrlBytes = (dataUrl) => Math.round((String(dataUrl).length * 3) / 4);
