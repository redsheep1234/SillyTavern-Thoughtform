import { attachVideoAsNewMessage, attachVideoToMessage } from './attach.js';
import { estimateCost } from './cost.js';
import { ASPECTS, MODULE_NAME, RESOLUTIONS, STYLES, THEMES } from './constants.js';
import { generateShotList } from './llm.js';
import { collectCast, idsInRange, lastIds, listMessages, previewText } from './messages.js';
import { QUALITY_PRESETS, activeModelId, applyQualityPreset } from './presets.js';
import { EXAMPLE_WORKFLOWS, checkComfy, loadExampleWorkflow } from './providers/comfyui.js';
import { getProvider, providers } from './providers/registry.js';
import { getSettings, saveSettings } from './settings.js';
import { composeNegativePrompt, composeVideoPrompt, localShotList } from './shotlist.js';
import { stitchClips } from './stitch.js';
import { abortError, isAbortError, safeFileName } from './util.js';
import { parseWorkflowJson } from './comfy/workflow.js';

const session = {
    root: null,
    chatKey: '',
    selected: new Set(),
    scenes: [],
    shotNote: '',
    imageDataUrl: '',
    imageName: '',
    running: false,
    controller: null,
    remoteCancel: null,
    clips: [],
    resultBlob: null,
    resultUrl: '',
    error: '',
    status: '',
    jobs: [],
    openRouterModels: null,
    modelMenuKey: '',
};

function ctx() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function liveSettings() {
    const context = ctx();
    if (!context?.extensionSettings) return null;
    return getSettings(context);
}

function chatKey(context) {
    const id = context?.chatId ?? context?.getCurrentChatId?.() ?? '';
    return `${id}|${context?.groupId || ''}|${context?.characterId ?? ''}`;
}

export function openPanel({ selectId } = {}) {
    const context = ctx();
    if (!context || typeof document === 'undefined') return;
    ensurePanel();
    const key = chatKey(context);
    if (key !== session.chatKey) loadChatState(context, key);
    if (selectId != null && Number.isFinite(Number(selectId))) session.selected.add(Number(selectId));
    persistSession();
    session.root.hidden = false;
    refreshView();
    session.root.querySelector('.stsv-dialog')?.focus();
}

export function onChatChanged() {
    const context = ctx();
    if (!context || session.running) return;
    const key = chatKey(context);
    if (key === session.chatKey) {
        if (isOpen()) renderMessages();
        return;
    }
    loadChatState(context, key);
    if (isOpen()) refreshView();
}

export function decorateMessages() {
    if (typeof document === 'undefined') return;
    const show = liveSettings()?.showMessageButton !== false;
    document.querySelectorAll('#chat .mes').forEach((mes) => {
        let button = mes.querySelector('.stsv-msg-btn');
        if (!button) {
            const host = mes.querySelector('.extraMesButtons') || mes.querySelector('.mes_buttons');
            if (!host) return;
            button = document.createElement('div');
            button.className = 'stsv-msg-btn fa-solid fa-film';
            button.title = 'Scene video from this message';
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
            const open = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = Number(mes.getAttribute('mesid'));
                openPanel({ selectId: Number.isFinite(id) ? id : undefined });
            };
            button.addEventListener('click', open);
            button.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') open(event);
            });
            host.appendChild(button);
        }
        button.hidden = !show;
    });
}

function isOpen() {
    return Boolean(session.root && !session.root.hidden);
}

function loadChatState(context, key) {
    session.chatKey = key;
    const stored = context.chatMetadata?.[MODULE_NAME];
    session.selected = new Set((stored?.selectedIds || []).map(Number).filter(Number.isFinite));
    session.scenes = Array.isArray(stored?.scenes) ? stored.scenes.map((scene) => ({ ...scene })) : [];
    session.shotNote = session.scenes.length ? 'Restored the shot list saved with this chat.' : '';
    session.jobs = [];
    session.error = '';
    session.status = '';
    session.clips = [];
    clearMovie();
}

function persistSession() {
    const context = ctx();
    const meta = context?.chatMetadata;
    if (!meta || typeof meta !== 'object') return;
    meta[MODULE_NAME] = {
        selectedIds: [...session.selected],
        scenes: session.scenes.map((scene) => ({ ...scene })),
    };
    try {
        context.saveMetadataDebounced?.();
    } catch {
        /* A brand-new chat may not accept metadata yet. */
    }
}

function syncSettingsForm() {
    document.dispatchEvent(new CustomEvent('stsv-sync-settings'));
}

