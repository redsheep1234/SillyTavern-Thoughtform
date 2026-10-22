import { referenceMembers } from './cast-filter.js';
import { appearanceBlock } from './wardrobe.js';
import { planSceneImages } from './consistency.js';
import { imagesForPrompt } from './library.js';
import { composeNegativePrompt, composeVideoPrompt } from './shotlist.js';
import { trimmedDuration } from './timeline.js';
import { projectMedium } from './variants.js';

export function collectReferenceImages(scene, records, { medium = '', messages = [] } = {}) {
    const images = [];
    const members = [...referenceMembers(scene, records, messages), ...(scene?.placeCast || [])];
    for (const member of members) {
        const record = records.find((item) => item.key === member.key);
        if (!record) continue;
        for (const image of imagesForPrompt(record, { outfitId: member.outfitId || '', cap: 2, medium })) {
            if (!images.some((item) => item.id === image.id)) images.push(image);
        }
    }
    return images.slice(0, 4);
}

export function buildVideoCall({
    scene,
    settings,
    records,
    proposals = [],
    providerId,
    modelId,
    index = 0,
    chainFrame = '',
    manualStill = '',
    referenceUrls = [],
}) {
    const medium = projectMedium(settings);
    const appearance = appearanceBlock(scene, records, proposals, medium);
    const prompt = composeVideoPrompt(scene, settings, appearance);
    const plan = planSceneImages({
        providerId,
        modelId,
        mode: settings.consistency || 'direct',
        references: referenceUrls,
        keyframe: scene.keyframeApproved ? (scene.keyframeDataUrl || '') : '',
        keyframeMock: scene.keyframeMock === true || (scene.keyframeMock !== false && settings.imageModel === 'mock'),
        chainFrame,
        manualStill,
    });
    const raw = settings.seed === '' || settings.seed == null ? '' : Number(settings.seed);
    const seed = raw === '' || !Number.isFinite(raw) ? '' : (settings.lockSeed === false ? raw + index : raw);
    const lora = (scene.cast || []).map((member) => records.find((item) => item.key === member.key)).find((record) => record?.loraName);
    return {
        prompt,
        negativePrompt: composeNegativePrompt(scene, settings),
        duration: trimmedDuration(scene),
        seed,
        imageDataUrl: plan.imageDataUrl,
        referenceImages: plan.referenceImages,
        note: plan.note,
        loraName: lora?.loraName || '',
        loraStrength: lora?.loraStrength ?? '',
    };
}
