const chat = [
    { name: 'You', is_user: true, is_system: false, mes: 'The lanterns are lit. Walk with me to the bridge.' },
    { name: 'Mara', is_user: false, is_system: false, mes: 'She pulls the green coat tighter and nods toward the wet street.' },
    { name: 'You', is_user: true, is_system: false, mes: 'Stop at the stall with the paper cranes.' },
    { name: 'Mara', is_user: false, is_system: false, mes: 'Mara buys one crane and holds it up against the neon.' },
];

const context = {
    name1: 'You',
    name2: 'Mara',
    characterId: 0,
    groupId: null,
    groups: [],
    chatId: 'preview',
    chat,
    characters: [{
        name: 'Mara',
        description: 'A traveler with silver hair and a green coat.',
        personality: 'Dry humor, watches before she speaks.',
        scenario: 'A night market after rain.',
    }],
    powerUserSettings: { persona_description: 'Someone walking the night market.' },
    extensionSettings: {},
    chatMetadata: {},
    eventSource: {
        on(name, handler) {
            context._events[name] = handler;
        },
    },
    _events: {},
    eventTypes: {
        APP_READY: 'APP_READY',
        APP_INITIALIZED: 'APP_INITIALIZED',
        CHAT_CHANGED: 'CHAT_CHANGED',
        USER_MESSAGE_RENDERED: 'USER_MESSAGE_RENDERED',
        CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
        MESSAGE_DELETED: 'MESSAGE_DELETED',
        MESSAGE_EDITED: 'MESSAGE_EDITED',
    },
    SlashCommandParser: { addCommandObject() {} },
    SlashCommand: { fromProps(props) { return props; } },
    saveSettingsDebounced() {},
    saveMetadataDebounced() {},
    saveChat: async () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    humanizedDateTime: () => '21 October 2026',
    ensureMessageMediaIsArray(message) {
        if (!message.extra) message.extra = {};
        if (!Array.isArray(message.extra.media)) message.extra.media = [];
    },
    appendMediaToMessage(message, element) {
        const host = element?.[0] || element;
        const note = document.createElement('div');
        note.className = 'stsv-attached';
        note.textContent = `Attached ${message.extra.media.at(-1)?.title || 'video'}`;
        host?.append?.(note);
    },
    addOneMessage(message) {
        const row = document.createElement('div');
        row.className = 'mes';
        row.setAttribute('mesid', String(context.chat.length - 1));
        row.innerHTML = `<div class="mes_buttons"></div><p></p>`;
        row.querySelector('p').textContent = message.mes;
        document.getElementById('chat').appendChild(row);
    },
    async renderExtensionTemplateAsync() {
        const response = await fetch('/settings.html');
        return response.text();
    },
    async generateRaw() {
        return JSON.stringify({
            scenes: [
                {
                    title: 'Bridge',
                    prompt: 'Mara, silver hair and a green coat, walks a wet lantern-lit bridge at night.',
                    camera: 'Wide shot, slow push in',
                    duration: 5,
                    negative_prompt: 'watermark',
                    characters: ['Mara'],
                    continuity: '',
                },
                {
                    title: 'Stall',
                    prompt: 'The same woman stops at a paper-crane stall and lifts one crane toward the neon.',
                    camera: 'Medium shot',
                    duration: 5,
                    negative_prompt: '',
                    characters: ['Mara'],
                    continuity: 'Same coat, same hair, same wet street.',
                },
            ],
        });
    },
};

const chatHost = document.getElementById('chat');
chat.forEach((message, index) => {
    const row = document.createElement('div');
    row.className = 'mes';
    row.setAttribute('mesid', String(index));
    row.innerHTML = `<div class="mes_buttons"></div><p><strong></strong> <span></span></p>`;
    row.querySelector('strong').textContent = message.name;
    row.querySelector('span').textContent = message.mes;
    chatHost.appendChild(row);
});

const nativeFetch = window.fetch.bind(window);
window.fetch = async (url, options) => {
    if (String(url).includes('/api/files/upload')) {
        return new Response(JSON.stringify({ path: 'user/files/scene-video.mp4' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    return nativeFetch(url, options);
};

window.SillyTavern = { getContext: () => context };
window.$ = (element) => element;

await import('../index.js');
const { openPanel } = await import('../lib/panel.js');
openPanel();