function ensurePanel() {
    if (session.root) return;
    const root = document.createElement('div');
    root.id = 'stsv-root';
    root.className = 'stsv-backdrop';
    root.hidden = true;
    root.innerHTML = panelMarkup();
    document.body.appendChild(root);
    session.root = root;
    document.addEventListener('stsv-sync-settings', () => {
        if (isOpen()) renderChrome();
    });
    root.addEventListener('click', (event) => {
        if (event.target === root) closePanel();
    });
    root.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.stopPropagation();
            closePanel();
        }
    });
    root.querySelectorAll('[data-bind]').forEach((field) => {
        const handler = () => applyControl(field);
        field.addEventListener('input', handler);
        field.addEventListener('change', handler);
    });
    root.querySelectorAll('[data-quality]').forEach((button) => {
        button.addEventListener('click', () => {
            const settings = liveSettings();
            if (!settings || session.running) return;
            applyQualityPreset(settings, button.dataset.quality);
            saveSettings(ctx());
            renderChrome();
        });
    });
    root.querySelector('#stsv-close').addEventListener('click', closePanel);
    root.querySelector('#stsv-all').addEventListener('click', () => setSelection(listMessages(ctx()?.chat).map((message) => message.id)));
    root.querySelector('#stsv-clear').addEventListener('click', () => setSelection([]));
    root.querySelector('#stsv-last').addEventListener('click', () => {
        const count = Number(root.querySelector('#stsv-last-n').value) || 5;
        setSelection(lastIds(listMessages(ctx()?.chat), count));
    });
    root.querySelector('#stsv-range').addEventListener('click', () => {
        const messages = listMessages(ctx()?.chat);
        const from = Number(root.querySelector('#stsv-from').value);
        const to = Number(root.querySelector('#stsv-to').value);
        setSelection(idsInRange(messages, from, to));
    });
    root.querySelector('#stsv-messages').addEventListener('change', (event) => {
        const box = event.target.closest('input[data-id]');
        if (!box) return;
        const id = Number(box.dataset.id);
        if (box.checked) session.selected.add(id);
        else session.selected.delete(id);
        persistSession();
        updateCost();
    });
    root.querySelector('#stsv-shots').addEventListener('input', onShotInput);
    root.querySelector('#stsv-shots').addEventListener('click', onShotClick);
    root.querySelector('#stsv-add-shot').addEventListener('click', () => {
        const settings = liveSettings();
        session.scenes.push({
            title: `Scene ${session.scenes.length + 1}`,
            prompt: '',
            negative_prompt: '',
            camera: '',
            duration: Number(settings?.secondsPerScene) || 5,
            characters: [],
            continuity: '',
        });
        session.shotNote = 'Added a blank scene.';
        persistSession();
        renderShots();
        renderChrome();
    });
    root.querySelector('#stsv-write').addEventListener('click', () => { writeShots(); });
    root.querySelector('#stsv-local').addEventListener('click', useLocalSplit);
    root.querySelector('#stsv-generate').addEventListener('click', () => { generateVideo(); });
    root.querySelector('#stsv-cancel').addEventListener('click', () => { cancelJob(); });
    root.querySelector('#stsv-download').addEventListener('click', downloadMovie);
    root.querySelector('#stsv-attach').addEventListener('click', () => { attachMovie('message'); });
    root.querySelector('#stsv-attach-new').addEventListener('click', () => { attachMovie('new'); });
    root.querySelector('#stsv-clips').addEventListener('click', (event) => {
        const button = event.target.closest('[data-clip]');
        if (!button) return;
        const blob = session.clips[Number(button.dataset.clip)];
        if (blob) downloadBlob(blob, clipName(Number(button.dataset.clip), blob));
    });
    root.querySelector('#stsv-image').addEventListener('change', onImage);
    root.querySelector('#stsv-image-clear').addEventListener('click', () => {
        session.imageDataUrl = '';
        session.imageName = '';
        renderChrome();
    });
    root.querySelector('#stsv-refresh-models').addEventListener('click', () => { refreshOpenRouterModels(); });
    root.querySelector('#stsv-comfy-check').addEventListener('click', () => { pingComfy(); });
    root.querySelector('#stsv-workflow-file').addEventListener('change', onWorkflowFile);
    const examples = root.querySelector('#stsv-examples');
    examples.innerHTML = EXAMPLE_WORKFLOWS.map((example) => (
        `<button type="button" data-example="${escapeAttr(example.id)}">${escapeHtml(example.label)}</button>`
    )).join('');
    examples.addEventListener('click', (event) => {
        const button = event.target.closest('[data-example]');
        if (button) useExample(button.dataset.example);
    });
}

