import { emptyRecord } from './library.js';

export function placeKey(kind, name) {
    const slug = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    return `${kind}:${slug}`;
}

export function guessPlaces(text) {
    const source = String(text || '');
    const locations = [];
    const props = [];
    const locationRe = /\b(?:at|in|inside|outside|into)\s+the\s+([a-z][a-z' -]{2,32})/gi;
    const propRe = /\b(?:holding|holds|lifts|picks up|carrying|carries)\s+(?:a|the|one)\s+([a-z][a-z' -]{2,32})/gi;
    for (const match of source.matchAll(locationRe)) locations.push(clean(match[1]));
    for (const match of source.matchAll(propRe)) props.push(clean(match[1]));
    return { locations: unique(locations), props: unique(props) };
}

export function attachPlaces(scenes, library) {
    return scenes.map((scene) => {
        const guessed = guessPlaces(`${scene.prompt || ''} ${scene.continuity || ''}`);
        const locations = unique([...(scene.locations || []), ...guessed.locations]);
        const props = unique([...(scene.props || []), ...guessed.props]);
        const placeCast = [];
        for (const name of locations) placeCast.push(board(library, 'location', name));
        for (const name of props) placeCast.push(board(library, 'prop', name));
        return { ...scene, locations, props, placeCast };
    });
}

function board(library, kind, name) {
    const key = placeKey(kind, name);
    if (!library.records[key]) {
        library.records[key] = emptyRecord({ key, name, kind, stName: name });
    }
    return { key, name: library.records[key].name, kind };
}

function clean(value) {
    return String(value || '').replace(/\b(and|with|while|as|then)\b.*$/i, '').trim().replace(/[.,]+$/, '');
}

function unique(items) {
    const seen = new Set();
    const next = [];
    for (const item of items) {
        const name = String(item || '').trim();
        const id = name.toLowerCase();
        if (!name || seen.has(id)) continue;
        seen.add(id);
        next.push(name);
    }
    return next;
}
