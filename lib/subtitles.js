import { linesFromDialogue } from './shotlist.js';
import { trimmedDuration } from './timeline.js';

export function cuesFromScenes(scenes, field = 'caption') {
    let cursor = 0;
    const cues = [];
    (scenes || []).forEach((scene, index) => {
        const duration = trimmedDuration(scene);
        const text = String(scene?.[field] || scene?.dialogue || scene?.caption || scene?.title || `Scene ${index + 1}`).trim();
        if (field === 'narration') {
            const narration = String(scene?.narration || '').trim();
            if (!narration) {
                cursor += duration;
                return;
            }
            cues.push({ start: cursor, end: cursor + duration, text: narration });
        } else if (text) {
            cues.push({ start: cursor, end: cursor + duration, text });
        }
        cursor += duration;
    });
    return cues;
}

/** One cue per spoken line, labeled with the speaker, split across the scene. */
export function speakerCues(scenes) {
    let cursor = 0;
    const cues = [];
    (scenes || []).forEach((scene, index) => {
        const duration = trimmedDuration(scene);
        const lines = Array.isArray(scene?.lines) && scene.lines.length
            ? scene.lines
            : linesFromDialogue(scene?.dialogue || scene?.caption || '', scene?.characters?.[0] || '');
        const spoken = lines.filter((line) => String(line?.text || '').trim());
        if (!spoken.length) {
            const text = String(scene?.title || `Scene ${index + 1}`);
            cues.push({ start: cursor, end: cursor + duration, text, speaker: '' });
        } else {
            const slice = duration / spoken.length;
            spoken.forEach((line, lineIndex) => {
                const speaker = String(line.speaker || 'Narrator');
                cues.push({
                    start: cursor + (lineIndex * slice),
                    end: cursor + ((lineIndex + 1) * slice),
                    text: `${speaker}: ${String(line.text).trim()}`,
                    speaker,
                });
            });
        }
        cursor += duration;
    });
    return cues;
}

export function toSrt(cues) {
    return cues.map((cue, index) => `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text}\n`).join('\n');
}

export function toVtt(cues) {
    return `WEBVTT\n\n${cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}\n`).join('\n')}`;
}

function stamp(seconds, dot = ',') {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = Math.floor(total % 60);
    const ms = Math.round((total - Math.floor(total)) * 1000);
    const pad = (value, size = 2) => String(value).padStart(size, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}${dot}${pad(ms, 3)}`;
}
