import { cameraMoveOf, shotTypeOf, trimmedDuration } from './timeline.js';

const MOVE = {
    static: { x: 0, y: 0, zoom: 0.04 },
    pan: { x: 0.08, y: 0, zoom: 0.02 },
    dolly: { x: 0, y: 0, zoom: 0.14 },
    orbit: { x: 0.06, y: 0.03, zoom: 0.06 },
    handheld: { x: 0.03, y: 0.03, zoom: 0.03 },
};

export function planAnimatic(scenes) {
    return (scenes || []).map((scene, index) => {
        const move = MOVE[cameraMoveOf(scene)] || MOVE.static;
        const tight = shotTypeOf(scene) === 'close-up' || shotTypeOf(scene) === 'pov';
        return {
            index,
            title: scene.title || `Scene ${index + 1}`,
            caption: scene.dialogue || scene.caption || scene.title || '',
            narration: scene.narration || '',
            duration: trimmedDuration(scene),
            image: scene.keyframeDataUrl || '',
            shotType: shotTypeOf(scene),
            cameraMove: cameraMoveOf(scene),
            kenBurns: {
                x: move.x,
                y: move.y,
                zoom: move.zoom + (tight ? 0.12 : 0),
            },
        };
    });
}

export async function recordAnimatic(slides, { width = 640, height = 360, signal, onProgress, audioUrl = '' } = {}) {
    if (typeof document === 'undefined') throw new Error('The animatic needs a browser.');
    if (!slides.length) throw new Error('Add a shot list before the animatic.');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    const stream = canvas.captureStream(12);
    let audio;
    if (audioUrl) {
        audio = new Audio(audioUrl);
        audio.crossOrigin = 'anonymous';
        const destination = typeof AudioContext !== 'undefined' ? new AudioContext() : null;
        if (destination) {
            const node = destination.createMediaElementSource(audio);
            const out = destination.createMediaStreamDestination();
            node.connect(out);
            node.connect(destination.destination);
            out.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
        }
    }
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    const chunks = [];
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    recorder.start(200);
    if (audio) audio.play().catch(() => {});
    const started = performance.now();
    let cursor = 0;
    for (const slide of slides) {
        if (signal?.aborted) break;
        onProgress?.({ message: `Animatic: ${slide.title}` });
        const bitmap = await loadImage(slide.image);
        const until = cursor + slide.duration * 1000;
        cursor = until;
        await playSlide(context, canvas, bitmap, slide, until, started, signal);
    }
    audio?.pause();
    recorder.stop();
    await stopped;
    stream.getTracks().forEach((track) => track.stop());
    const blob = new Blob(chunks, { type: 'video/webm' });
    blob.recordedSeconds = slides.reduce((sum, slide) => sum + slide.duration, 0);
    return blob;
}

function loadImage(url) {
    if (!url) return Promise.resolve(null);
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = url;
    });
}

function playSlide(context, canvas, image, slide, until, started, signal) {
    return new Promise((resolve) => {
        const draw = () => {
            if (signal?.aborted || performance.now() - started >= until) {
                resolve();
                return;
            }
            const span = Math.max(0.4, slide.duration);
            const local = Math.min(1, Math.max(0, (performance.now() - started - (until - span * 1000)) / (span * 1000)));
            paint(context, canvas, image, slide, local);
            requestAnimationFrame(draw);
        };
        draw();
    });
}

function paint(context, canvas, image, slide, t) {
    const { width, height } = canvas;
    context.fillStyle = '#1a140e';
    context.fillRect(0, 0, width, height);
    const zoom = 1 + slide.kenBurns.zoom * t;
    const dx = (t - 0.5) * slide.kenBurns.x * width;
    const dy = (t - 0.5) * slide.kenBurns.y * height;
    if (image) {
        const scale = Math.max(width / image.width, height / image.height) * zoom;
        const w = image.width * scale;
        const h = image.height * scale;
        context.drawImage(image, (width - w) / 2 + dx, (height - h) / 2 + dy, w, h);
    } else {
        context.fillStyle = '#e0b15a';
        context.font = '28px sans-serif';
        context.fillText(slide.title, 28, height / 2);
    }
    context.fillStyle = 'rgba(12, 9, 6, 0.72)';
    context.fillRect(0, height - 72, width, 72);
    context.fillStyle = '#f6efe2';
    context.font = '18px sans-serif';
    context.fillText(String(slide.caption || slide.title).slice(0, 80), 16, height - 30);
    if (slide.narration) {
        context.fillStyle = '#e0b15a';
        context.font = '14px sans-serif';
        context.fillText(String(slide.narration).slice(0, 90), 16, 28);
    }
}