function panelMarkup() {
    const styles = STYLES.map((style) => `<option value="${escapeAttr(style.id)}">${escapeHtml(style.label)}</option>`).join('');
    const themes = THEMES.map((group) => `
        <optgroup label="${escapeAttr(group.group)}">
            ${group.items.map((theme) => `<option value="${escapeAttr(theme.id)}">${escapeHtml(theme.label)}</option>`).join('')}
        </optgroup>
    `).join('');
    const providersHtml = providers.map((provider) => `<option value="${escapeAttr(provider.id)}">${escapeHtml(provider.label)}</option>`).join('');
    const qualities = QUALITY_PRESETS.map((preset) => (
        `<button type="button" data-quality="${preset.id}" aria-pressed="false">${escapeHtml(preset.label)}</button>`
    )).join('');
    const resolutions = RESOLUTIONS.map((value) => `<option value="${value}">${value}</option>`).join('');
    const aspects = ASPECTS.map((value) => `<option value="${value}">${value}</option>`).join('');
    return `
        <div class="stsv-dialog" role="dialog" aria-modal="true" aria-labelledby="stsv-title" tabindex="-1">
            <header class="stsv-header">
                <div>
                    <h2 id="stsv-title">Scene video</h2>
                    <p>Pick the messages, shape the shots, then send them to a video model.</p>
                </div>
                <button type="button" id="stsv-close" aria-label="Close">Close</button>
            </header>
            <div class="stsv-body">
                <section>
                    <h3>Messages</h3>
                    <div class="stsv-row">
                        <button type="button" id="stsv-all">All</button>
                        <button type="button" id="stsv-clear">None</button>
                        <label>Last <input id="stsv-last-n" type="number" min="1" max="200" value="5"></label>
                        <button type="button" id="stsv-last">Select</button>
                        <label>From <select id="stsv-from"></select></label>
                        <label>to <select id="stsv-to"></select></label>
                        <button type="button" id="stsv-range">Select range</button>
                    </div>
                    <div id="stsv-messages" class="stsv-messages"></div>
                </section>
                <section>
                    <h3>Look</h3>
                    <div class="stsv-grid">
                        <label>Shot list
                            <select data-bind="llmSource">
                                <option value="sillytavern">SillyTavern's connected model</option>
                                <option value="openrouter">OpenRouter</option>
                                <option value="openai">OpenAI-compatible endpoint</option>
                            </select>
                        </label>
                        <label>Style <select data-bind="style">${styles}</select></label>
                        <label>Theme <select data-bind="themeId">${themes}</select></label>
                    </div>
                    <div id="stsv-llm-openrouter" class="stsv-sub">
                        <label>OpenRouter text model <input data-bind="openrouterTextModel" type="text" autocomplete="off"></label>
                        <p class="stsv-hint">The OpenRouter key stays under Extensions → Scene Video.</p>
                    </div>
                    <div id="stsv-llm-openai" class="stsv-sub">
                        <label>Base URL <input data-bind="openaiBaseUrl" type="text" autocomplete="off"></label>
                        <label>Model <input data-bind="openaiModel" type="text" autocomplete="off"></label>
                        <p class="stsv-hint">The key for this endpoint stays under Extensions → Scene Video.</p>
                    </div>
                    <label id="stsv-style-other">Style notes <input data-bind="styleOther" type="text"></label>
                    <label>Extra prompt <textarea data-bind="extraPrompt" rows="2"></textarea></label>
                    <label>Negative prompt <textarea data-bind="negativePrompt" rows="2"></textarea></label>
                </section>
                <section>
                    <h3>Video</h3>
                    <div class="stsv-grid">
                        <label>Provider <select data-bind="provider">${providersHtml}</select></label>
                        <label>Model <select id="stsv-model" data-bind="model"></select></label>
                    </div>
                    <p id="stsv-proxy" class="stsv-warn" hidden>Needs SillyTavern's built-in CORS proxy. Replicate blocks browser calls. Set enableCorsProxy: true in config.yaml, or start with --corsProxy, then restart.</p>
                    <p id="stsv-key-line" class="stsv-hint"></p>
                    <p id="stsv-setup" class="stsv-hint"></p>
                    <p id="stsv-nsfw" class="stsv-hint"></p>
                    <div class="stsv-qualities" role="radiogroup" aria-label="Quality">${qualities}</div>
                    <p id="stsv-quality-note" class="stsv-hint"></p>
                    <div class="stsv-grid">
                        <label>Resolution <select data-bind="resolution" data-customizes="1">${resolutions}</select></label>
                        <label>Aspect <select data-bind="aspectRatio">${aspects}</select></label>
                        <label>FPS <input data-bind="fps" data-kind="number" data-customizes="1" type="number" min="1" max="60"></label>
                        <label>Steps <input data-bind="steps" data-kind="number" data-customizes="1" type="number" min="1" max="150"></label>
                        <label>Seconds / scene <input data-bind="secondsPerScene" data-kind="number" type="number" min="1" max="15"></label>
                        <label>Scene count <input data-bind="sceneCount" data-kind="number" type="number" min="0" max="12"></label>
                        <label>Seed <input data-bind="seed" type="text" placeholder="blank = random"></label>
                        <label>Crossfade seconds <input data-bind="crossfadeSeconds" data-kind="number" type="number" min="0" max="2" step="0.1"></label>
                    </div>
                    <div class="stsv-row">
                        <label><input data-bind="crossfade" type="checkbox"> Crossfade between clips</label>
                        <label><input data-bind="generateAudio" type="checkbox"> Generate audio when the model supports it</label>
                        <label><input data-bind="disableSafetyChecker" type="checkbox"> Ask the provider to disable its safety checker</label>
                    </div>
                    <p class="stsv-hint">Scene count 0 means the shot list decides, up to 8 scenes. The checker box only sends the switch a host actually documents. This extension does not filter prompts.</p>
                    <div class="stsv-row">
                        <label class="stsv-file">Reference still <input id="stsv-image" type="file" accept="image/*"></label>
                        <span id="stsv-image-name" class="stsv-hint"></span>
                        <button type="button" id="stsv-image-clear">Clear still</button>
                        <button type="button" id="stsv-refresh-models">Refresh OpenRouter models</button>
                    </div>
                    <div id="stsv-comfy" class="stsv-sub">
                        <label>ComfyUI URL <input data-bind="comfyUrl" type="text"></label>
                        <div class="stsv-row">
                            <button type="button" id="stsv-comfy-check">Check connection</button>
                            <label class="stsv-file">API workflow <input id="stsv-workflow-file" type="file" accept="application/json,.json"></label>
                            <span id="stsv-examples" class="stsv-row"></span>
                        </div>
                        <p class="stsv-hint">Loaded workflow: <span id="stsv-workflow-name">none</span>. Examples are skeletons. Point the loader nodes at files that exist in your ComfyUI. Start it with <code>--enable-cors-header *</code> and keep that port off the public internet.</p>
                        <label>Node mapping override <textarea data-bind="comfyMapping" rows="3" placeholder='{"prompt":{"node":"6","field":"text"}}'></textarea></label>
                    </div>
                    <div id="stsv-custom" class="stsv-sub">
                        <p class="stsv-hint">The submit URL, poll URL, and JSON templates are under Extensions → Scene Video. Runway, Luma, and other hosts go through this provider. Kling's own API needs the SillyTavern proxy.</p>
                    </div>
                </section>
                <section>
                    <h3>Shots</h3>
                    <p id="stsv-shot-note" class="stsv-hint"></p>
                    <div id="stsv-shots"></div>
                    <button type="button" id="stsv-add-shot">Add blank scene</button>
                </section>
                <section id="stsv-jobs-section" hidden>
                    <h3>Progress</h3>
                    <ul id="stsv-jobs"></ul>
                </section>
                <section id="stsv-result" hidden>
                    <h3>Result</h3>
                    <video id="stsv-video" controls playsinline></video>
                    <div class="stsv-row">
                        <button type="button" id="stsv-download">Download</button>
                        <button type="button" id="stsv-attach">Attach to last selected message</button>
                        <button type="button" id="stsv-attach-new">Attach as a new message</button>
                    </div>
                    <div id="stsv-clips" class="stsv-row"></div>
                </section>
                <p id="stsv-error" class="stsv-error" role="alert" hidden></p>
                <p id="stsv-status" class="stsv-status" aria-live="polite"></p>
            </div>
            <footer class="stsv-footer">
                <div>
                    <strong id="stsv-cost">Check provider</strong>
                    <p id="stsv-cost-note"></p>
                </div>
                <div class="stsv-row">
                    <button type="button" id="stsv-write">Write shot list</button>
                    <button type="button" id="stsv-local">Use local split</button>
                    <button type="button" id="stsv-generate" class="stsv-primary">Generate video</button>
                    <button type="button" id="stsv-cancel">Cancel</button>
                </div>
            </footer>
        </div>
    `;
}

