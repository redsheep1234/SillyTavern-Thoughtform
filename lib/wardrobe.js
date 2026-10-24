import { bodyClause } from './body.js';
import { addImage, matchRecord, namesMatch, newId } from './library.js';
import { isPersonaName } from './personas.js';

const CHANGE_RE = /\b(puts on|put on|changes into|changed into|slips into|now wearing|dressed in|pulls on|switches to)\b/i;

export function addOutfit(record, { name, description }) {
    const outfit = {
        id: newId('outfit'),
        name: String(name || 'Outfit').trim().slice(0, 80) || 'Outfit',
        description: String(description || '').trim().slice(0, 800),
    };
    record.outfits.push(outfit);
    return outfit;
}

export function removeOutfit(record, outfitId) {
    record.outfits = record.outfits.filter((outfit) => outfit.id !== outfitId);
    for (const image of record.images) {
        if (image.outfitId === outfitId) image.outfitId = '';
    }
    if (record.defaultOutfitId === outfitId) record.defaultOutfitId = record.outfits[0]?.id || '';
}

export function outfitById(record, outfitId) {
    if (!record || !outfitId) return null;
    return record.outfits.find((outfit) => outfit.id === outfitId) || null;
}

export function outfitByName(record, name) {
    const target = String(name || '').trim().toLowerCase();
    if (!record || !target) return null;
    return record.outfits.find((outfit) => outfit.name.trim().toLowerCase() === target) || null;
}

const CLOTHES = /\b(wear(?:ing|s)?|dressed|outfit|clothes|clothing|coat|raincoat|jacket|shirt|blouse|dress|skirt|trousers|pants|jeans|shorts|shoes|boots|hoodie|sweater|uniform|hat|scarf|gloves|bikini|sarong|gown|cloak|robe|apron)\b/i;

/** Drop clothing phrases so a new outfit does not keep the card's usual clothes. */
export function appearanceWithoutClothes(appearance) {
    const parts = String(appearance || '')
        .split(/[.\n;]|,(?=\s)|\band\b/i)
        .map((part) => part.trim())
        .filter(Boolean);
    return parts.filter((part) => !CLOTHES.test(part)).join(', ');
}

export function outfitPreviewPrompt({ appearance = '', styleLine = '', outfit, mustKeep = '', bodyLine = '' }) {
    const look = appearanceWithoutClothes(appearance);
    return [
        'Edit the reference so this same person is wearing only the outfit below. Keep the face, hair, and body. Remove the previous clothes completely.',
        'Do not keep a coat, trousers, or any garment that is not part of this outfit. Nothing shows underneath.',
        styleLine,
        look ? `Appearance, without clothes: ${look}` : '',
        bodyClause(bodyLine, 'full'),
        mustKeep ? `Must keep: ${mustKeep}.` : '',
        `Outfit name: ${outfit?.name || 'Outfit'}.`,
        outfit?.description ? `Clothes to wear: ${outfit.description}` : '',
        'One person only. A single full-body figure, front view, standing, plain background. Do not draw a second figure.',
    ].filter(Boolean).join(' ');
}

export function wardrobeSummary(entries) {
    return entries.filter((entry) => entry?.record).map((entry) => {
        const { record } = entry;
        const outfits = record.outfits.length
            ? record.outfits.map((outfit) => `${outfit.name}${record.defaultOutfitId === outfit.id ? ' (default)' : ''}: ${outfit.description || 'no description'}`).join('; ')
            : '(no saved outfits)';
        return `${entry.label || record.name}: ${outfits}`;
    }).join('\n');
}

export function traitGuard(record) {
    const keep = String(record?.mustKeep || '').trim();
    const change = String(record?.mayChange || '').trim();
    return [
        keep ? `Must keep: ${keep}.` : '',
        change ? `May change: ${change}.` : '',
    ].filter(Boolean).join(' ');
}

