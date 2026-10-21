import { parseWorkflowJson } from './comfy/workflow.js';
import { getSettings, saveSettings } from './settings.js';
import { decorateMessages, onChatChanged, openPanel } from './panel.js';

let started = false;
let eventsBound = false;
let commandRegistered = false;
let watching = false;

function context() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

export function boot() {
    const ctx = context();
    if (!ctx || typeof document === 'undefined') return;
    if (!started) {
        started = true;
        document.addEventListener('stsv-sync-settings', () => notifySettingsChanged());
    }
    bindEvents(ctx);
    registerCommand(ctx);
    mountAll();
    watchDom();
}

function mountAll() {
    mountLauncher();
    decorateMessages();
    mountSettings();
    watchChat();
}

function mountLauncher() {
    if (!document.getElementById('stsv-send-btn')) {
        const anchor = document.getElementById('send_but');
        const host = document.getElementById('leftSendForm') || document.getElementById('send_form');
        if (anchor?.parentElement || host) {
            const button = document.createElement('div');
            button.id = 'stsv-send-btn';
            button.className = 'stsv-launch fa-solid fa-film interactable';
            button.title = 'Scene video';
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            const open = (event) => {
                event.preventDefault();
                event.stopPropagation();
                openPanel();
            };
            button.addEventListener('click', open);
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') open(event);
            });
            if (anchor?.parentElement) anchor.parentElement.insertBefore(button, anchor);
            else host.appendChild(button);
        }
    }
    const menu = document.getElementById('extensionsMenu');
    if (menu && !document.getElementById('stsv-menu-item')) {
        const item = document.createElement('div');
        item.id = 'stsv-menu-item';
        item.className = 'list-group-item flex-container flexGap5 interactable';
        item.title = 'Scene video';
        item.innerHTML = '<i class="fa-solid fa-film"></i><span>Scene video</span>';
        item.addEventListener('click', (event) => {
            event.preventDefault();
            openPanel();
        });
        menu.appendChild(item);
    }
}

export function refreshMessageButtons() {
    const show = getSettings(context()).showMessageButton !== false;
    document.querySelectorAll('.stsv-msg-btn').forEach((button) => {
        button.hidden = !show;
    });
}

async function mountSettings() {
    if (document.getElementById('stsv-settings')) return;
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host) return;
    const ctx = context();
    let html = '';
    try {
        if (typeof ctx?.renderExtensionTemplateAsync === 'function') {
            html = await ctx.renderExtensionTemplateAsync(`third-party/${extensionFolder()}`, 'settings');
        }
    } catch {
        html = '';
    }
    if (!html) {
        const response = await fetch(new URL('../settings.html', import.meta.url));
        if (!response.ok) return;
        html = await response.text();
    }
    if (document.getElementById('stsv-settings')) return;
    host.insertAdjacentHTML('beforeend', html);
    bindSettingsForm();
}

function extensionFolder() {
    const match = import.meta.url.match(/third-party\/([^/]+)/);
    return match ? match[1] : 'scene-video';
}

function bindSettingsForm() {
    const root = document.getElementById('stsv-settings');
    if (!root) return;
    const settings = getSettings(context());
    root.querySelectorAll('[data-setting]').forEach((field) => {
        writeField(field, readPath(settings, field.dataset.setting));
        field.addEventListener('input', () => onSettingField(field));
        field.addEventListener('change', () => onSettingField(field));
    });
    root.querySelectorAll('[data-example]').forEach((button) => {
        button.addEventListener('click', () => loadExampleIntoSettings(button.dataset.example));
    });
    const file = root.querySelector('#stsv-set-workflow-file');
    file?.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        const text = await picked.text();
        try {
            parseWorkflowJson(text);
        } catch (error) {
            const hint = document.getElementById('stsv-set-workflow-hint');
            if (hint) hint.textContent = error.message;
            return;
        }
        applyWorkflowText(text, picked.name);
    });
}

function onSettingField(field) {
    const settings = getSettings(context());
    const value = field.type === 'checkbox' ? field.checked : field.value;
    writePath(settings, field.dataset.setting, value);
    saveSettings(context());
    if (field.dataset.setting === 'showMessageButton') refreshMessageButtons();
    document.dispatchEvent(new CustomEvent('stsv-sync-settings'));
    if (field.dataset.setting === 'comfyWorkflow' || field.dataset.setting === 'comfyUrl') {
        const hint = document.getElementById('stsv-set-workflow-hint');
        if (hint && field.dataset.setting === 'comfyWorkflow') hint.textContent = workflowHint(field.value);
    }
}

