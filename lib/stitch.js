/**
 * Build an ffmpeg filtergraph that crossfades equal-codec clips.
 * Offset for clip N is the running output length minus the fade.
 * @param {number[]} durations seconds of each input
 * @param {number} fade crossfade seconds
 */
export function buildXfadeFilter(durations, fade) {
    if (!durations.length) throw new Error('No clips to stitch.');
    if (durations.length === 1 || fade <= 0) {
        const inputs = durations.map((_, index) => `[${index}:v]`).join('');
        return `${inputs}concat=n=${durations.length}:v=1:a=0[v]`;
    }
    let cursor = durations[0];
    let previous = '[0:v]';
    const parts = [];
    for (let index = 1; index < durations.length; index++) {
        const offset = Math.max(0, cursor - fade);
        const output = index === durations.length - 1 ? '[v]' : `[vx${index}]`;
        parts.push(`${previous}[${index}:v]xfade=transition=fade:duration=${fade}:offset=${offset.toFixed(3)}${output}`);
        cursor += durations[index] - fade;
        previous = output;
    }
    return parts.join(';');
}

let ffmpegPromise = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(`script[data-stsv-src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === '1') resolve();
            else existing.addEventListener('load', () => resolve(), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.dataset.stsvSrc = src;
        script.onload = () => {
            script.dataset.loaded = '1';
            resolve();
        };
        script.onerror = () => reject(new Error('Could not load ffmpeg.wasm from jsDelivr.'));
        document.head.appendChild(script);
    });
}

async function loadFfmpeg() {
    if (!ffmpegPromise) {
        ffmpegPromise = (async () => {
            await loadScript('https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js');
            const factory = globalThis.FFmpeg;
            if (!factory?.createFFmpeg || !factory.fetchFile) throw new Error('ffmpeg.wasm loaded without createFFmpeg.');
            const ffmpeg = factory.createFFmpeg({
                log: false,
                corePath: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
            });
            await ffmpeg.load();
            return { ffmpeg, fetchFile: factory.fetchFile };
        })();
    }
    return ffmpegPromise;
}

/**
 * Stitch clips in the browser. One clip is returned as-is.
 * ffmpeg.wasm 0.11 is single-threaded and does not need cross-origin isolation,
 * which SillyTavern does not send.
 */
export async function stitchClips(clips, { crossfade, fadeSeconds, onProgress, signal } = {}) {
    if (!clips.length) throw new Error('No clips to stitch.');
    if (clips.length === 1) return clips[0];
    if (signal?.aborted) {
        const error = new Error('Cancelled');
        error.name = 'AbortError';
        throw error;
    }
    onProgress?.({ message: 'Loading ffmpeg.wasm' });
    const { ffmpeg, fetchFile } = await loadFfmpeg();
    const fade = crossfade ? Math.max(0, Number(fadeSeconds) || 0) : 0;
    const durations = clips.map((clip) => Math.max(0.5, Number(clip.duration) || 4));
    if (fade > 0 && fade * 2 >= Math.min(...durations)) {
        throw new Error('Crossfade is longer than a scene. Shorten it or turn it off.');
    }
    for (let index = 0; index < clips.length; index++) {
        const data = await fetchFile(clips[index].blob);
        ffmpeg.FS('writeFile', `in${index}.bin`, data);
    }
    const filter = buildXfadeFilter(durations, fade);
    onProgress?.({ message: 'Stitching clips' });
    await ffmpeg.run(
        ...clips.flatMap((_, index) => ['-i', `in${index}.bin`]),
        '-filter_complex', filter,
        '-map', '[v]',
        '-an',
        '-pix_fmt', 'yuv420p',
        'out.mp4',
    );
    const output = ffmpeg.FS('readFile', 'out.mp4');
    for (let index = 0; index < clips.length; index++) {
        try { ffmpeg.FS('unlink', `in${index}.bin`); } catch { /* already gone */ }
    }
    try { ffmpeg.FS('unlink', 'out.mp4'); } catch { /* already gone */ }
    return new Blob([output.buffer], { type: 'video/mp4' });
}