export function appearanceBlock(scene, records, proposals = [], medium = '') {
    const lines = [];
    for (const member of scene.cast || []) {
        const record = records.find((item) => item.key === member.key);
        if (!record) continue;
        const outfit = outfitById(record, member.outfitId);
        const proposal = proposals.find((item) => item.id === member.proposalId && item.status !== 'discarded');
        const clothes = outfit
            ? `Wearing ${outfit.name}: ${outfit.description}`
            : proposal
                ? `Wearing ${proposal.name}: ${proposal.description}`
                : '';
        const translated = medium && record.variantText?.[medium] ? record.variantText[medium] : '';
        const appearance = (outfit || proposal) ? appearanceWithoutClothes(record.appearance) : record.appearance;
        const text = [appearance, translated, bodyClause(record.bodyLine, 'full'), clothes, traitGuard(record)].filter(Boolean).join(' ');
        if (text) lines.push(`${member.name || record.name}: ${text}`);
    }
    return lines.length ? `Keep these appearances:\n${lines.join('\n')}` : '';
}

function mentions(text, member, record) {
    const hay = String(text || '').toLowerCase();
    return [member?.name, record?.name].some((name) => name && name.length > 1 && hay.includes(String(name).toLowerCase()));
}

function exactName(value, member, record) {
    const target = String(value || '').trim().toLowerCase();
    if (!target) return false;
    return [member?.name, record?.name].some((name) => String(name || '').trim().toLowerCase() === target);
}

/** Clauses that are about this member. An unnamed clause applies to everyone in the scene. */
function textAbout(text, member, record, others) {
    const parts = String(text || '').split(/[\n.;]+/).map((part) => part.trim()).filter(Boolean);
    const named = parts.filter((part) => mentions(part, member, record));
    if (named.length) return named.join('. ');
    const unnamed = parts.filter((part) => !others.some((other) => mentions(part, other, other.record)));
    if (!others.length) return unnamed.join('. ');
    return unnamed.join('. ');
}

function inferChange(text, record) {
    if (!record || !text) return null;
    const named = record.outfits.find((outfit) => outfit.name && text.toLowerCase().includes(outfit.name.toLowerCase()) && CHANGE_RE.test(text));
    if (named) return { existing: named };
    if (!CHANGE_RE.test(text)) return null;
    const match = text.match(CHANGE_RE);
    const after = match ? text.slice(match.index + match[0].length).trim() : '';
    const description = (after.split(/\bat\b|[.\n]/)[0] || '').replace(/^[\s,:-]+/, '').trim() || 'New clothes described in the scene';
    const name = description.split(/\s+/).slice(0, 4).join(' ').slice(0, 48) || 'New outfit';
    return { proposal: { name, description: description.slice(0, 400) } };
}

function directiveFor(scene, member, record, others) {
    const rows = scene.outfits || [];
    const exact = rows.find((item) => exactName(item.character, member, record));
    let listed = exact || null;
    if (!listed) {
        const fuzzy = rows.filter((item) => namesMatch(item.character, member.name) || (record && namesMatch(item.character, record.name)));
        if (fuzzy.length === 1) {
            const rivals = [member, ...others].filter((other) => namesMatch(fuzzy[0].character, other.name) || (other.record && namesMatch(fuzzy[0].character, other.record.name)));
            if (rivals.length === 1) listed = fuzzy[0];
        }
    }
    if (listed) {
        const name = String(listed.outfit || '').trim();
        const existing = name && record ? outfitByName(record, name) : null;
        if (existing) return { existing };
        if (listed.change && name) return { proposal: { name, description: String(listed.description || name) } };
        return null;
    }
    const about = textAbout(`${scene.prompt || ''}\n${scene.continuity || ''}`, member, record, others);
    return inferChange(about, record);
}

function memberFromName(name, { records, persona, userName, avatar }) {
    if (persona && isPersonaName(name, persona, userName)) {
        const record = records.find((item) => item.key === persona.boardKey) || null;
        return {
            key: persona.boardKey || '',
            name: persona.name,
            personaId: persona.id || '',
            record,
        };
    }
    const byAvatar = avatar
        ? records.find((item) => item.kind === 'character' && item.avatar && (item.avatar === avatar || avatar.endsWith(item.avatar)))
        : null;
    const record = byAvatar || matchRecord(records, name, 'character');
    return {
        key: record?.key || '',
        name: record?.name || name,
        personaId: '',
        record,
    };
}