function closePanel() {
    if (session.root) session.root.hidden = true;
}

function refreshView() {
    renderMessages();
    renderShots();
    renderJobs();
    renderResult();
    renderChrome();
}

function applyControl(field) {
    const settings = liveSettings();
    if (!settings) return;
    const key = field.dataset.bind;
    let value = field.type === 'checkbox' ? field.checked : field.value;
    if (field.dataset.kind === 'number') value = field.value === '' ? '' : Number(field.value);
    if (key === 'model') {
        assignModel(settings, field.value);
        settings.quality = 'custom';
    } else if (key === 'provider') {
        settings.provider = field.value;
        if (settings.quality !== 'custom') applyQualityPreset(settings, settings.quality);
    } else {
        settings[key] = value;
        if (field.dataset.customizes === '1') settings.quality = 'custom';
    }
    saveSettings(ctx());
    syncSettingsForm();
    if (key === 'provider' || key === 'model' || field.dataset.customizes === '1' || key === 'llmSource' || key === 'style') renderChrome();
    else updateCost();
}

function assignModel(settings, modelId) {
    if (settings.provider === 'xai') settings.xaiModel = modelId;
    if (settings.provider === 'fal') settings.falModel = modelId;
    if (settings.provider === 'replicate') settings.replicateModel = modelId;
    if (settings.provider === 'openrouter') settings.openrouterVideoModel = modelId;
}