function workflowHint(text) {
    const size = String(text || '').length;
    if (size > 500000) return 'This workflow is over 500KB. SillyTavern stores it in settings.json.';
    if (!size) return 'No workflow loaded.';
    return `Workflow stored (${Math.ceil(size / 1024)}KB).`;
}

async function loadExampleIntoSettings(id) {
    const hint = document.getElementById('stsv-set-workflow-hint');
    try {
        const { loadExampleWorkflow } = await import('./providers/comfyui.js');
        const example = await loadExampleWorkflow(id);
        applyWorkflowText(example.text, example.name);
    } catch (error) {
        if (hint) hint.textContent = error.message;
    }
}

function applyWorkflowText(text, name) {
    const settings = getSettings(context());
    settings.comfyWorkflow = text;
    settings.comfyWorkflowName = name || 'workflow';
    saveSettings(context());
    const area = document.querySelector('#stsv-settings [data-setting="comfyWorkflow"]');
    if (area && document.activeElement !== area) area.value = text;
    const hint = document.getElementById('stsv-set-workflow-hint');
    if (hint) hint.textContent = workflowHint(text);
    document.getElementById('stsv-workflow-name')?.replaceChildren(document.createTextNode(settings.comfyWorkflowName));
}

function readPath(object, path) {
    return path.split('.').reduce((current, key) => current?.[key], object);
}

function writePath(object, path, value) {
    const parts = path.split('.');
    let target = object;
    for (let index = 0; index < parts.length - 1; index++) target = target[parts[index]];
    target[parts.at(-1)] = value;
}

function writeField(field, value) {
    if (field.type === 'checkbox') field.checked = Boolean(value);
    else field.value = value ?? '';
}

function bindEvents(ctx) {
    if (eventsBound) return;
    const source = ctx.eventSource;
    if (!source?.on) return;
    const types = ctx.eventTypes || ctx.event_types || {};
    const listen = (name, handler) => {
        if (name) source.on(name, handler);
    };
    listen(types.APP_READY, mountAll);
    listen(types.APP_INITIALIZED, mountAll);
    listen(types.CHAT_CHANGED, () => {
        decorateMessages();
        onChatChanged();
    });
    listen(types.USER_MESSAGE_RENDERED, decorateMessages);
    listen(types.CHARACTER_MESSAGE_RENDERED, decorateMessages);
    listen(types.MESSAGE_DELETED, decorateMessages);
    listen(types.MESSAGE_EDITED, decorateMessages);
    eventsBound = true;
}

function registerCommand(ctx) {
    if (commandRegistered) return;
    const parser = ctx.SlashCommandParser;
    const Command = ctx.SlashCommand;
    if (!parser?.addCommandObject || !Command?.fromProps) return;
    parser.addCommandObject(Command.fromProps({
        name: 'scenevideo',
        callback: () => {
            openPanel();
            return '';
        },
        helpString: 'Open the Scene Video panel for the current chat.',
    }));
    commandRegistered = true;
}

function watchDom() {
    if (watching || !document.body) return;
    watching = true;
    let timer = 0;
    const observer = new MutationObserver(() => {
        const ready = document.getElementById('stsv-send-btn')
            && document.getElementById('stsv-menu-item')
            && document.getElementById('stsv-settings');
        if (ready && document.getElementById('chat')?.dataset.stsvWatch) return;
        clearTimeout(timer);
        timer = setTimeout(mountAll, 200);
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

function watchChat() {
    const chat = document.getElementById('chat');
    if (!chat || chat.dataset.stsvWatch) return;
    chat.dataset.stsvWatch = '1';
    const observer = new MutationObserver(() => decorateMessages());
    observer.observe(chat, { childList: true, subtree: true });
}

export function notifySettingsChanged() {
    const root = document.getElementById('stsv-settings');
    const settings = getSettings(context());
    root?.querySelectorAll('[data-setting]').forEach((field) => {
        if (document.activeElement === field) return;
        writeField(field, readPath(settings, field.dataset.setting));
    });
    const hint = document.getElementById('stsv-set-workflow-hint');
    if (hint) hint.textContent = workflowHint(settings.comfyWorkflow);
}
