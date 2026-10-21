import { dimensionsFor } from './util.js';

export const EXPORT_PRESETS = [
    { id: '16:9', label: '16:9 landscape' },
    { id: '9:16', label: '9:16 portrait' },
    { id: '1:1', label: '1:1 square' },
];

export function finishPlan({ preset = '16:9', resolution = '720p', upscale = false, interpolate = false, format = 'mp4' } = {}) {
    const [width, height] = dimensionsFor(resolution, preset);
    const scaleWidth = upscale ? width * 2 : width;
    const scaleHeight = upscale ? height * 2 : height;
    const filters = [`scale=${scaleWidth}:${scaleHeight}:flags=lanczos`];
    if (interpolate) filters.push('minterpolate=fps=48:mi_mode=blend');
    const extension = format === 'webm' ? 'webm' : 'mp4';
    const codec = extension === 'webm' ? ['-c:v', 'libvpx'] : ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
    return {
        width: scaleWidth,
        height: scaleHeight,
        format: extension,
        note: interpolate
            ? 'Frame interpolation uses ffmpeg minterpolate. If this build lacks that filter, export again without it.'
            : (upscale ? 'Upscale is a lanczos resize in the browser stitcher, not a generative upscaler.' : 'Export matches the preset frame.'),
        args: ['-vf', filters.join(','), ...codec],
    };
}