function renderChrome() {
    const settings = liveSettings();
    if (!settings || !session.root) return;
    session.root.querySelectorAll('[data-bind]').forEach((field) => {
        if (field.dataset.bind === 'model' || field.dataset.bind === 'provider') return;
        setControl(field, settings[field.dataset.bind]);
    });
    setControl(session.root.querySelector('[data-bind="provider"]'), settings.provider);
    syncModelSelect(settings);
    const provider = getProvider(settings.provider);
    session.root.querySelectorAll('[data-quality]').forEach((button) => {
        const on = button.dataset.quality === settings.quality;
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.classList.toggle('stsv-on', on);
    });
    const preset = QUALITY_PRESETS.find((item) => item.id === settings.quality);
    text('stsv-quality-note', preset ? preset.blurb : 'Custom. A preset will set the model, resolution, frame rate, and steps again.');
    text('stsv-setup', provider.setup || '');
    text('stsv-nsfw', provider.nsfw || '');
    const proxy = session.root.querySelector('#stsv-proxy');
    proxy.hidden = !provider.requiresProxy;
    const keyLine = provider.needsKey
        ? (settings[provider.keySetting] ? 'Key saved in SillyTavern settings.' : 'No key yet. Add one under Extensions → Scene Video.')
        : '';
    text('stsv-key-line', keyLine);
    show('stsv-llm-openrouter', settings.llmSource === 'openrouter');
    show('stsv-llm-openai', settings.llmSource === 'openai');
    show('stsv-style-other', settings.style === 'other');
    show('stsv-comfy', settings.provider === 'comfyui');
    show('stsv-custom', settings.provider === 'custom');
    const refresh = session.root.querySelector('#stsv-refresh-models');
    refresh.hidden = settings.provider !== 'openrouter';
    text('stsv-workflow-name', settings.comfyWorkflowName || (settings.comfyWorkflow ? 'imported workflow' : 'none'));
    text('stsv-image-name', session.imageName ? session.imageName : (session.imageDataUrl ? 'Still ready' : 'No still'));
    const dialog = session.root.querySelector('.stsv-dialog');
    dialog.setAttribute('aria-busy', session.running ? 'true' : 'false');
    session.root.querySelector('#stsv-write').disabled = session.running;
    session.root.querySelector('#stsv-local').disabled = session.running;
    session.root.querySelector('#stsv-generate').disabled = session.running || session.scenes.length === 0;
    session.root.querySelector('#stsv-cancel').disabled = !session.running;
    updateCost();
    renderStatus();
}

function syncModelSelect(settings) {
    const select = session.root.querySelector('#stsv-model');
    const provider = getProvider(settings.provider);
    let models = provider.models || [];
    if (settings.provider === 'openrouter' && session.openRouterModels?.length) {
        models = session.openRouterModels.map((model) => ({ id: model.id, label: model.name || model.id }));
    }
    const current = activeModelId(settings);
    const menuKey = `${settings.provider}:${models.map((model) => model.id).join('|')}`;
    if (menuKey !== session.modelMenuKey) {
        session.modelMenuKey = menuKey;
        select.innerHTML = models.map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.label || model.id)}</option>`).join('');
    }
    if (current && ![...select.options].some((option) => option.value === current)) {
        const option = document.createElement('option');
        option.value = current;
        option.textContent = current;
        select.appendChild(option);
    }
    setControl(select, current);
}

function updateCost() {
    const settings = liveSettings();
    if (!settings || !session.root) return;
    const info = session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel);
    let estimate;
    if (session.scenes.length) {
        const totalSeconds = session.scenes.reduce((sum, scene) => sum + (Number(scene.duration) || 0), 0);
        estimate = estimateCost({
            providerId: settings.provider,
            modelId: activeModelId(settings),
            resolution: settings.resolution,
            sceneCount: session.scenes.length,
            totalSeconds,
            modelInfo: info,
            customPerSecond: settings.custom?.costPerSecond,
        });
    } else {
        const count = Number(settings.sceneCount) || 1;
        estimate = estimateCost({
            providerId: settings.provider,
            modelId: activeModelId(settings),
            resolution: settings.resolution,
            seconds: Number(settings.secondsPerScene) || 5,
            sceneCount: count,
            modelInfo: info,
            customPerSecond: settings.custom?.costPerSecond,
        });
        if (!Number(settings.sceneCount)) {
            estimate.note = `${estimate.note} Auto scene count is priced as one scene until a shot list exists.`;
        }
    }
    text('stsv-cost', `Estimated ${estimate.label}`);
    text('stsv-cost-note', estimate.note);
}

function renderStatus() {
    const error = session.root?.querySelector('#stsv-error');
    const status = session.root?.querySelector('#stsv-status');
    if (!error || !status) return;
    error.hidden = !session.error;
    error.textContent = session.error || '';
    status.textContent = session.status || '';
}

function renderMessages() {
    const list = session.root?.querySelector('#stsv-messages');
    if (!list) return;
    const messages = listMessages(ctx()?.chat);
    if (!messages.length) {
        list.innerHTML = '<p class="stsv-empty">This chat has no text messages yet.</p>';
        fillRange([]);
        return;
    }
    list.innerHTML = messages.map((message) => `
        <label class="stsv-message">
            <input type="checkbox" data-id="${message.id}" ${session.selected.has(message.id) ? 'checked' : ''}>
            <span class="stsv-message-id">#${message.id}</span>
            <span class="stsv-message-name">${escapeHtml(message.name)}</span>
            <span class="stsv-message-text">${escapeHtml(previewText(message.text))}</span>
        </label>
    `).join('');
    fillRange(messages);
}

function fillRange(messages) {
    for (const id of ['stsv-from', 'stsv-to']) {
        const select = session.root.querySelector(`#${id}`);
        const current = select.value;
        select.innerHTML = messages.map((message) => `<option value="${message.id}">#${message.id} ${escapeHtml(message.name)}</option>`).join('');
        if ([...select.options].some((option) => option.value === current)) select.value = current;
    }
}

