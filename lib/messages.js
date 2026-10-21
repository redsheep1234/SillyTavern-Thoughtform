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
    };
}

/** Cast from a SillyTavern context, defensive against group chats and missing cards. */
export function collectCast(context) {
    const user = {
        name: context?.name1 || 'User',
        description: clipText(context?.powerUserSettings?.persona_description || '', 1200),
    };
    const characters = [];
    const roster = Array.isArray(context?.characters) ? context.characters : [];
    if (context?.groupId && Array.isArray(context.groups)) {
        const group = context.groups.find((item) => item.id === context.groupId);
        for (const member of group?.members || []) {
            const character = roster.find((item) => item.avatar === member || item.name === member);
            const card = cardOf(character);
            if (card) characters.push(card);
        }
    } else if (context?.characterId != null && roster[context.characterId]) {
        const card = cardOf(roster[context.characterId]);
        if (card) characters.push(card);
    } else if (context?.name2) {
        characters.push({ name: context.name2, description: '', personality: '', scenario: '' });
    }
    return { user, characters };
}
