const chat = [
    { name: 'Sera Voss', is_user: true, is_system: false, mes: 'The night market is open. Aki, walk with me to the bridge.' },
    { name: 'Aki Vale', is_user: false, is_system: false, force_avatar: '/docs/examples/aki.jpg', mes: 'Aki pulls the indigo coat tighter and nods toward the wet street.' },
    { name: 'Ren Moss', is_user: false, is_system: false, force_avatar: '/docs/examples/ren.jpg', mes: 'Ren stays by the lantern stall and keeps the paper cranes dry.' },
    { name: 'Sera Voss', is_user: true, is_system: false, mes: 'Ren is quiet now. Aki, the bridge is ours.' },
    { name: 'Aki Vale', is_user: false, is_system: false, force_avatar: '/docs/examples/aki.jpg', mes: 'Aki puts on the market uniform and steps onto the bridge.' },
    { name: 'Sable Orr', is_user: false, is_system: false, force_avatar: '/docs/examples/sable.jpg', mes: 'Sable joins at the paper-crane stall, already in a market uniform, and lifts one crane.' },
    { name: 'Sera Voss', is_user: true, is_system: false, mes: 'Sable, that uniform is the same cut as Aki’s, but the crane is yours.' },
];

const characters = [
    {
        name: 'Aki Vale',
        avatar: '/docs/examples/aki.jpg',
        description: 'Short teal braid, square paper lantern on a strap, indigo coat with moth-shaped clasps.',
        personality: 'Speaks after looking.',
        scenario: 'Night market regular.',
    },
    {
        name: 'Ren Moss',
        avatar: '/docs/examples/ren.jpg',
        description: 'Cropped copper hair, round glasses, olive scarf, keeps both hands around a crate.',
        personality: 'Muted in this scene, still present at the stall.',
        scenario: 'Stall keeper.',
    },
    {
        name: 'Sable Orr',
        avatar: '/docs/examples/sable.jpg',
        description: 'Long black coat, silver ear cuff, arrives mid-market with a paper crane.',
        personality: 'Joins late and talks with their hands.',
        scenario: 'Visiting the stall.',
    },
];

