/** Optional lip-sync pass. fal sync-3 and LatentSync accept a video URL plus an audio URL. */

export const LIPSYNC_MODELS = [
    { id: 'fal-ai/sync-lipsync/v3', label: 'fal sync-lipsync v3', provider: 'fal' },
    { id: 'fal-ai/latentsync', label: 'fal LatentSync', provider: 'fal' },
    { id: 'comfy', label: 'ComfyUI workflow', provider: 'comfy' },
];

export function buildLipsyncRequest(modelId, { videoUrl, audioUrl }) {
    if (!videoUrl || !audioUrl) throw new Error('Lip-sync needs both the scene video and a dialogue audio file.');
    if (modelId === 'fal-ai/latentsync') {
        return { endpoint: 'fal-ai/latentsync', body: { video_url: videoUrl, audio_url: audioUrl } };
    }
    if (modelId === 'comfy') {
        return { endpoint: 'comfy', body: { video: videoUrl, audio: audioUrl } };
    }
    return {
        endpoint: 'fal-ai/sync-lipsync/v3',
        body: { video_url: videoUrl, audio_url: audioUrl, sync_mode: 'cut_off' },
    };
}
