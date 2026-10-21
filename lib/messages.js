import { clipText } from './util.js';

/**
 * @param {any[]} chat
 * @returns {Array<{id:number,name:string,text:string,isUser:boolean,isSystem:boolean}>}
 */
export function listMessages(chat) {
    if (!Array.isArray(chat)) return [];
    const messages = [];
    for (let id = 0; id < chat.length; id++) {
        const message = chat[id];
        if (!message || typeof message !== 'object') continue;
        const text = String(message.mes ?? message.content ?? '').trim();
        if (!text) continue;
        messages.push({
            id,
            name: String(message.name || (message.is_user ? 'You' : 'Character')),
            text,
            isUser: Boolean(message.is_user),
            isSystem: Boolean(message.is_system),
            avatar: String(message.force_avatar || message.original_avatar || ''),
        });
    }
    return messages;
}

export function previewText(text, max = 160) {
    return clipText(text, max);
}

/**
 * @param {Array<{id:number}>} messages
 * @param {number} fromId inclusive chat index
 * @param {number} toId inclusive chat index
 */
export function idsInRange(messages, fromId, toId) {
    const start = Math.min(fromId, toId);
    const end = Math.max(fromId, toId);
    return messages.filter((message) => message.id >= start && message.id <= end).map((message) => message.id);
}

export function lastIds(messages, count) {
    return messages.slice(Math.max(0, messages.length - count)).map((message) => message.id);
}

function cardOf(character) {
    if (!character) return null;
    const data = character.data || {};
    return {
        name: character.name || data.name || 'Character',
        description: clipText(character.description || data.description || '', 1200),
        personality: clipText(character.personality || data.personality || '', 600),
        scenario: clipText(character.scenario || data.scenario || '', 600),
        avatar: character.avatar || data.avatar || '',
    };
}

function sameToken(left, right) {
    const a = String(left || '').trim().toLowerCase();
    const b = String(right || '').trim().toLowerCase();
    return Boolean(a) && a === b;
}

/** SillyTavern stores muted group members in `disabled_members`, usually as avatar filenames. */
export function isMutedMember(group, member, character) {
    const disabled = group?.disabled_members || group?.disabledMembers || [];
    const tokens = [member, character?.avatar, character?.name, character?.data?.avatar];
    return tokens.some((token) => disabled.some((item) => sameToken(item, token)));
}

function findMember(roster, member) {
    return roster.find((item) => sameToken(item.avatar, member) || sameToken(item.name, member) || sameToken(item?.data?.avatar, member));
}

/**
 * Cast from a SillyTavern context.
 * Group members stay on their own cards, including someone who is muted or who only appears partway through the chat.
 * A speaker who has left the group is kept as a guest so their lines are not given to whoever remains.
 */
export function collectCast(context) {
    const user = {
        name: context?.name1 || 'User',
        description: clipText(context?.powerUserSettings?.persona_description || '', 1200),
        avatar: context?.powerUserSettings?.user_avatar || '',
    };
    const characters = [];
    const roster = Array.isArray(context?.characters) ? context.characters : [];
    const group = context?.groupId && Array.isArray(context.groups)
        ? context.groups.find((item) => item.id === context.groupId)
        : null;
    if (group) {
        for (const member of group.members || []) {
            const character = findMember(roster, member);
            const card = cardOf(character) || {
                name: String(member),
                description: '',
                personality: '',
                scenario: '',
                avatar: String(member),
            };
            card.memberId = String(member);
            card.muted = isMutedMember(group, member, character);
            card.guest = !character;
            characters.push(card);
        }
    } else if (context?.characterId != null && roster[context.characterId]) {
        const card = cardOf(roster[context.characterId]);
        if (card) characters.push({ ...card, muted: false, guest: false, memberId: card.avatar || card.name });
    } else if (context?.name2) {
        characters.push({ name: context.name2, description: '', personality: '', scenario: '', avatar: '', muted: false, guest: false, memberId: context.name2 });
    }
    const known = new Set(characters.map((item) => item.name.toLowerCase()));
    const userNames = new Set([user.name.toLowerCase(), 'you', 'user', '{{user}}']);
    for (const message of listMessages(context?.chat)) {
        if (message.isUser || message.isSystem || userNames.has(message.name.toLowerCase())) continue;
        if (known.has(message.name.toLowerCase())) continue;
        const character = roster.find((item) => sameToken(item.name, message.name));
        const card = cardOf(character) || {
            name: message.name,
            description: '',
            personality: '',
            scenario: '',
            avatar: message.avatar || '',
        };
        characters.push({ ...card, memberId: card.avatar || card.name, muted: false, guest: true });
        known.add(card.name.toLowerCase());
    }
    const spoken = listMessages(context?.chat);
    for (const character of characters) {
        character.firstId = spoken.find((message) => message.name.toLowerCase() === character.name.toLowerCase())?.id ?? null;
    }
    return { user, characters, group: Boolean(group), groupName: group?.name || '' };
}

/** Members who belong in a shot list for these messages. Muted people stay out unless they already spoke here. */
export function castForMessages(cast, messages) {
    const speakers = new Set((messages || []).filter((message) => !message.isSystem).map((message) => message.name.toLowerCase()));
    const characters = (cast?.characters || []).filter((character) => {
        if (!character.muted) return true;
        return speakers.has(String(character.name || '').toLowerCase());
    });
    return { ...cast, characters };
}
