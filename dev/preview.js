const chat = [
    { name: 'Lumen Quill', is_user: true, is_system: false, mes: 'The night market is open. Aki, walk with me to the bridge.' },
    { name: 'Aki Vale', is_user: false, is_system: false, force_avatar: '/docs/examples/lumen-happy.jpg', mes: 'Aki pulls the indigo coat tighter and nods toward the wet street.' },
    { name: 'Ren Moss', is_user: false, is_system: false, force_avatar: '/docs/examples/lumen-turn-side.jpg', mes: 'Ren stays by the lantern stall and keeps the paper cranes dry.' },
    { name: 'Lumen Quill', is_user: true, is_system: false, mes: 'Ren is quiet now. Aki, the bridge is ours.' },
    { name: 'Aki Vale', is_user: false, is_system: false, force_avatar: '/docs/examples/lumen-happy.jpg', mes: 'Aki puts on the market uniform and steps onto the bridge.' },
    { name: 'Sable Orr', is_user: false, is_system: false, force_avatar: '/docs/examples/lumen-uniform.jpg', mes: 'Sable joins at the paper-crane stall, already in a market uniform, and lifts one crane.' },
    { name: 'Lumen Quill', is_user: true, is_system: false, mes: 'Sable, that uniform is the same cut as Aki’s, but the crane is yours.' },
];

const characters = [
    {
        name: 'Aki Vale',
        avatar: '/docs/examples/lumen-happy.jpg',
        description: 'Short teal braid, square paper lantern on a strap, indigo coat with moth-shaped clasps.',
        personality: 'Speaks after looking.',
        scenario: 'Night market regular.',
    },
    {
        name: 'Ren Moss',
        avatar: '/docs/examples/lumen-turn-side.jpg',
        description: 'Cropped copper hair, round glasses, olive scarf, keeps both hands around a crate.',
        personality: 'Muted in this scene, still present at the stall.',
        scenario: 'Stall keeper.',
    },
    {
        name: 'Sable Orr',
        avatar: '/docs/examples/lumen-uniform.jpg',
        description: 'Long black coat, silver ear cuff, arrives mid-market with a paper crane.',
        personality: 'Joins late and talks with their hands.',
        scenario: 'Visiting the stall.',
    },
];

const context = {
    name1: 'Lumen Quill',
    name2: 'Aki Vale',
    characterId: null,
    groupId: 'market-night',
    groups: [{
        id: 'market-night',
        name: 'Night market',
        members: ['/docs/examples/lumen-happy.jpg', '/docs/examples/lumen-turn-side.jpg', '/docs/examples/lumen-uniform.jpg'],
        disabled_members: ['/docs/examples/lumen-turn-side.jpg'],
    }],
    chatId: 'preview-group',
    chat,
    characters,
    powerUserSettings: {
        persona_description: 'Lumen Quill wears a moth-cloak and carries a square lantern. Original character, not a real person.',
        user_avatar: '/docs/examples/lumen-neutral.jpg',
        personas: {
            '/docs/examples/lumen-neutral.jpg': 'Lumen Quill',
            '/docs/examples/lumen-turn-back.jpg': 'Night Clerk',
        },
        persona_descriptions: {
            '/docs/examples/lumen-neutral.jpg': 'Moth-cloak, square lantern, teal braid.',
            '/docs/examples/lumen-turn-back.jpg': 'Apron, ink-stained cuffs, no lantern.',
        },
    },
    extensionSettings: {
        tts: {
            voiceMap: {
                'Lumen Quill': 'lumen-warm',
                'Aki Vale': 'aki-low',
                'Ren Moss': 'ren-soft',
                'Sable Orr': 'sable-bright',
                'Night Clerk': 'clerk-dry',
            },
        },
    },
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
                    prompt: 'Lumen Quill and Aki Vale walk a wet lantern-lit bridge. Aki wears an indigo coat.',
                    camera: 'Wide shot, slow push in',
                    duration: 5,
                    characters: ['Lumen Quill', 'Aki Vale'],
                    dialogue: 'Lumen Quill: The night market is open.\nAki Vale: Aki nods toward the wet street.',
                    outfits: [
                        { character: 'Aki Vale', outfit: 'indigo coat', description: 'Indigo coat with moth clasps', change: false },
                    ],
                },
                {
                    title: 'Uniform',
                    prompt: 'Aki puts on the market uniform at the bridge. Sable joins in a different market uniform and lifts a paper crane.',
                    camera: 'Medium shot',
                    duration: 5,
                    characters: ['Aki Vale', 'Sable Orr', 'Lumen Quill'],
                    dialogue: 'Aki Vale: Aki puts on the market uniform.\nSable Orr: Sable lifts one crane.\nLumen Quill: That uniform is the same cut, but the crane is yours.',
                    outfits: [
                        { character: 'Aki Vale', outfit: 'market uniform', description: 'Ochre market apron over the coat', change: true },
                        { character: 'Sable Orr', outfit: 'market uniform', description: 'Black market apron and silver ear cuff', change: true },
                    ],
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
    const target = String(url);
    if (target.includes('/api/files/upload')) {
        return new Response(JSON.stringify({ path: 'user/files/scene-video.mp4' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (target.includes('/api/sprites/upload')) {
        return new Response(JSON.stringify({ path: 'sprites/neutral.png' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (target.includes('/thumbnail')) {
        return new Response(await tinyPng(), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    return nativeFetch(url, options);
};

function tinyPng() {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (char) => char.charCodeAt(0));
    return new Blob([bytes], { type: 'image/png' });
}

context.extensionSettings.scene_video = { provider: 'mock', imageModel: 'mock', debug: false };
window.SillyTavern = { getContext: () => context };
window.$ = (element) => element;

await import('../index.js');
const { openPanel } = await import('../lib/panel.js');
openPanel();
seedLumenBoard();

function seedLumenBoard() {
    const library = context.extensionSettings.scene_video.library;
    const record = Object.values(library.records).find((item) => item.name === 'Lumen Quill');
    if (!record) return;
    const stills = [
        ['neutral', ['expression', 'face'], 'neutral'],
        ['happy', ['expression', 'face'], 'joy'],
        ['laughing', ['expression', 'face'], 'amusement'],
        ['sad', ['expression', 'face'], 'sadness'],
        ['angry', ['expression', 'face'], 'anger'],
        ['surprised', ['expression', 'face'], 'surprise'],
        ['turn-front', ['turnaround', 'full body'], ''],
        ['turn-side', ['turnaround', 'full body'], ''],
        ['turn-back', ['turnaround', 'full body'], ''],
        ['uniform', ['outfit', 'full body'], ''],
    ];
    for (const [stem, tags, stLabel] of stills) {
        record.images.push({
            id: `demo-${stem}`,
            dataUrl: '',
            url: `/docs/examples/lumen-${stem}.jpg`,
            tags,
            label: stem.replace('turn-', '').replace('-', ' '),
            source: 'generated',
            avatar: '',
            outfitId: stem === 'uniform' ? 'market-uniform' : '',
            prompt: 'Lumen Quill, same lantern, braid, and coat.',
            stLabel,
        });
    }
    record.primaryId = 'demo-neutral';
    record.outfits.push({
        id: 'market-uniform',
        name: 'market uniform',
        description: 'Ochre apron over the indigo coat. The lantern stays.',
    });
    record.defaultOutfitId = '';
    record.appearance = 'Original character. Sand-colored face, teal braid, indigo coat, square lantern. Not a real person.';
}
