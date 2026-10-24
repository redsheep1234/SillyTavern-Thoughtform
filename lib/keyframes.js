import { styleLockText } from './style-lock.js';
import { styleLine } from './shotlist.js';
import { shotLine } from './timeline.js';
import { projectMedium } from './variants.js';
import { buildPhrase } from './body.js';
import { appearanceWithoutClothes, outfitById, traitGuard } from './wardrobe.js';

export function placementFor(index, count) {
    const total = Number(count) || 0;
    const at = Number(index) || 0;
    if (total <= 1) return 'centered';
    if (total === 2) return at === 0 ? 'on the left' : 'on the right';
    if (total === 3) return ['on the left', 'in the center', 'on the right'][at] || 'in the group';
    if (at === 0) return 'on the far left';
    if (at === total - 1) return 'on the far right';
    return `in the group, position ${at + 1} of ${total}`;
}

export function traitLine(record, outfit, proposal, medium = '') {
    const worn = Boolean(outfit || proposal);
    const clothes = outfit
        ? `Outfit ${outfit.name}: ${outfit.description || 'as shown on the board'}`
        : proposal
            ? `Outfit ${proposal.name}: ${proposal.description || 'as proposed'}`.trim()
            : '';
    const translated = medium && record?.variantText?.[medium] ? record.variantText[medium] : '';
    const appearance = worn
        ? appearanceWithoutClothes(record?.appearance || '')
        : String(record?.appearance || '').trim();
    return [appearance, translated, buildPhrase(record?.bodyLine), clothes, traitGuard(record)].filter(Boolean).join('. ');
}

export function memberBrief(member, record, index, count, proposals = [], medium = '') {
    const outfit = outfitById(record, member?.outfitId);
    const proposal = (proposals || []).find((item) => item.id === member?.proposalId && item.status !== 'discarded');
    const name = member?.name || record?.name || 'Character';
    const traits = traitLine(record, outfit, proposal, medium) || 'Use the reference still for face, hair, age, and clothes';
    return `${name} is ${placementFor(index, count)}. Distinguishing traits: ${traits}. Keep this person separate. Do not swap their face, age, hair, or outfit with anyone else.`;
}

/** The still prompt. Video is a later, separate step. */
export function composeKeyframePrompt({ scene, settings, records = [], proposals = [] } = {}) {
    const cast = scene?.cast || [];
    const medium = projectMedium(settings);
    const briefs = cast.map((member, index) => {
        const record = records.find((item) => item.key === member.key);
        return memberBrief(member, record, index, cast.length, proposals, medium);
    });
    return [
        styleLockText(settings),
        styleLine(settings || {}),
        cast.length > 1 ? 'Group shot. Place each person as written. Do not merge bodies or trade outfits.' : '',
        ...briefs,
        shotLine(scene || {}),
        scene?.prompt || '',
        scene?.keyframeAdjust ? `Adjustment: ${scene.keyframeAdjust}` : '',
    ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}

export function memberStillPrompt(member, record, outfit, settings) {
    const name = member?.name || record?.name || 'this person';
    return [
        styleLockText(settings),
        styleLine(settings || {}),
        `Single full-body reference of ${name} only, plain background, no other people.`,
        traitLine(record, outfit, null, projectMedium(settings)),
        'Match the reference face, hair, age, and art style.',
    ].map((part) => String(part || '').trim()).filter(Boolean).join('\n');
}

export function needsMemberStill(record, outfitId, existingUrl) {
    if (existingUrl) return false;
    if (!record) return true;
    const images = (record.images || []).filter((image) => image.dataUrl || image.url);
    if (outfitId) return !images.some((image) => image.outfitId === outfitId);
    return !images.some((image) => image.tags?.includes('full body') || image.tags?.includes('turnaround') || image.tags?.includes('outfit'));
}

/** Outfit or identity stills come before the group keyframe. A solo scene is one still. */
export function planKeyframeJob(scene, records = []) {
    const cast = scene?.cast || [];
    const passes = [];
    if (cast.length > 1) {
        for (const member of cast) {
            const record = records.find((item) => item.key === member.key);
            const existing = scene?.memberStills?.[member.key] || '';
            if (needsMemberStill(record, member.outfitId, existing)) {
                passes.push({
                    kind: 'member',
                    key: member.key,
                    name: member.name,
                    outfitId: member.outfitId || '',
                });
            }
        }
    }
    passes.push({ kind: 'scene' });
    return passes;
}

/** Direct mode is the only path that skips the still. Anything else waits for approval. */
export function keyframesPending(scenes, settings) {
    if (settings?.consistency === 'direct') return false;
    return (scenes || []).some((scene) => !scene?.keyframeApproved || !scene?.keyframeDataUrl);
}