/**
 * Assign wardrobe outfits per scene and carry the last outfit forward.
 * A change that matches nothing becomes a proposal. Proposals are not saved.
 * Scenes with castEdited keep the user's cast and outfit choices.
 */
export function trackOutfits(scenes, records, { persona = null, userName = '' } = {}) {
    const saved = new Map(records.map((record) => [record.key, record.defaultOutfitId || '']));
    const pending = new Map();
    const proposals = [];
    const next = scenes.map((scene, sceneIndex) => {
        const copy = {
            ...scene,
            characters: [...(scene.characters || [])],
            outfits: Array.isArray(scene.outfits) ? scene.outfits.map((item) => ({ ...item })) : [],
        };
        if (copy.castEdited && Array.isArray(copy.cast)) {
            copy.cast = copy.cast.map((member) => ({ ...member }));
            return copy;
        }
        const names = copy.characters.length ? copy.characters : [];
        const avatars = Array.isArray(copy.avatars) ? copy.avatars : [];
        const built = names.map((name, nameIndex) => memberFromName(name, { records, persona, userName, avatar: avatars[nameIndex] || '' }));
        copy.cast = built.map((member) => {
            const base = {
                key: member.key,
                name: member.name,
                personaId: member.personaId,
                imageIds: [],
                outfitId: '',
                proposalId: '',
                outfitName: '',
            };
            if (!member.record) return base;
            const others = built.filter((other) => other !== member);
            const directive = directiveFor(copy, member, member.record, others);
            if (directive?.existing) {
                saved.set(member.record.key, directive.existing.id);
                pending.delete(member.record.key);
                base.outfitId = directive.existing.id;
                return base;
            }
            if (directive?.proposal) {
                let proposal = proposals.find((item) => item.characterKey === member.record.key && item.name.toLowerCase() === directive.proposal.name.toLowerCase());
                if (!proposal) {
                    proposal = {
                        id: newId('proposal'),
                        characterKey: member.record.key,
                        characterName: member.name,
                        name: directive.proposal.name,
                        description: directive.proposal.description,
                        previousOutfitId: saved.get(member.record.key) || '',
                        sceneIndexes: [],
                        previewDataUrl: '',
                        prompt: '',
                        error: '',
                        status: 'pending',
                    };
                    proposals.push(proposal);
                }
                if (!proposal.sceneIndexes.includes(sceneIndex)) proposal.sceneIndexes.push(sceneIndex);
                pending.set(member.record.key, proposal.id);
                base.proposalId = proposal.id;
                base.outfitName = proposal.name;
                return base;
            }
            const carried = pending.get(member.record.key);
            if (carried) {
                const proposal = proposals.find((item) => item.id === carried);
                if (proposal && !proposal.sceneIndexes.includes(sceneIndex)) proposal.sceneIndexes.push(sceneIndex);
                base.proposalId = carried;
                base.outfitName = proposal?.name || '';
                return base;
            }
            base.outfitId = saved.get(member.record.key) || '';
            return base;
        });
        return copy;
    });
    return { scenes: next, proposals };
}

export function acceptProposal(record, proposal, { withImage = false } = {}) {
    let outfit = outfitByName(record, proposal.name);
    if (!outfit) outfit = addOutfit(record, proposal);
    if (withImage && proposal.previewDataUrl) {
        addImage(record, {
            dataUrl: proposal.previewDataUrl,
            label: outfit.name,
            tags: ['outfit', 'full body'],
            outfitId: outfit.id,
            source: 'generated',
            prompt: proposal.prompt || '',
        });
    }
    return outfit;
}

export function applyProposalToScenes(scenes, proposal, outfitId) {
    for (const scene of scenes) {
        for (const member of scene.cast || []) {
            if (member.proposalId === proposal.id) {
                member.outfitId = outfitId;
                member.proposalId = '';
                member.outfitName = '';
            }
        }
    }
}

export function discardProposal(scenes, proposal) {
    for (const scene of scenes) {
        for (const member of scene.cast || []) {
            if (member.proposalId === proposal.id) {
                member.outfitId = proposal.previousOutfitId || '';
                member.proposalId = '';
                member.outfitName = '';
            }
        }
    }
}