function setSelection(ids) {
    session.selected = new Set(ids);
    persistSession();
    renderMessages();
    updateCost();
}

function renderShots() {
    const host = session.root?.querySelector('#stsv-shots');
    if (!host) return;
    text('stsv-shot-note', session.shotNote || '');
    if (!session.scenes.length) {
        host.innerHTML = '<p class="stsv-empty">No shots yet. Write a shot list from the selected messages, or use the local split.</p>';
        return;
    }
    host.innerHTML = session.scenes.map((scene, index) => `
        <article class="stsv-shot" data-scene="${index}">
            <header>
                <strong>Scene ${index + 1}</strong>
                <span class="stsv-shot-actions">
                    <button type="button" data-act="up" ${index === 0 ? 'disabled' : ''}>Up</button>
                    <button type="button" data-act="down" ${index === session.scenes.length - 1 ? 'disabled' : ''}>Down</button>
                    <button type="button" data-act="delete">Delete</button>
                </span>
            </header>
            <label>Title <input data-field="title" value="${escapeAttr(scene.title)}"></label>
            <label>Visual prompt <textarea data-field="prompt" rows="4">${escapeHtml(scene.prompt)}</textarea></label>
            <label>Camera <input data-field="camera" value="${escapeAttr(scene.camera)}"></label>
            <label>Negative <input data-field="negative_prompt" value="${escapeAttr(scene.negative_prompt)}"></label>
            <label>Seconds <input data-field="duration" type="number" min="1" max="15" step="1" value="${Number(scene.duration) || 5}"></label>
        </article>
    `).join('');
}

function onShotInput(event) {
    const card = event.target.closest('[data-scene]');
    if (!card) return;
    const scene = session.scenes[Number(card.dataset.scene)];
    const field = event.target.dataset.field;
    if (!scene || !field) return;
    scene[field] = field === 'duration' ? Number(event.target.value) || 1 : event.target.value;
    persistSession();
    if (field === 'duration') updateCost();
}

function onShotClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const index = Number(button.closest('[data-scene]')?.dataset.scene);
    if (!Number.isFinite(index)) return;
    if (button.dataset.act === 'delete') session.scenes.splice(index, 1);
    if (button.dataset.act === 'up' && index > 0) swap(index, index - 1);
    if (button.dataset.act === 'down' && index < session.scenes.length - 1) swap(index, index + 1);
    persistSession();
    renderShots();
    renderChrome();
}

function swap(left, right) {
    const scenes = session.scenes;
    [scenes[left], scenes[right]] = [scenes[right], scenes[left]];
}

function selectedMessages() {
    return listMessages(ctx()?.chat).filter((message) => session.selected.has(message.id));
}

async function writeShots() {
    if (session.running) return;
    const settings = liveSettings();
    const messages = selectedMessages();
    if (!messages.length) return fail('Select at least one message.');
    session.running = true;
    session.controller = new AbortController();
    session.error = '';
    session.status = 'Writing the shot list…';
    renderChrome();
    try {
        const result = await generateShotList({
            messages,
            cast: collectCast(ctx()),
            settings,
            signal: session.controller.signal,
            hasReferenceImage: Boolean(session.imageDataUrl),
        });
        session.scenes = result.scenes;
        session.shotNote = `Shot list from ${sourceLabel(result.source)}. Edit any prompt before you generate.`;
        session.status = '';
        persistSession();
    } catch (error) {
        session.error = isAbortError(error) ? 'Cancelled.' : (error.message || 'The shot list failed.');
        session.status = '';
    } finally {
        session.running = false;
        session.controller = null;
        renderShots();
        renderChrome();
    }
}

function useLocalSplit() {
    if (session.running) return;
    const messages = selectedMessages();
    if (!messages.length) return fail('Select at least one message.');
    session.scenes = localShotList(messages, liveSettings());
    session.shotNote = 'Local split, not a model. The prompts quote the chat. Edit them before you generate.';
    session.error = '';
    persistSession();
    renderShots();
    renderChrome();
}

