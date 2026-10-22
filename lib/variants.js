/** Anime and live-action reference sets stay apart. A style change is text first. */

export const STYLE_MEDIA = [
    { id: 'anime', label: 'Anime' },
    { id: 'live-action', label: 'Live action' },
];

export function projectMedium(settings = {}) {
    if (settings.style === 'anime') return 'anime';
    if (settings.style === 'live-action') return 'live-action';
    return '';
}

export function otherMedium(medium) {
    if (medium === 'anime') return 'live-action';
    if (medium === 'live-action') return 'anime';
    return 'live-action';
}

/** Untagged stills belong only to the medium the user filed them under. */
export function imageBelongsTo(image, medium, sourceMedium = '') {
    if (!medium) return true;
    const tagged = String(image?.medium || '');
    if (tagged) return tagged === medium;
    return Boolean(sourceMedium) && sourceMedium === medium;
}

function inferredLook(record) {
    if (record?.inferredMedium === 'live-action' || record?.inferredMedium === 'anime') return record.inferredMedium;
    const tagged = (record?.images || []).map((image) => image?.medium).find((medium) => medium === 'anime' || medium === 'live-action');
    if (tagged) return tagged;
    if (record?.sourceMedium === 'anime' || record?.sourceMedium === 'live-action') return record.sourceMedium;
    return '';
}

/** The only pictures are the other medium. Say so, and offer the matching style. */
export function styleFallbackNote(record, medium) {
    if (medium !== 'anime' && medium !== 'live-action') return { text: '', switchTo: '' };
    const images = (record?.images || []).filter((image) => image?.dataUrl || image?.url);
    if (!images.length || imagesInMedium(record, medium).length) return { text: '', switchTo: '' };
    const look = inferredLook(record);
    const other = medium === 'anime' ? 'live-action' : 'anime';
    if (look === 'live-action' && medium === 'anime') {
        return { text: 'This picture looks photoreal but the style is Anime. Switch style to Live action?', switchTo: 'live-action' };
    }
    if (look === 'anime' && medium === 'live-action') {
        return { text: 'This picture looks anime but the style is Live action. Switch style to Anime?', switchTo: 'anime' };
    }
    const styleLabel = medium === 'anime' ? 'Anime' : 'Live action';
    return {
        text: `No ${styleLabel.toLowerCase()} still is filed. The avatar will be sent so the picture is not invented.`,
        switchTo: other,
    };
}

/** Shown when the project style has no matching stills. */
export function styleMismatchNote(record, medium) {
    return styleFallbackNote(record, medium).text;
}

export function imagesInMedium(record, medium) {
    if (!record) return [];
    return (record.images || []).filter((image) => imageBelongsTo(image, medium, record.sourceMedium));
}

export function featureBriefPrompt(record) {
    return {
        systemPrompt: [
            'Write a visual description of this fictional character for an image model.',
            'Cover age, face shape, eyes, hair, skin, build, and usual clothes.',
            'Use plain physical words.',
            'Do not mention anime, cel shading, 3D, render, photography, or art style.',
            'Under 120 words. No biography and no refusal.',
        ].join(' '),
        prompt: [
            record?.name || 'Character',
            record?.appearance || '',
            record?.variantText?.anime || '',
            record?.variantText?.['live-action'] || '',
        ].filter(Boolean).join('\n'),
    };
}

export function variantAvatarPrompt({ medium, description, name }) {
    const features = String(description || name || 'the character').trim();
    if (medium === 'live-action') {
        return [
            'Photoreal live-action photograph of a real human.',
            'Natural skin with pores, real hair, available light, 50mm lens, shallow depth of field.',
            'Not a drawing, not anime, not cel shaded, not a 3D render, not glossy plastic skin, not a video-game character.',
            `Person: ${features}`,
            'Head and shoulders, facing the camera, plain neutral background.',
        ].join('\n');
    }
    return [
        '2D anime illustration, cel-shaded, flat color, ink lines.',
        'Not a photograph, not photoreal, not a 3D render, not glossy plastic.',
        `Character: ${features}`,
        'Head and shoulders, facing the camera, plain background.',
    ].join('\n');
}

/** The style-switch still. Picture references stay empty so the other medium cannot leak in. */
export function variantImageRequest({ medium, description, name }) {
    return {
        prompt: variantAvatarPrompt({ medium, description, name }),
        referenceImages: [],
    };
}

export function usableFeatureBrief(text, fallback) {
    const clean = String(text || '').replace(/^```[\w]*\n?|```$/g, '').trim();
    if (!clean || clean.startsWith('{') || clean.startsWith('[')) return String(fallback || '').trim();
    return clean.slice(0, 1200);
}
