import { familyReferences } from './relations.js';

function haystack(parts) {
    return parts.filter(Boolean).join('\n').toLowerCase();
}

function mentioned(name, text) {
    const target = String(name || '').trim().toLowerCase();
    return target.length > 1 && text.includes(target);
}

export function sceneProse(scene, messages = []) {
    const ids = new Set((scene?.lines || []).map((line) => line?.messageId).filter((id) => id != null));
    const related = ids.size
        ? (messages || []).filter((message) => ids.has(message.id))
        : (messages || []);
    return haystack([
        scene?.prompt,
        scene?.dialogue,
        scene?.title,
        scene?.narration,
        ...(scene?.lines || []).flatMap((line) => [line?.speaker, line?.text]),
        ...related.flatMap((message) => [message?.name, message?.text]),
    ]);
}

/**
 * Cast members whose names are in the scene text or its messages.
 * A manual override replaces that detection.
 */
export function referenceMembers(scene, records = [], messages = []) {
    const cast = Array.isArray(scene?.cast) ? scene.cast : [];
    if (scene?.referenceOverride) {
        const allowed = new Set(scene.referenceKeys || []);
        const chosen = cast.filter((member) => allowed.has(member.key));
        const extras = (records || [])
            .filter((record) => allowed.has(record.key) && !chosen.some((member) => member.key === record.key))
            .map((record) => ({
                key: record.key,
                name: record.name,
                outfitId: record.defaultOutfitId || '',
            }));
        return [...chosen, ...extras];
    }
    const prose = sceneProse(scene, messages);
    const named = cast.filter((member) => {
        const record = (records || []).find((item) => item.key === member.key);
        return mentioned(member.name, prose) || mentioned(record?.name, prose) || mentioned(record?.stName, prose);
    });
    if (named.length) return named;
    const listed = new Set((scene?.characters || []).map((name) => String(name).trim().toLowerCase()));
    const fromList = cast.filter((member) => listed.has(String(member.name || '').trim().toLowerCase()));
    return fromList.length ? fromList : cast;
}

export function referenceChoices(scene, records = [], messages = []) {
    const active = new Set(referenceMembers(scene, records, messages).map((member) => member.key));
    const cast = Array.isArray(scene?.cast) ? scene.cast : [];
    return cast.filter((member) => member?.key).map((member) => ({
        key: member.key,
        name: member.name || 'Character',
        checked: active.has(member.key),
    }));
}

/** The person's own board, plus a relative only when that relative is also in the shot. */
export function boardsForMember(record, records, allowedKeys) {
    const allowed = new Set(allowedKeys || []);
    return [record, ...familyReferences(record, records || [])].filter((source) => source && allowed.has(source.key));
}
