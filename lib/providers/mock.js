const MAX_MOCK_SECONDS = 4;

export async function generateMock(request) {
    const seconds = Math.min(MAX_MOCK_SECONDS, Math.max(1, Number(request.duration) || 2));
    request.onProgress?.({ message: `Drawing a ${seconds}s stand-in clip` });
    if (request.recordClip) return request.recordClip({ ...request, duration: seconds });
    return recordTitleCard({
        text: request.prompt,
        seconds,
        aspectRatio: request.aspectRatio || '16:9',
        signal: request.signal,
        imageDataUrl: request.imageDataUrl || request.referenceImages?.[0] || '',
    });
}

export async function recordTitleCard({ text, seconds, aspectRatio, signal, imageDataUrl }) {
    if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
        throw new Error('The mock provider records a clip in the browser. It is not available in this environment.');
    }
    const [wRatio, hRatio] = String(aspectRatio).split(':').map(Number);
    const width = 640;
    const height = Math.round(width * (hRatio || 9) / (wRatio || 16));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const picture = imageDataUrl ? await loadImage(imageDataUrl) : null;
    const stream = canvas.captureStream(8);
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
        recorder.onerror = () => reject(new Error('Could not record the mock clip.'));
        recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    });
    const started = performance.now();
    let frame;
    const draw = () => {
        if (signal?.aborted) {
            recorder.stop();
            return;
        }
        const t = (performance.now() - started) / 1000;
        const shift = (t * 40) % width;
        const gradient = ctx.createLinearGradient(shift, 0, width, height);
        gradient.addColorStop(0, '#243044');
        gradient.addColorStop(1, '#8c4a32');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(24, height * 0.55, width - 48, height * 0.32);
        ctx.fillStyle = '#f4efe6';
        ctx.font = 'bold 28px sans-serif';
        ctx.fillText('Thoughtform mock', 40, height * 0.62);
        if (picture) ctx.drawImage(picture, 40, 28, Math.min(220, picture.width), Math.min(height * 0.42, picture.height));
        ctx.font = '16px sans-serif';
        wrapText(ctx, String(text || '').slice(0, 280), 40, height * 0.62 + 32, width - 80, 22);
        if (t >= seconds) recorder.stop();
        else frame = requestAnimationFrame(draw);
    };
    recorder.start(200);
    draw();
    try {
        const blob = await stopped;
        blob.recordedSeconds = seconds;
        return blob;
    } finally {
        if (frame) cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
    }
}

function loadImage(url) {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(/\s+/);
    let line = '';
    let cursor = y;
    for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (ctx.measureText(next).width > maxWidth && line) {
            ctx.fillText(line, x, cursor);
            line = word;
            cursor += lineHeight;
            if (cursor > y + lineHeight * 4) return;
        } else {
            line = next;
        }
    }
    if (line) ctx.fillText(line, x, cursor);
}
