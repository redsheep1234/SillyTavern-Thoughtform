/** Local head-and-shoulders crop. No provider call. */

const TARGET = 3 / 4;

/** A 3:4 window on the top centre. Already-portrait stills return null. */
export function portraitCropBox(width, height) {
    const w = Number(width) || 0;
    const h = Number(height) || 0;
    if (w < 8 || h < 8) return null;
    const ratio = w / h;
    if (ratio <= 0.9) return null;
    let fraction = 0.78;
    if (ratio >= 1.45) fraction = 0.46;
    else if (ratio >= 1.2) fraction = 0.58;
    let cropH = Math.max(8, Math.round(h * fraction));
    let cropW = Math.round(cropH * TARGET);
    if (cropW > w) {
        cropW = w;
        cropH = Math.max(8, Math.round(cropW / TARGET));
    }
    if (cropH > h) cropH = h;
    const x = Math.max(0, Math.round((w - cropW) / 2));
    if (cropW >= w - 1 && cropH >= h - 1) return null;
    return { x, y: 0, width: cropW, height: cropH };
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Could not read the still.'));
        image.src = src;
    });
}

/** Canvas crop of a wide still. Returns null when the picture is already a portrait or no canvas exists. */
export async function cropWidePortrait(dataUrl) {
    if (typeof document === 'undefined' || !String(dataUrl || '').startsWith('data:')) return null;
    let image;
    try {
        image = await loadImage(dataUrl);
    } catch {
        return null;
    }
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    const box = portraitCropBox(width, height);
    if (!box) return null;
    const canvas = document.createElement('canvas');
    canvas.width = box.width;
    canvas.height = box.height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height);
    return { dataUrl: canvas.toDataURL('image/jpeg', 0.85), width: box.width, height: box.height, box };
}