const context = {
    name1: 'Sera Voss',
    name2: 'Aki Vale',
    characterId: null,
    groupId: 'market-night',
    groups: [{
        id: 'market-night',
        name: 'Night market',
        members: ['/docs/examples/aki.jpg', '/docs/examples/ren.jpg', '/docs/examples/sable.jpg'],
        disabled_members: ['/docs/examples/ren.jpg'],
    }],
    chatId: 'preview-group',
    chat,
    characters,
    powerUserSettings: {
        persona_description: 'Sera Voss has a short silver bob, amber eyes, and a dark green raincoat. Fixture character, not a real person.',
        user_avatar: '/docs/examples/sera-neutral.jpg',
        personas: {
            '/docs/examples/sera-neutral.jpg': 'Sera Voss',
            '/docs/examples/sera-turn-back.jpg': 'Night Clerk',
        },
        persona_descriptions: {
            '/docs/examples/sera-neutral.jpg': 'Short silver bob, amber eyes, dark green raincoat.',
            '/docs/examples/sera-turn-back.jpg': 'Apron, ink-stained cuffs, no raincoat.',
        },
    },
    extensionSettings: {
        tts: {
            voiceMap: {
                'Sera Voss': 'sera-warm',
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
    saveSettingsDebounced() { writePreviewState(); },
    saveMetadataDebounced() { writePreviewState(); },
    flushExtensionSettings() { writePreviewState(); },
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
                    prompt: 'Sera Voss and Aki Vale walk a wet lantern-lit bridge. Aki wears an indigo coat.',
                    camera: 'Wide shot, slow push in',
                    duration: 5,
                    characters: ['Sera Voss', 'Aki Vale'],
                    dialogue: 'Sera Voss: The night market is open.\nAki Vale: Aki nods toward the wet street.',
                    outfits: [
                        { character: 'Aki Vale', outfit: 'indigo coat', description: 'Indigo coat with moth clasps', change: false },
                    ],
                },
                {
                    title: 'Uniform',
                    prompt: 'Aki puts on the market uniform at the bridge. Sable joins in a different market uniform and lifts a paper crane.',
                    camera: 'Medium shot',
                    duration: 5,
                    characters: ['Aki Vale', 'Sable Orr', 'Sera Voss'],
                    dialogue: 'Aki Vale: Aki puts on the market uniform.\nSable Orr: Sable lifts one crane.\nSera Voss: That uniform is the same cut, but the crane is yours.',
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
const PREVIEW_STATE = 'thoughtform-preview-settings';
const PREVIEW_FILES = 'thoughtform-preview-files';

function readPreviewJson(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
}

function writePreviewState() {
    localStorage.setItem(PREVIEW_STATE, JSON.stringify({
        settings: context.extensionSettings.scene_video,
        metadata: context.chatMetadata,
    }));
}

context.saveSettingsDebounced.flush = writePreviewState;
context.saveMetadataDebounced.flush = writePreviewState;

const storedPreview = readPreviewJson(PREVIEW_STATE);
if (storedPreview?.settings) context.extensionSettings.scene_video = storedPreview.settings;
if (storedPreview?.metadata) context.chatMetadata = storedPreview.metadata;

window.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes('/api/files/upload')) {
        const body = options?.body ? JSON.parse(options.body) : {};
        const name = body.name || `thoughtform-${Date.now()}.jpg`;
        const path = `user/files/${name}`;
        const files = readPreviewJson(PREVIEW_FILES) || {};
        files[path] = body.data || '';
        localStorage.setItem(PREVIEW_FILES, JSON.stringify(files));
        return new Response(JSON.stringify({ path, name }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }
    if (target.includes('/api/files/delete')) {
        const body = options?.body ? JSON.parse(options.body) : {};
        const files = readPreviewJson(PREVIEW_FILES) || {};
        delete files[String(body.path || '').replace(/^\//, '')];
        localStorage.setItem(PREVIEW_FILES, JSON.stringify(files));
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (target.includes('/user/files/')) {
        const path = target.replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '').split('?')[0];
        const files = readPreviewJson(PREVIEW_FILES) || {};
        const data = files[path];
        if (!data) return new Response('missing', { status: 404 });
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } });
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

if (!context.extensionSettings.scene_video) {
    context.extensionSettings.scene_video = { provider: 'mock', imageModel: 'mock', debug: false };
}
window.SillyTavern = { getContext: () => context };
window.$ = (element) => element;

await import('../index.js');
const { openPanel } = await import('../lib/panel.js');
openPanel();
seedSeraBoard();

function seedSeraBoard() {
    const library = context.extensionSettings.scene_video.library;
    const record = Object.values(library.records).find((item) => item.name === 'Sera Voss');
    if (!record) return;
    const seeded = (record.images || []).some((image) => String(image.id || '').startsWith('demo-'));
    if (seeded) {
        if (!record.appearance) record.appearance = 'Short silver bob, amber eyes, dark green raincoat. Fixture character, not a real person.';
        return;
    }
    const stills = [
        ['neutral', ['expression', 'face'], 'neutral', ''],
        ['smile', ['expression', 'face'], 'joy', ''],
        ['laugh', ['expression', 'face'], 'amusement', ''],
        ['sad', ['expression', 'face'], 'sadness', ''],
        ['angry', ['expression', 'face'], 'anger', ''],
        ['surprised', ['expression', 'face'], 'surprise', ''],
        ['blush', ['expression', 'face'], 'embarrassment', ''],
        ['wink', ['expression', 'face'], 'amusement', ''],
        ['turn-front', ['turnaround', 'full body'], '', ''],
        ['turn-three-quarter', ['turnaround', 'full body'], '', ''],
        ['turn-side', ['turnaround', 'full body'], '', ''],
        ['turn-back', ['turnaround', 'full body'], '', ''],
        ['coral', ['outfit', 'full body'], '', 'coral'],
        ['emerald', ['outfit', 'full body'], '', 'emerald'],
    ];
    for (const [stem, tags, stLabel, outfitId] of stills) {
        record.images.push({
            id: `demo-${stem}`,
            dataUrl: '',
            url: `/docs/examples/sera-${stem}.jpg`,
            tags,
            label: stem.replace('turn-', '').replaceAll('-', ' '),
            source: 'generated',
            avatar: '',
            outfitId,
            prompt: 'Sera Voss, short silver bob, amber eyes.',
            stLabel,
        });
    }
    record.primaryId = 'demo-neutral';
    record.sourceMedium = 'anime';
    record.outfits.push(
        { id: 'coral', name: 'coral sarong', description: 'Coral bikini and a sarong tied at the hip.' },
        { id: 'emerald', name: 'emerald dress', description: 'Dark emerald satin slip dress.' },
    );
    record.defaultOutfitId = '';
    record.appearance = 'Short silver bob, amber eyes, dark green raincoat. Fixture character, not a real person.';
}

function showStoredFiles() {
    document.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (!src.includes('/user/files/') || img.dataset.stored === '1') return;
        const path = src.replace(/^\//, '').split('?')[0];
        const files = readPreviewJson(PREVIEW_FILES) || {};
        if (!files[path]) return;
        img.dataset.stored = '1';
        img.dataset.file = path;
        img.src = `data:image/jpeg;base64,${files[path]}`;
    });
}

const storedWatch = new MutationObserver(() => showStoredFiles());
storedWatch.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
showStoredFiles();
