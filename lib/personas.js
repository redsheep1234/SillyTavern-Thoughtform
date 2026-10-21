/**
 * SillyTavern personas. Boards live in the library; this module only reads the host.
 * A chat can pin a persona that is not the global active one.
 */

function descriptionOf(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') return String(value.description || '');
    return '';
}

export function listPersonas(context) {
    const power = context?.powerUserSettings || {};
    const map = power.personas && typeof power.personas === 'object' ? power.personas : {};
    const descriptions = power.persona_descriptions || {};
    const activeAvatar = String(power.user_avatar || '');
    const personas = Object.entries(map).map(([avatar, name]) => ({
        id: String(avatar),
        name: String(name || 'User'),
        avatar: String(avatar),
        description: descriptionOf(descriptions[avatar]) || (avatar === activeAvatar ? String(power.persona_description || '') : ''),
        active: avatar === activeAvatar,
    })).filter((persona) => persona.id);
    if (!personas.length) {
        const name = context?.name1 || 'User';
        personas.push({
            id: activeAvatar || `name:${name}`,
            name,
            avatar: activeAvatar,
            description: String(power.persona_description || ''),
            active: true,
        });
    } else if (!personas.some((persona) => persona.active)) {
        personas[0] = { ...personas[0], active: true };
    }
    return personas;
}

/** The persona whose board is attached when the user is in a scene. */
export function chatPersona(context, personaId) {
    const personas = listPersonas(context);
    if (personaId) {
        const chosen = personas.find((persona) => persona.id === personaId || persona.name === personaId);
        if (chosen) return chosen;
    }
    return personas.find((persona) => persona.active) || personas[0];
}

export function isPersonaName(name, persona, userName = '') {
    const value = String(name || '').trim().toLowerCase();
    if (!value) return false;
    const aliases = new Set(['you', 'user', '{{user}}']);
    if (persona?.name) aliases.add(String(persona.name).trim().toLowerCase());
    if (userName) aliases.add(String(userName).trim().toLowerCase());
    return aliases.has(value);
}