async function generateVideo() {
    if (session.running) return;
    const settings = liveSettings();
    if (!settings) return fail('SillyTavern settings are not available.');
    if (!session.scenes.length) return fail('Write a shot list, or use the local split, before generating.');
    const empty = session.scenes.findIndex((scene) => !String(scene.prompt || '').trim());
    if (empty >= 0) return fail(`Scene ${empty + 1} has an empty prompt.`);
    const provider = getProvider(settings.provider);
    session.running = true;
    session.controller = new AbortController();
    session.error = '';
    session.clips = [];
    clearMovie();
    session.jobs = session.scenes.map((scene, index) => ({
        title: scene.title || `Scene ${index + 1}`,
        state: 'waiting',
        message: 'Waiting',
    }));
    renderJobs();
    renderResult();
    renderChrome();
    const clips = [];
    try {
        for (let index = 0; index < session.scenes.length; index++) {
            if (session.controller.signal.aborted) throw abortError();
            const scene = session.scenes[index];
            session.jobs[index].state = 'running';
            session.jobs[index].message = 'Starting';
            renderJobs();
            const seed = settings.seed === '' || settings.seed == null ? '' : Number(settings.seed) + index;
            const blob = await provider.generate({
                prompt: composeVideoPrompt(scene, settings),
                negativePrompt: composeNegativePrompt(scene, settings),
                duration: Number(scene.duration) || Number(settings.secondsPerScene) || 5,
                aspectRatio: settings.aspectRatio,
                resolution: settings.resolution,
                fps: Number(settings.fps) || 24,
                steps: Number(settings.steps) || 20,
                seed,
                imageDataUrl: provider.supportsImage ? session.imageDataUrl : '',
                disableSafetyChecker: Boolean(settings.disableSafetyChecker),
                generateAudio: Boolean(settings.generateAudio),
                modelId: activeModelId(settings),
                modelInfo: session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel),
                settings,
                signal: session.controller.signal,
                corsMode: settings.corsMode || 'auto',
                workflowText: settings.comfyWorkflow,
                onProgress: (info) => {
                    session.jobs[index].message = info?.message || session.jobs[index].message;
                    session.status = `Scene ${index + 1} of ${session.scenes.length}: ${session.jobs[index].message}`;
                    renderJobs();
                    renderStatus();
                },
                registerCancel: (fn) => { session.remoteCancel = fn; },
            });
            session.remoteCancel = null;
            clips.push({ blob, duration: Number(scene.duration) || Number(settings.secondsPerScene) || 5 });
            session.clips = clips.map((clip) => clip.blob);
            session.jobs[index].state = 'done';
            session.jobs[index].message = 'Clip ready';
            renderJobs();
        }
        session.status = clips.length > 1 ? 'Stitching clips in the browser' : 'Clip ready';
        renderStatus();
        const movie = await stitchClips(clips, {
            crossfade: Boolean(settings.crossfade) && clips.length > 1,
            fadeSeconds: Number(settings.crossfadeSeconds) || 0,
            signal: session.controller.signal,
            onProgress: (info) => {
                session.status = info?.message || session.status;
                renderStatus();
            },
        });
        rememberMovie(movie);
        session.status = 'Video ready.';
    } catch (error) {
        session.clips = clips.map((clip) => clip.blob);
        session.error = isAbortError(error)
            ? 'Cancelled. Any finished clips can be downloaded below.'
            : (error?.message || 'Video generation failed.');
        if (session.clips.length && !isAbortError(error)) {
            session.error = `${session.error} Finished clips can be downloaded below.`;
        }
        session.jobs.forEach((job) => {
            if (job.state === 'running' || job.state === 'waiting') {
                job.state = 'error';
                job.message = 'Stopped';
            }
        });
    } finally {
        session.running = false;
        session.controller = null;
        session.remoteCancel = null;
        renderJobs();
        renderResult();
        renderChrome();
    }
}

async function cancelJob() {
    session.controller?.abort();
    const cancel = session.remoteCancel;
    session.remoteCancel = null;
    try {
        await cancel?.();
    } catch {
        /* Polling stops on abort either way. */
    }
}

function renderJobs() {
    const section = session.root?.querySelector('#stsv-jobs-section');
    const list = session.root?.querySelector('#stsv-jobs');
    if (!section || !list) return;
    section.hidden = session.jobs.length === 0;
    list.innerHTML = session.jobs.map((job) => `
        <li class="stsv-job stsv-job-${escapeAttr(job.state)}">
            <span>${escapeHtml(job.title)}</span>
            <span>${escapeHtml(job.message || job.state)}</span>
        </li>
    `).join('');
}

function renderResult() {
    const section = session.root?.querySelector('#stsv-result');
    if (!section) return;
    const video = session.root.querySelector('#stsv-video');
    const hasMovie = Boolean(session.resultUrl);
    section.hidden = !hasMovie && session.clips.length === 0;
    if (hasMovie && video.dataset.url !== session.resultUrl) {
        video.src = session.resultUrl;
        video.dataset.url = session.resultUrl;
        video.hidden = false;
    }
    if (!hasMovie) {
        video.removeAttribute('src');
        video.dataset.url = '';
        video.hidden = true;
    }
    session.root.querySelector('#stsv-download').hidden = !hasMovie;
    session.root.querySelector('#stsv-attach').hidden = !hasMovie;
    session.root.querySelector('#stsv-attach-new').hidden = !hasMovie;
    session.root.querySelector('#stsv-clips').innerHTML = session.clips.map((blob, index) => (
        `<button type="button" data-clip="${index}">Download clip ${index + 1}</button>`
    )).join('');
}

function rememberMovie(blob) {
    clearMovie();
    session.resultBlob = blob;
    session.resultUrl = URL.createObjectURL(blob);
}

function clearMovie() {
    if (session.resultUrl) URL.revokeObjectURL(session.resultUrl);
    session.resultUrl = '';
    session.resultBlob = null;
}

function downloadMovie() {
    if (!session.resultBlob) return;
    const ext = session.resultBlob.type?.includes('webm') ? 'webm' : 'mp4';
    downloadBlob(session.resultBlob, safeFileName(`scene-video-${Date.now()}.${ext}`));
}

function clipName(index, blob) {
    const ext = blob.type?.includes('webm') ? 'webm' : 'mp4';
    return safeFileName(`scene-${index + 1}-${Date.now()}.${ext}`);
}

function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function attachMovie(mode) {
    if (!session.resultBlob) return;
    const context = ctx();
    const ext = session.resultBlob.type?.includes('webm') ? 'webm' : 'mp4';
    const filename = `scene-video-${Date.now()}.${ext}`;
    try {
        if (mode === 'new') {
            await attachVideoAsNewMessage(session.resultBlob, { filename, context });
        } else {
            const ids = [...session.selected];
            const messageId = ids.length ? ids[ids.length - 1] : null;
            if (messageId == null) throw new Error('Select a message to attach to, or attach the video as a new message.');
            await attachVideoToMessage(session.resultBlob, { messageId, filename, context });
        }
        session.status = 'Attached to the chat.';
        session.error = '';
    } catch (error) {
        session.error = error.message || 'Could not attach the video.';
    }
    renderChrome();
}

async function onImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        session.imageDataUrl = await compressImage(file);
        session.imageName = file.name;
        session.error = '';
        session.status = 'Reference still is ready for this session. It is not saved in settings.';
    } catch (error) {
        session.error = error.message || 'Could not read that image.';
    }
    renderChrome();
}

function compressImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('Could not read that image.'));
        reader.onload = () => {
            const image = new Image();
            image.onload = () => {
                const max = 1024;
                const scale = Math.min(1, max / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.82));
            };
            image.onerror = () => reject(new Error('Could not read that image.'));
            image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
    });
}

async function refreshOpenRouterModels() {
    if (session.running) return;
    session.status = 'Loading OpenRouter video models…';
    session.error = '';
    renderStatus();
    try {
        const { listOpenRouterVideoModels } = await import('./providers/openrouter.js');
        const settings = liveSettings();
        session.openRouterModels = await listOpenRouterVideoModels({ settings, corsMode: settings.corsMode });
        session.modelMenuKey = '';
        session.status = `Loaded ${session.openRouterModels.length} OpenRouter video models.`;
    } catch (error) {
        session.error = error.message || 'Could not load OpenRouter models.';
        session.status = '';
    }
    renderChrome();
}

async function pingComfy() {
    session.status = 'Checking ComfyUI…';
    session.error = '';
    renderStatus();
    try {
        await checkComfy({ settings: liveSettings() });
        session.status = 'ComfyUI responded.';
    } catch (error) {
        session.error = error.message || 'ComfyUI did not respond.';
        session.status = '';
    }
    renderChrome();
}

async function onWorkflowFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
        const text = await file.text();
        if (text.length > 500000) {
            session.status = 'This workflow is over 500KB. SillyTavern stores it in settings.json.';
        }
        parseWorkflowJson(text);
        const settings = liveSettings();
        settings.comfyWorkflow = text;
        settings.comfyWorkflowName = file.name;
        saveSettings(ctx());
        syncSettingsForm();
        session.error = '';
        session.status = `Loaded ${file.name}.`;
    } catch (error) {
        session.error = error.message || 'Could not read that workflow.';
    }
    renderChrome();
}

async function useExample(id) {
    try {
        const example = await loadExampleWorkflow(id);
        const settings = liveSettings();
        settings.comfyWorkflow = example.text;
        settings.comfyWorkflowName = example.name;
        saveSettings(ctx());
        syncSettingsForm();
        session.error = '';
        session.status = `Loaded ${example.name}. Replace checkpoint names that are not on your machine.`;
    } catch (error) {
        session.error = error.message || 'Could not load that example.';
    }
    renderChrome();
}

function fail(message) {
    session.error = message;
    renderStatus();
}

function sourceLabel(source) {
    if (source === 'openrouter') return 'OpenRouter';
    if (source === 'openai') return 'the OpenAI-compatible endpoint';
    return "SillyTavern's connected model";
}

function setControl(field, value) {
    if (!field || document.activeElement === field) return;
    if (field.type === 'checkbox') {
        field.checked = Boolean(value);
        return;
    }
    const next = value ?? '';
    if (field.value !== String(next)) field.value = next;
}

function text(id, value) {
    const node = session.root?.querySelector(`#${id}`);
    if (node) node.textContent = value || '';
}

function show(id, visible) {
    const node = session.root?.querySelector(`#${id}`);
    if (node) node.hidden = !visible;
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[char]));
}

function escapeAttr(value) {
    return escapeHtml(value);
}
