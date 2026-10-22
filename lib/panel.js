import { appendMessageMedia, attachImageDataUrl, attachVideoAsNewMessage, attachVideoToMessage, paintMessageMedia, uploadDataUrl, uploadVideoBlob } from './attach.js';
import { fileSrc, messageIdForScene, restoreSceneMedia, sceneForChat } from './media.js';
import { assessSpend, ledgerTotal, recordSpend } from './budget.js';
import { estimateCost } from './cost.js';
import { ASPECTS, MODULE_NAME, RESOLUTIONS, STYLES, THEMES } from './constants.js';
import { testProviderConnection } from './connect.js';
import { buildDiagnostics, debugLog, explainError, recentLogs } from './debug.js';
import { finishPlan } from './finish.js';
import { createJobLock, jobButtonLabel } from './job-lock.js';
import { planAnimatic, recordAnimatic } from './animatic.js';
import { audToUsd, clipAssetKey, condenseBeats, beatsToMessages, fitPlan, formatAud, keyframeAssetKey, lookupAsset, overCapMessage, releaseMissingClips, rememberAsset, restoredShotNote, stillAssetKey } from './simple.js';
import { generateShotList } from './llm.js';
import { characterRecordKey, ensureLibrary, imagesForPrompt, materializeImage, resolvePersonaBoard, syncLibrary } from './library.js';
import { composeKeyframePrompt, keyframesPending, memberStillPrompt, planKeyframeJob } from './keyframes.js';
import { familyReferences } from './relations.js';
import { styleLockText } from './style-lock.js';
import { projectMedium } from './variants.js';
import { castForMessages, collectCast, idsInRange, lastIds, listMessages, previewText } from './messages.js';
import { attachPlaces } from './places.js';
import { chatPersona, listPersonas } from './personas.js';
import { continuityPrompt, ensureProject, nextEpisode, snapshotVersion } from './project.js';
import { loadQueue, pollJob, resumableJobs, saveQueue, upsertJob } from './queue.js';
import { QUALITY_PRESETS, activeModelId, applyQualityPreset, getQualityPreset } from './presets.js';
import { EXAMPLE_WORKFLOWS, checkComfy, comfyHardwareNote, loadExampleWorkflow } from './providers/comfyui.js';
import { findImageModel, generateReferenceImage, stillCost } from './providers/image.js';
import { getProvider, providers } from './providers/registry.js';
import { buildVideoCall, collectReferenceImages } from './scene-request.js';
import { getSettings, saveSettings } from './settings.js';
import { linesFromDialogue, localShotList, styleLine } from './shotlist.js';
import { speakerCues, toSrt, toVtt } from './subtitles.js';
import { dialogueLines, sillyTavernVoices, synthesizeLine, voiceFor } from './tts.js';
import { buildLipsyncRequest } from './lipsync.js';
import { moodForTheme } from './sound.js';
import { CAMERA_MOVES, SHOT_TYPES, mergeScenes, splitScene } from './timeline.js';
import { stitchClips } from './stitch.js';
import { boardModel, onBoardChange, onBoardClick, onBoardInput, renderBoard } from './ui/board.js';
import { abortError, isAbortError, safeFileName } from './util.js';
import { parseWorkflowJson } from './comfy/workflow.js';
import { outfitById, trackOutfits, wardrobeSummary } from './wardrobe.js';

const session = {
    root: null,
    chatKey: '',
    selected: new Set(),
    scenes: [],
    shotNote: '',
    imageDataUrl: '',
    imageName: '',
    running: false,
    phase: '',
    startedAt: 0,
    clock: null,
    controller: null,
    remoteCancel: null,
    clips: [],
    resultBlob: null,
    resultUrl: '',
    error: '',
    banner: '',
    status: '',
    jobs: [],
    openRouterModels: null,
    modelMenuKey: '',
    step: 'select',
    personaId: '',
    proposals: [],
    studio: null,
    forms: {},
    placeDraft: { name: '', kind: 'location' },
    project: null,
    queue: [],
    confirm: null,
    clipCache: {},
    stillCache: {},
    movieFile: '',
    beats: [],
    beatsDirty: false,
    beatsArmed: false,
};

const jobs = createJobLock();

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
        const host = mes.querySelector('.extraMesButtons') || mes.querySelector('.mes_buttons');
        if (!host) return;
        let button = mes.querySelector('.stsv-msg-btn');
        if (!button) {
            button = document.createElement('div');
            button.className = 'stsv-msg-btn fa-solid fa-film';
            button.title = 'Thoughtform from this message';
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
        let picture = mes.querySelector('.stsv-pic-btn');
        if (!picture) {
            picture = document.createElement('div');
            picture.className = 'stsv-pic-btn fa-solid fa-image';
            picture.title = 'Picture this moment';
            picture.setAttribute('aria-label', 'Picture this moment');
            picture.setAttribute('role', 'button');
            picture.tabIndex = 0;
            const shoot = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const id = Number(mes.getAttribute('mesid'));
                if (Number.isFinite(id)) pictureMoment(id);
            };
            picture.addEventListener('click', shoot);
            picture.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') shoot(event);
            });
            host.appendChild(picture);
        }
        picture.hidden = !show;
    });
}

function isOpen() {
    return Boolean(session.root && !session.root.hidden);
}

function loadChatState(context, key) {
    session.chatKey = key;
    const stored = context.chatMetadata?.[MODULE_NAME];
    session.personaId = stored?.personaId || '';
    session.project = ensureProject(stored?.project, key);
    session.selected = new Set((stored?.selectedIds || []).map(Number).filter(Number.isFinite));
    const restored = releaseMissingClips(Array.isArray(stored?.scenes) ? stored.scenes.map((scene) => ({ ...scene })) : [], session.clipCache);
    session.scenes = restored.scenes.map(restoreSceneMedia);
    session.shotNote = restoredShotNote(session.scenes.length, restored.released);
    session.beats = [];
    session.beatsDirty = false;
    session.beatsArmed = false;
    session.jobs = [];
    session.error = '';
    session.status = '';
    session.clips = [];
    session.movieFile = stored?.movieFile || '';
    clearMovie();
    if (session.movieFile) session.resultUrl = fileSrc(session.movieFile);
}

function persistSession() {
    const context = ctx();
    const meta = context?.chatMetadata;
    if (!meta || typeof meta !== 'object') return;
    meta[MODULE_NAME] = {
        selectedIds: [...session.selected],
        personaId: session.personaId || '',
        project: session.project,
        scenes: session.scenes.map((scene) => sceneForChat(scene)),
        movieFile: session.movieFile || '',
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
    nameFields(root);
    document.addEventListener('stsv-sync-settings', () => {
        if (isOpen()) renderChrome();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !isOpen()) return;
        event.preventDefault();
        event.stopPropagation();
        closePanel();
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
            applyBudgetFit({ lockQuality: true });
        });
    });
    root.querySelectorAll('[data-beats]').forEach((button) => {
        button.addEventListener('click', () => {
            const settings = liveSettings();
            if (!settings || session.running) return;
            settings.beatLength = button.dataset.beats;
            session.beatsDirty = false;
            session.beatsArmed = false;
            saveSettings(ctx());
            syncBeats(true);
            renderBeats();
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
    root.querySelector('#stsv-shots').addEventListener('change', onShotInput);
    root.querySelector('#stsv-shots').addEventListener('click', onShotClick);
    root.querySelector('#stsv-beats').addEventListener('input', onBeatInput);
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
    root.querySelector('#stsv-view-result').addEventListener('click', () => {
        showStep('review');
        const result = session.root?.querySelector('#stsv-result');
        result?.classList.add('stsv-flash');
        session.root?.querySelector('#stsv-video')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
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
    root.querySelector('.stsv-steps').addEventListener('click', (event) => {
        const button = event.target.closest('[data-step-jump]');
        if (button) showStep(button.dataset.stepJump);
    });
    root.querySelector('#stsv-board').addEventListener('click', (event) => { onBoardClick(event, boardEnv()); });
    root.querySelector('#stsv-board').addEventListener('input', (event) => { onBoardInput(event, boardEnv()); });
    root.querySelector('#stsv-board').addEventListener('change', (event) => { onBoardChange(event, boardEnv()); });
    root.querySelector('#stsv-make').addEventListener('click', () => { makeVideo(); });
    root.querySelector('#stsv-srt').addEventListener('click', () => downloadText('thoughtform.srt', toSrt(speakerCues(session.scenes)), 'application/x-subrip'));
    root.querySelector('#stsv-vtt').addEventListener('click', () => downloadText('thoughtform.vtt', toVtt(speakerCues(session.scenes)), 'text/vtt'));
    root.querySelector('#stsv-speak').addEventListener('click', () => { speakLines(); });
    root.querySelector('#stsv-animatic').addEventListener('click', () => { runAnimatic(); });
    root.querySelector('#stsv-finish').addEventListener('click', () => { showFinish(); });
    root.querySelector('#stsv-next-episode').addEventListener('click', () => { startNextEpisode(); });
    root.querySelector('#stsv-lipsync').addEventListener('click', () => { explainLipsync(); });
    root.querySelector('#stsv-copy-diagnostics').addEventListener('click', () => { copyDiagnostics(); });
    root.querySelector('#stsv-test-provider').addEventListener('click', () => { testConnection(liveSettings()?.provider); });
    root.querySelector('#stsv-connection-tests').addEventListener('click', (event) => {
        const button = event.target.closest('[data-test-provider]');
        if (button) testConnection(button.dataset.testProvider);
    });
    root.querySelector('#stsv-queue').addEventListener('click', (event) => {
        const button = event.target.closest('[data-resume]');
        if (button) resumeStoredJob(button.dataset.resume);
    });
    renderConnectionTests();
}

function panelMarkup() {
    const styles = STYLES.map((style) => `<option value="${escapeAttr(style.id)}">${escapeHtml(style.label)}</option>`).join('');
    const themes = THEMES.map((group) => `
        <optgroup label="${escapeAttr(group.group)}">
            ${group.items.map((theme) => `<option value="${escapeAttr(theme.id)}">${escapeHtml(theme.label)}</option>`).join('')}
        </optgroup>
    `).join('');
    const providersHtml = providers.map((provider) => `<option value="${escapeAttr(provider.id)}">${escapeHtml(provider.label)}</option>`).join('');
    const simpleIds = new Set(['draft', 'standard', 'showcase']);
    const qualities = QUALITY_PRESETS.filter((preset) => simpleIds.has(preset.id)).map((preset) => (
        `<button type="button" data-quality="${preset.id}" aria-pressed="false">${escapeHtml(preset.label)}</button>`
    )).join('');
    const advancedQualities = QUALITY_PRESETS.filter((preset) => preset.id === 'high' || preset.id === 'max').map((preset) => (
        `<button type="button" data-quality="${preset.id}" aria-pressed="false">${escapeHtml(preset.label)}</button>`
    )).join('');
    const resolutions = RESOLUTIONS.map((value) => `<option value="${value}">${value}</option>`).join('');
    const aspects = ASPECTS.map((value) => `<option value="${value}">${value}</option>`).join('');
    return `
        <div class="stsv-dialog" role="dialog" aria-modal="true" aria-labelledby="stsv-title" tabindex="-1">
            <header class="stsv-header">
                <div>
                    <h2 id="stsv-title">Thoughtform</h2>
                    <p>Make my video uses your saved budget and look, draws the stills, and waits for you to approve them. Real video is optional after that.</p>
                </div>
                <button type="button" id="stsv-close" aria-label="Close">Close</button>
            </header>
            <div class="stsv-body">
                <p id="stsv-banner" class="stsv-banner" role="alert" hidden></p>
            <nav class="stsv-steps" aria-label="Steps">
                    <button type="button" data-step-jump="select" aria-current="step">Select</button>
                    <button type="button" data-step-jump="cast">Cast and look</button>
                    <button type="button" data-step-jump="story">Storyboard</button>
                    <button type="button" data-step-jump="generate">Generate</button>
                    <button type="button" data-step-jump="review">Review</button>
                </nav>
                <div class="stsv-step" data-step="select">
                <section>
                    <h3>Messages</h3>
                    <p class="stsv-hint">Tick the lines to film. Make my video picks these if you have not, writes the shots, and stops so you can approve each still.</p>
                    <section class="stsv-budget" aria-label="Budget">
                        <div id="stsv-cap-controls">
                            <label title="The most this film should cost, in Australian dollars.">Max spend <input id="stsv-cap-range" name="stsv-cap-range" data-bind="budgetCapAud" type="range" min="0" max="40" step="0.5" aria-label="Max spend in Australian dollars"></label>
                            <label>AUD <input id="stsv-cap-aud" name="stsv-cap-aud" data-bind="budgetCapAud" data-kind="number" type="number" min="0" step="0.5"></label>
                            <p id="stsv-cap-usd" class="stsv-hint"></p>
                        </div>
                        <details>
                            <summary>Or set a length</summary>
                            <label title="Max spend stops when the estimate would pass the cap. A length aims at a runtime instead.">Plan by
                                <select data-bind="budgetMode">
                                    <option value="cap">Max spend</option>
                                    <option value="length">A length</option>
                                </select>
                            </label>
                        </details>
                        <div id="stsv-length-controls">
                            <label>About this long <input id="stsv-length-range" name="stsv-length-range" data-bind="targetSeconds" type="range" min="10" max="180" step="5" aria-label="Target length in seconds"></label>
                            <label>Seconds <input id="stsv-length-seconds" name="stsv-length-seconds" data-bind="targetSeconds" data-kind="number" type="number" min="10" max="180" step="5"></label>
                        </div>
                        <p class="stsv-hint">The cap is in Australian dollars. The US dollar figure uses about 0.66 USD per AUD, a rough rate, not a bank quote. Zero means no cap.</p>
                        <div class="stsv-qualities" role="radiogroup" aria-label="Picture quality">${qualities}</div>
                        <p class="stsv-hint">Draft is the cheapest. Standard is the usual look. Showcase is the sharp one. Finer controls sit under Advanced.</p>
                        <label title="A moving still is a free rough cut that pans across the pictures. Real video is the paid clip."><input data-bind="stillsFirst" type="checkbox"> Start with moving stills, then pick which scenes become real video</label>
                    </section>
                    <div class="stsv-trim">
                        <p class="stsv-hint">How much of a long chat to keep</p>
                        <div class="stsv-qualities" role="radiogroup" aria-label="How much of the chat">
                            <button type="button" data-beats="short" aria-pressed="false">Short</button>
                            <button type="button" data-beats="medium" aria-pressed="false">Medium</button>
                            <button type="button" data-beats="full" aria-pressed="false">Full</button>
                        </div>
                        <div id="stsv-beats"></div>
                    </div>
                    <div class="stsv-row">
                        <button type="button" id="stsv-all">All</button>
                        <button type="button" id="stsv-clear">None</button>
                        <label>Last <input id="stsv-last-n" type="number" min="1" max="200" value="5"></label>
                        <button type="button" id="stsv-last">Select</button>
                        <label>From <select id="stsv-from"></select></label>
                        <label>to <select id="stsv-to"></select></label>
                        <button type="button" id="stsv-range">Select range</button>
                    </div>
                    <div id="stsv-roster" class="stsv-roster" hidden></div>
                    <div id="stsv-messages" class="stsv-messages"></div>
                </section>
                </div>
                <div class="stsv-step" data-step="cast" hidden>
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
                        <p class="stsv-hint">The OpenRouter key stays under Extensions → Thoughtform.</p>
                    </div>
                    <div id="stsv-llm-openai" class="stsv-sub">
                        <label>Base URL <input data-bind="openaiBaseUrl" type="text" autocomplete="off"></label>
                        <label>Model <input data-bind="openaiModel" type="text" autocomplete="off"></label>
                        <p class="stsv-hint">The key for this endpoint stays under Extensions → Thoughtform.</p>
                    </div>
                    <label id="stsv-style-other">Style notes <input data-bind="styleOther" type="text"></label>
                    <label title="Words added to every picture so the face and the medium stay the same.">Style lock
                        <textarea data-bind="styleLock" rows="2" placeholder="2D anime, cel-shaded, same art style as the references"></textarea>
                    </label>
                    <p class="stsv-hint">These words are added to every still and every video. Leave this blank to use the style default, so a new face does not drift into another medium.</p>
                    <label>Extra prompt <textarea data-bind="extraPrompt" rows="2"></textarea></label>
                    <label>Negative prompt <textarea data-bind="negativePrompt" rows="2"></textarea></label>
                    <div class="stsv-grid">
                        <label title="A still is a picture of the scene. Make that picture first, then turn it into video after you approve it. Or skip the still and send the reference photos with the video.">Picture first
                            <select data-bind="consistency">
                                <option value="keyframe">Make a still, then the video</option>
                                <option value="direct">Skip the still and send reference photos</option>
                            </select>
                        </label>
                        <label>Still model
                            <select data-bind="imageModel">
                                <option value="mock">Mock still (no cost)</option>
                                <option value="fal-ai/flux-pro/kontext/multi">Flux Kontext multi (fal)</option>
                                <option value="google/gemini-2.5-flash-image">Gemini image (OpenRouter)</option>
                                <option value="comfy">ComfyUI still workflow</option>
                            </select>
                        </label>
                        <label>New outfit previews
                            <select data-bind="outfitPreviewMode">
                                <option value="image">One preview image</option>
                                <option value="text">Text description only</option>
                            </select>
                        </label>
                        <label>Preview cap <input data-bind="outfitPreviewLimit" data-kind="number" type="number" min="0" max="8"></label>
                    </div>
                    <div class="stsv-row">
                        <label><input data-bind="lockSeed" type="checkbox"> Same seed for every scene</label>
                        <label><input data-bind="chainFrames" type="checkbox"> Chain the last frame into the next scene</label>
                    </div>
                    <p id="stsv-outfit-budget" class="stsv-hint"></p>
                    <p class="stsv-hint">The reference board is how a face stays put. LoRAs are an optional extra and often drift. On an 8GB card such as an RTX 3060 Ti, load the LTX-2.3 example. Wan 2.2 14B does not fit. A Wan 2.2 5B GGUF with offload can, slowly.</p>
                    <div id="stsv-board"></div>
                </section>
                </div>
                <div class="stsv-step" data-step="generate" hidden>
                <section>
                    <h3>Video</h3>
                    <div class="stsv-grid">
                        <label>Provider <select data-bind="provider">${providersHtml}</select></label>
                    </div>
                    <p id="stsv-proxy" class="stsv-warn" hidden>Needs SillyTavern's built-in CORS proxy. Replicate blocks browser calls. Set enableCorsProxy: true in config.yaml, or start with --corsProxy, then restart.</p>
                    <p id="stsv-key-line" class="stsv-hint"></p>
                    <p id="stsv-setup" class="stsv-hint"></p>
                    <p id="stsv-nsfw" class="stsv-hint"></p>
                    <div class="stsv-qualities" role="radiogroup" aria-label="Quality">${qualities}</div>
                    <p id="stsv-quality-note" class="stsv-hint"></p>
                    <details class="stsv-advanced">
                        <summary>Advanced</summary>
                        <p class="stsv-hint">Resolution, frame rate, steps, and the model. Changing them switches you off the simple presets.</p>
                        <div class="stsv-qualities" role="radiogroup" aria-label="Older quality presets">${advancedQualities}</div>
                        <div class="stsv-grid">
                            <label>Model <select id="stsv-model" data-bind="model"></select></label>
                            <label>Resolution <select data-bind="resolution" data-customizes="1">${resolutions}</select></label>
                            <label>Aspect <select data-bind="aspectRatio">${aspects}</select></label>
                            <label>Frames per second <input data-bind="fps" data-kind="number" data-customizes="1" type="number" min="1" max="60"></label>
                            <label>Steps <input data-bind="steps" data-kind="number" data-customizes="1" type="number" min="1" max="150"></label>
                            <label>Seconds per scene <input data-bind="secondsPerScene" data-kind="number" type="number" min="1" max="15"></label>
                            <label>Scene count <input data-bind="sceneCount" data-kind="number" type="number" min="0" max="12"></label>
                            <label>Seed <input data-bind="seed" type="text" placeholder="blank = random"></label>
                            <label>Crossfade seconds <input data-bind="crossfadeSeconds" data-kind="number" type="number" min="0" max="2" step="0.1"></label>
                        </div>
                    </details>
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
                            <button type="button" id="stsv-comfy-check">Test ComfyUI</button>
                            <label class="stsv-file">API workflow <input id="stsv-workflow-file" type="file" accept="application/json,.json"></label>
                            <span id="stsv-examples" class="stsv-row"></span>
                        </div>
                        <p class="stsv-hint">Loaded workflow: <span id="stsv-workflow-name">none</span>. On an 8GB RTX 3060 Ti, use LTX-2.3 (the first example). Point the loader nodes at files that exist in your ComfyUI. Start it with <code>--enable-cors-header *</code> and keep that port off the public internet. Test ComfyUI checks the URL and reports the GPU memory it sees.</p>
                        <label>Node mapping override <textarea data-bind="comfyMapping" rows="3" placeholder='{"prompt":{"node":"6","field":"text"}}'></textarea></label>
                    </div>
                    <div id="stsv-custom" class="stsv-sub">
                        <p class="stsv-hint">The submit URL, poll URL, and JSON templates are under Extensions → Thoughtform. Runway, Luma, and other hosts go through this provider. Kling's own API needs the SillyTavern proxy.</p>
                    </div>
                    <div id="stsv-connection-tests" class="stsv-row"></div>
                    <div class="stsv-row">
                        <button type="button" id="stsv-test-provider">Test connection</button>
                        <label>Ask before spending more than <input data-bind="confirmAbove" data-kind="number" type="number" min="0" step="0.05"></label>
                    </div>
                    <p id="stsv-spend" class="stsv-hint"></p>
                    <div class="stsv-grid">
                        <label>Dialogue voice
                            <select data-bind="ttsProvider">
                                <option value="mock">Mock tone</option>
                                <option value="elevenlabs">ElevenLabs (SillyTavern voice map)</option>
                                <option value="openai">OpenAI-compatible speech</option>
                            </select>
                        </label>
                        <label>Narration
                            <select data-bind="narrationMode">
                                <option value="off">Off</option>
                                <option value="captions">On-screen text</option>
                                <option value="voice">Narrator voiceover</option>
                            </select>
                        </label>
                        <label>Lip-sync
                            <select data-bind="lipSyncModel">
                                <option value="fal-ai/sync-lipsync/v3">fal sync-lipsync v3</option>
                                <option value="fal-ai/latentsync">fal LatentSync</option>
                                <option value="comfy">ComfyUI workflow</option>
                            </select>
                        </label>
                    </div>
                    <label><input data-bind="musicEnabled" type="checkbox"> Mood bed under the animatic</label>
                    <label><input data-bind="burnSubtitles" type="checkbox"> Burn captions into the animatic</label>
                    <label><input data-bind="debug" type="checkbox"> Debug mode</label>
                    <div id="stsv-debug" hidden>
                        <ul id="stsv-log" class="stsv-log"></ul>
                        <button type="button" id="stsv-copy-diagnostics">Copy diagnostics</button>
                    </div>
                    <div id="stsv-queue"></div>
                </section>
                </div>
                <div class="stsv-step" data-step="story" hidden>
                <section>
                    <h3>Shots</h3>
                    <p id="stsv-shot-note" class="stsv-hint"></p>
                    <p id="stsv-video-total" class="stsv-hint"></p>
                    <div id="stsv-shots"></div>
                    <button type="button" id="stsv-add-shot">Add blank scene</button>
                    <p class="stsv-hint" title="A keyframe is the still for that scene.">Each still is the quality gate. Compare it with the person’s photos, edit the adjustment, and redo it. Video does not start until you approve. Group scenes place people left to right and draw each outfit still first.</p>
                    <button type="button" id="stsv-animatic" title="A free rough cut that pans across the stills. No video charge.">Preview animatic</button>
                </section>
                </div>
                <div class="stsv-step" data-step="review" hidden>
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
                <section>
                    <h3>Finish</h3>
                    <p class="stsv-hint">Sidecar captions always download. Upscale here is a lanczos resize. Interpolation needs ffmpeg’s minterpolate filter and is skipped with a plain error if this build lacks it.</p>
                    <div class="stsv-row">
                        <button type="button" id="stsv-srt">Download SRT</button>
                        <button type="button" id="stsv-vtt">Download VTT</button>
                        <button type="button" id="stsv-speak">Speak dialogue</button>
                        <button type="button" id="stsv-lipsync">Lip-sync pass</button>
                        <button type="button" id="stsv-finish">Export preset</button>
                        <button type="button" id="stsv-next-episode">Next episode</button>
                    </div>
                    <div id="stsv-versions"></div>
                </section>
                </div>
            </div>
            <footer class="stsv-footer">
                <div class="stsv-footer-status">
                    <p id="stsv-error" class="stsv-error" role="alert" hidden></p>
                    <p id="stsv-status" class="stsv-status" aria-live="polite"></p>
                    <p id="stsv-cost" class="stsv-cost">≈ A$0.00</p>
                    <details class="stsv-cost-details">
                        <summary>Price details</summary>
                        <p id="stsv-cost-note"></p>
                    </details>
                </div>
                <div class="stsv-row">
                    <label>Output
                        <select id="stsv-output" data-bind="outputMode" aria-label="Output">
                            <option value="video">Video</option>
                            <option value="images">Images only</option>
                        </select>
                    </label>
                    <button type="button" id="stsv-make" class="stsv-primary">Make my video</button>
                    <button type="button" id="stsv-write">Write shot list</button>
                    <button type="button" id="stsv-local">Use local split</button>
                    <button type="button" id="stsv-generate">Generate video</button>
                    <button type="button" id="stsv-view-result" hidden>View result</button>
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
    syncCastBoards();
    renderMessages();
    renderBeats();
    renderRoster();
    renderShots();
    renderPeople();
    renderDebug();
    renderQueue();
    renderJobs();
    renderResult();
    renderChrome();
    showStep(session.step || 'select');
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
    if (key === 'budgetCapAud' || key === 'budgetMode' || key === 'targetSeconds') {
        applyBudgetFit({ lockQuality: settings.quality === 'custom' || settings.quality === 'max' });
        return;
    }
    saveSettings(ctx());
    syncSettingsForm();
    if (key === 'provider' || key === 'model' || field.dataset.customizes === '1' || key === 'llmSource' || key === 'style' || key === 'stillsFirst' || key === 'imageModel' || key === 'outputMode') renderChrome();
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
        ? (settings[provider.keySetting] ? 'Key saved in SillyTavern settings.' : 'No key yet. Add one under Extensions → Thoughtform.')
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
    const generate = session.root.querySelector('#stsv-generate');
    const make = session.root.querySelector('#stsv-make');
    const busy = session.running ? jobButtonLabel(session.phase) : '';
    generate.disabled = session.running || session.scenes.length === 0;
    generate.classList.toggle('stsv-busy', session.running);
    generate.textContent = busy || generateLabel(settings);
    generate.title = /animatic/i.test(generate.textContent)
        ? 'A free rough cut that moves across the stills. It does not call a video host.'
        : (/keyframe|still/i.test(generate.textContent)
            ? 'Draw a still for each scene. The video waits until you approve it.'
            : 'Make the scenes you marked as real video.');
    if (make) {
        make.disabled = session.running;
        make.classList.toggle('stsv-busy', session.running);
        make.textContent = busy || (wantsImages(settings) ? 'Make the pictures' : 'Make my video');
    }
    const animatic = session.root.querySelector('#stsv-animatic');
    if (animatic) animatic.disabled = session.running;
    const write = session.root.querySelector('#stsv-write');
    write.textContent = session.beatsArmed ? 'Write the shots' : 'Write shot list';
    session.root.querySelectorAll('[data-beats]').forEach((button) => {
        const on = button.dataset.beats === (settings.beatLength || 'medium');
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.classList.toggle('stsv-on', on);
    });
    show('stsv-cap-controls', settings.budgetMode !== 'length');
    show('stsv-length-controls', settings.budgetMode === 'length');
    const capUsd = audToUsd(settings.budgetCapAud);
    text('stsv-cap-usd', settings.budgetMode === 'length' ? '' : `About $${capUsd.toFixed(2)} USD.`);
    session.root.querySelector('#stsv-cancel').disabled = !session.running;
    updateCost();
    show('stsv-debug', Boolean(settings.debug));
    const spent = ledgerTotal(settings.spentLedger);
    text('stsv-spend', spent ? `Spent about $${spent.toFixed(2)} on this browser.` : 'Nothing spent in this browser yet.');
    renderDebug();
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

function wantsImages(settings) {
    return settings?.outputMode === 'images';
}

function generateLabel(settings) {
    if (wantsImages(settings)) return 'Generate stills';
    if (keyframesPending(session.scenes, settings)) return 'Generate keyframes';
    if (settings?.stillsFirst !== false && !session.scenes.some((scene) => scene.asVideo)) return 'Make the animatic';
    if (session.scenes.some((scene) => scene.asVideo) && session.scenes.some((scene) => !scene.asVideo)) return 'Make the film';
    return 'Generate video';
}

function syncBudgetCap(settings) {
    settings.budgetCap = settings.budgetMode === 'length' ? 0 : audToUsd(settings.budgetCapAud);
}

function planInput(settings, { lockQuality = false, derive = false, useScenes = true } = {}) {
    const image = findImageModel(settings.imageModel);
    return {
        mode: settings.budgetMode === 'length' ? 'length' : 'cap',
        capAud: Number(settings.budgetCapAud) || 0,
        targetSeconds: Number(settings.targetSeconds) || 70,
        providerId: settings.provider,
        providerLabel: getProvider(settings.provider)?.label || settings.provider,
        quality: lockQuality ? settings.quality : settings.quality,
        lockQuality,
        derive,
        sceneCount: Number(settings.sceneCount) || 0,
        secondsPerScene: Number(settings.secondsPerScene) || 5,
        messageCount: selectedMessages().length,
        stillsFirst: settings.stillsFirst !== false,
        imagesOnly: wantsImages(settings),
        stillUsdEach: image?.usd,
        spentUsd: ledgerTotal(settings.spentLedger),
        xaiModel: settings.xaiModel,
        falModel: settings.falModel,
        replicateModel: settings.replicateModel,
        openrouterVideoModel: settings.openrouterVideoModel,
        resolution: settings.resolution,
        modelInfo: session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel),
        customPerSecond: settings.custom?.costPerSecond,
        scenes: useScenes ? scenesForPlan(settings) : undefined,
    };
}

function scenesForPlan(settings) {
    if (!session.scenes.length) return undefined;
    return session.scenes.map((scene, index) => {
        const tuned = settingsForScene(settings, scene);
        const stillKey = keyframeAssetKey({
            prompt: scene.keyframePrompt || scene.prompt || '',
            modelId: settings.imageModel,
            medium: projectMedium(settings),
        });
        const clipKey = clipIdentity(scene, tuned);
        return {
            index,
            seconds: Number(scene.duration) || Number(settings.secondsPerScene) || 5,
            asVideo: Boolean(scene.asVideo),
            quality: scene.quality || '',
            cachedStill: Boolean(scene.keyframeDataUrl && scene.keyframeHash && scene.keyframeHash === stillKey),
            cachedClip: Boolean(scene.clipHash && scene.clipHash === clipKey && session.clipCache[clipKey]),
            stills: (scene.cast || []).length > 1 ? scene.cast.length + 1 : 1,
        };
    });
}

function settingsForScene(settings, scene) {
    if (!scene?.quality || scene.quality === settings.quality || !getQualityPreset(scene.quality)) return settings;
    const copy = { ...settings };
    applyQualityPreset(copy, scene.quality);
    return copy;
}

function clipIdentity(scene, settings) {
    return clipAssetKey({
        prompt: [styleLockText(settings), scene.prompt, scene.camera, scene.keyframeAdjust].filter(Boolean).join('\n'),
        provider: settings.provider,
        modelId: activeModelId(settings),
        resolution: settings.resolution,
        fps: settings.fps,
        seconds: Number(scene.duration) || Number(settings.secondsPerScene) || 5,
        quality: scene.quality || settings.quality,
        stillKey: scene.keyframeHash || '',
    });
}

function applyBudgetFit({ lockQuality = false } = {}) {
    const settings = liveSettings();
    if (!settings) return null;
    syncBudgetCap(settings);
    const plan = fitPlan(planInput(settings, { lockQuality, derive: true, useScenes: false }));
    if (!lockQuality && plan.quality && settings.quality !== 'custom' && settings.quality !== 'max') {
        applyQualityPreset(settings, plan.quality);
    }
    settings.sceneCount = plan.sceneCount;
    settings.secondsPerScene = plan.secondsPerScene;
    saveSettings(ctx());
    syncSettingsForm();
    renderChrome();
    return plan;
}

function updateCost() {
    const settings = liveSettings();
    if (!settings || !session.root) return;
    syncBudgetCap(settings);
    const priced = fitPlan(planInput(settings, { lockQuality: true, derive: !session.scenes.length, useScenes: session.scenes.length > 0 }));
    session.quote = priced;
    text('stsv-cost', priced.compact || priced.summary);
    const running = runningTotal(priced, settings);
    const detail = [
        priced.known && priced.stillUsd != null ? `Stills ${formatAud(priced.stillUsd)}.` : '',
        priced.known && priced.videoUsd != null && !wantsImages(settings) ? `Video ${formatAud(priced.videoUsd)}.` : '',
        priced.note || '',
        running,
        priced.known ? '' : 'This step has no stored price yet.',
    ].filter(Boolean).join(' ');
    text('stsv-cost-note', detail);
    text('stsv-video-total', session.scenes.length ? running : '');
}

function runningTotal(plan, settings) {
    if (!session.scenes.length || plan.usd == null) return '';
    const spent = formatAud((plan.spentUsd || 0) + plan.usd);
    if (settings.budgetMode === 'length' || !Number(settings.budgetCapAud)) return `Running total ${spent}.`;
    return `Running total ${spent} of $${Number(settings.budgetCapAud).toFixed(2)} AUD.`;
}

function renderStatus() {
    const error = session.root?.querySelector('#stsv-error');
    const status = session.root?.querySelector('#stsv-status');
    const banner = session.root?.querySelector('#stsv-banner');
    if (!error || !status) return;
    const message = session.banner || session.error || '';
    error.hidden = true;
    error.textContent = '';
    if (banner) {
        banner.hidden = !message;
        banner.textContent = message;
    }
    const elapsed = session.running && session.startedAt
        ? ` · ${Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000))}s`
        : '';
    const stage = session.running ? `${jobButtonLabel(session.phase).replace(/…$/, '')}${elapsed}` : '';
    status.textContent = [stage, session.status].filter(Boolean).join(' — ');
    status.title = status.textContent;
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
            <input type="checkbox" id="stsv-pick-${message.id}" name="stsv-pick-${message.id}" data-id="${message.id}" ${session.selected.has(message.id) ? 'checked' : ''}>
            <span class="stsv-message-id">#${message.id}</span>
            <span class="stsv-message-name">${escapeHtml(message.name)}</span>
            <span class="stsv-message-text">${escapeHtml(previewText(message.text))}</span>
        </label>
    `).join('');
    fillRange(messages);
    nameFields(list);
    renderRoster();
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
    renderBeats();
    updateCost();
}

function renderRoster() {
    const host = session.root?.querySelector('#stsv-roster');
    if (!host) return;
    const context = ctx();
    const cast = collectCast(context);
    if (!cast.group) {
        host.hidden = true;
        host.innerHTML = '';
        return;
    }
    const selected = new Set(selectedMessages().map((message) => message.name.toLowerCase()));
    const voices = sillyTavernVoices(context);
    const people = [
        { name: cast.user.name, note: 'Persona', voice: voiceFor(cast.user.name, voices) },
        ...cast.characters.map((character) => {
            let note = 'In the group';
            if (character.guest) note = 'Spoke earlier, not in the group now';
            else if (character.muted && selected.has(character.name.toLowerCase())) note = 'Muted, and these messages are theirs';
            else if (character.muted) note = 'Muted';
            else if (selected.has(character.name.toLowerCase())) note = 'Speaking in the selection';
            return { name: character.name, note, voice: voiceFor(character.name, voices) };
        }),
    ];
    host.hidden = false;
    host.innerHTML = `
        <p class="stsv-hint">${escapeHtml(cast.groupName || 'Group chat')}: each member keeps their own board, wardrobe, and voice. A muted member is left out of new shots unless you selected a line they already said. Someone who joins later only appears in the scenes that contain their lines.</p>
        <ul>${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong> <span>${escapeHtml(person.note)}</span>${person.voice ? ` <span>Voice ${escapeHtml(person.voice)}</span>` : ''}</li>`).join('')}</ul>
    `;
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
                    <button type="button" data-act="split">Split</button>
                    <button type="button" data-act="merge" ${index === session.scenes.length - 1 ? 'disabled' : ''}>Merge next</button>
                    <button type="button" data-act="delete">Delete</button>
                </span>
            </header>
            <p class="stsv-speakers">${(scene.lines || []).map((line) => `<span>${escapeHtml(line.speaker)}</span>`).join('') || '<span>No speakers yet</span>'}</p>
            <label>Title <input id="stsv-title-${index}" name="stsv-title-${index}" data-field="title" value="${escapeAttr(scene.title)}"></label>
            <label>Dialogue <textarea id="stsv-dialogue-${index}" name="stsv-dialogue-${index}" data-field="dialogue" rows="3">${escapeHtml(scene.dialogue || '')}</textarea></label>
            <label>Visual prompt <textarea id="stsv-prompt-${index}" name="stsv-prompt-${index}" data-field="prompt" rows="4">${escapeHtml(scene.prompt)}</textarea></label>
            <label>Shot <select id="stsv-shot-type-${index}" name="stsv-shot-type-${index}" data-field="shotType">${SHOT_TYPES.map((item) => `<option value="${item.id}" ${scene.shotType === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
            <label>Move <select id="stsv-camera-move-${index}" name="stsv-camera-move-${index}" data-field="cameraMove">${CAMERA_MOVES.map((item) => `<option value="${item.id}" ${scene.cameraMove === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}</select></label>
            <label>Camera <input id="stsv-camera-${index}" name="stsv-camera-${index}" data-field="camera" value="${escapeAttr(scene.camera)}"></label>
            <label>Negative <input id="stsv-negative-${index}" name="stsv-negative-${index}" data-field="negative_prompt" value="${escapeAttr(scene.negative_prompt)}"></label>
            <label>Seconds <input id="stsv-seconds-${index}" name="stsv-seconds-${index}" data-field="duration" type="number" min="1" max="15" step="1" value="${Number(scene.duration) || 5}"></label>
            <label class="stsv-video-pick">
                <input id="stsv-video-${index}" name="stsv-video-${index}" data-field="asVideo" type="checkbox" ${scene.asVideo ? 'checked' : ''}>
                Turn into video
                <span class="stsv-scene-cost">${escapeHtml(sceneLine(index))}</span>
            </label>
            <label>This scene's look
                <select id="stsv-scene-quality-${index}" name="stsv-scene-quality-${index}" data-field="quality">
                    <option value="" ${scene.quality ? '' : 'selected'}>Same as the film</option>
                    <option value="draft" ${scene.quality === 'draft' ? 'selected' : ''}>Draft</option>
                    <option value="standard" ${scene.quality === 'standard' ? 'selected' : ''}>Standard</option>
                    <option value="showcase" ${scene.quality === 'showcase' ? 'selected' : ''}>Showcase</option>
                </select>
            </label>
            <p class="stsv-hint">A higher look redoes only this scene. The others stay as they are.</p>
            ${keyframeReview(scene, index)}
        </article>
    `).join('');
}

function keyframeReview(scene, index) {
    const settings = liveSettings();
    const records = Object.values(ensureLibrary(settings).records);
    const composed = scene.keyframePrompt || composeKeyframePrompt({ scene, settings, records, proposals: session.proposals });
    const mockCard = Boolean(scene.keyframeDataUrl) && (scene.keyframeMock === true || (scene.keyframeMock !== false && settings?.imageModel === 'mock'));
    const preview = scene.keyframeDataUrl
        ? `<img class="stsv-keyframe-still" src="${escapeAttr(scene.keyframeDataUrl)}" alt="${mockCard ? 'Mock text card for scene' : 'Keyframe for scene'} ${index + 1}">`
        : '<div class="stsv-keyframe-empty">No keyframe yet. Generate stills, compare them with the references, then approve. Video stays off until then.</div>';
    const mockHint = mockCard
        ? '<p class="stsv-hint">This is a mock text card of the prompt, not a generated picture. Choose an image model under Cast and look before a paid video.</p>'
        : '';
    return `
        <section class="stsv-keyframe">
            <div>${preview}</div>
            <div>
                <p class="stsv-hint">References for this shot</p>
                <div class="stsv-keyframe-refs">${referenceThumbs(scene, records)}</div>
            </div>
            ${mockHint}
            <p class="stsv-hint">Prompt for this still</p>
            <p class="stsv-keyframe-prompt">${escapeHtml(composed)}</p>
            <label>Adjust prompt
                <input id="stsv-adjust-${index}" name="stsv-adjust-${index}" data-field="keyframeAdjust" type="text" value="${escapeAttr(scene.keyframeAdjust || '')}" placeholder="e.g. visibly older, 50s">
            </label>
            <div class="stsv-row">
                <button type="button" data-act="redo-keyframe">Redo</button>
                <button type="button" data-act="download-still" ${scene.keyframeDataUrl ? '' : 'disabled'}>Download</button>
                <button type="button" data-act="approve-keyframe" ${scene.keyframeDataUrl ? '' : 'disabled'}>${scene.keyframeApproved ? 'Approved' : 'Approve keyframe'}</button>
                <button type="button" data-act="redo-clip" ${scene.clipFile || scene.clipHash ? '' : 'disabled'}>Redo clip</button>
            </div>
        </section>
    `;
}

function referenceThumbs(scene, records) {
    const members = scene.cast || [];
    if (!members.length) return '<p class="stsv-empty">No one is assigned to this shot yet.</p>';
    return members.map((member) => {
        const record = records.find((item) => item.key === member.key);
        const board = record?.images?.find((image) => image.id === record.primaryId) || record?.images?.[0];
        const src = scene.memberStills?.[member.key] || board?.dataUrl || board?.url || '';
        const label = member.name || record?.name || 'Reference';
        const picture = src
            ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(label)} reference">`
            : '<div class="stsv-ph">No still</div>';
        return `<figure>${picture}<figcaption>${escapeHtml(label)}</figcaption></figure>`;
    }).join('');
}

function onShotInput(event) {
    const card = event.target.closest('[data-scene]');
    if (!card) return;
    const scene = session.scenes[Number(card.dataset.scene)];
    const field = event.target.dataset.field;
    if (!scene || !field) return;
    if (event.target.type === 'checkbox') scene[field] = event.target.checked;
    else scene[field] = field === 'duration' ? Number(event.target.value) || 1 : event.target.value;
    if (field === 'quality') {
        scene.clipHash = '';
        scene.clipFile = '';
    }
    if (field === 'dialogue') scene.lines = linesFromDialogue(scene.dialogue, scene.characters?.[0] || '');
    if (field === 'prompt' || field === 'keyframeAdjust') {
        scene.keyframeApproved = false;
        scene.keyframePrompt = '';
    }
    persistSession();
    if (field === 'duration' || field === 'asVideo' || field === 'quality') {
        updateCost();
        const cost = card.querySelector('.stsv-scene-cost');
        if (cost) cost.textContent = sceneLine(Number(card.dataset.scene));
        const generate = session.root?.querySelector('#stsv-generate');
        if (generate) generate.textContent = generateLabel(liveSettings());
    }
    if (field === 'prompt' || field === 'keyframeAdjust') {
        const button = session.root?.querySelector('#stsv-generate');
        if (button) button.textContent = generateLabel(liveSettings());
    }
}

function sceneLine(index) {
    return session.quote?.lines?.[index]?.label || '';
}

function syncBeats(force = false) {
    const settings = liveSettings();
    const messages = selectedMessages();
    if (!settings || settings.beatLength === 'full' || messages.length <= 4) {
        if (force || !session.beatsDirty) session.beats = [];
        return;
    }
    if (force || !session.beatsDirty) session.beats = condenseBeats(messages, settings.beatLength || 'medium');
}

function renderBeats() {
    const host = session.root?.querySelector('#stsv-beats');
    if (!host) return;
    syncBeats(false);
    if (!session.beats.length) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = `
        <p class="stsv-hint">Edit the beats, then write the shots. Make my video uses this list without another pause.</p>
        ${session.beats.map((beat, index) => `
            <label class="stsv-beat">Beat ${index + 1}
                <textarea id="stsv-beat-${index}" name="stsv-beat-${index}" data-beat="${index}" rows="2">${escapeHtml(beat.text || '')}</textarea>
            </label>
        `).join('')}
    `;
}

function onBeatInput(event) {
    const index = Number(event.target.dataset.beat);
    if (!Number.isFinite(index) || !session.beats[index]) return;
    session.beats[index].text = event.target.value;
    session.beatsDirty = true;
    session.beatsArmed = false;
}

function shotSource(messages) {
    const settings = liveSettings();
    if (settings?.beatLength !== 'full' && messages.length > 4) {
        if (!session.beats.length || !session.beatsDirty) session.beats = condenseBeats(messages, settings.beatLength || 'medium');
        return beatsToMessages(session.beats);
    }
    return messages;
}

function onShotClick(event) {
    const button = event.target.closest('[data-act]');
    if (!button) return;
    const index = Number(button.closest('[data-scene]')?.dataset.scene);
    if (!Number.isFinite(index)) return;
    if (button.dataset.act === 'delete') session.scenes.splice(index, 1);
    if (button.dataset.act === 'split') {
        const [left, right] = splitScene(session.scenes[index]);
        session.scenes.splice(index, 1, left, right);
    }
    if (button.dataset.act === 'merge' && index < session.scenes.length - 1) {
        const merged = mergeScenes(session.scenes[index], session.scenes[index + 1]);
        session.scenes.splice(index, 2, merged);
    }
    if (button.dataset.act === 'up' && index > 0) swap(index, index - 1);
    if (button.dataset.act === 'down' && index < session.scenes.length - 1) swap(index, index + 1);
    if (button.dataset.act === 'redo-keyframe') {
        redoKeyframe(index);
        return;
    }
    if (button.dataset.act === 'download-still') {
        downloadStill(index);
        return;
    }
    if (button.dataset.act === 'redo-clip') {
        const scene = session.scenes[index];
        if (!scene) return;
        scene.clipHash = '';
        scene.clipFile = '';
        session.status = 'This clip will film again the next time you generate. Nothing was sent.';
        session.error = '';
        persistSession();
        renderShots();
        renderChrome();
        return;
    }
    if (button.dataset.act === 'approve-keyframe') {
        const scene = session.scenes[index];
        if (!scene?.keyframeDataUrl) return fail('Generate the keyframe before approving it.');
        scene.keyframeApproved = true;
        session.status = keyframesPending(session.scenes, liveSettings())
            ? 'Approve the remaining keyframes. Video stays off until then.'
            : 'Keyframes approved. Generate video when you are ready.';
        session.error = '';
        persistSession();
        renderShots();
        renderChrome();
        return;
    }
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

function filmingCast(messages) {
    const full = collectCast(ctx());
    const filming = castForMessages(full, messages);
    const included = new Set(filming.characters.map((character) => character.name));
    return {
        ...filming,
        muted: full.characters.filter((character) => character.muted && !included.has(character.name)),
    };
}

function settleScenes(scenes) {
    const context = ctx();
    const settings = liveSettings();
    syncCastBoards();
    const library = ensureLibrary(settings);
    const persona = chatPersona(context, session.personaId);
    const board = resolvePersonaBoard(library, persona);
    const tracked = trackOutfits(scenes, Object.values(library.records), {
        persona: board ? { id: persona.id, name: persona.name, boardKey: board.key } : null,
        userName: context?.name1 || persona?.name || '',
    });
    session.proposals = tracked.proposals;
    const placed = attachPlaces(tracked.scenes, library);
    session.scenes = placed;
    saveSettings(context);
    return placed;
}

async function writeShots() {
    if (session.running) return;
    const settings = liveSettings();
    const messages = selectedMessages();
    if (!messages.length) return fail('Select at least one message.');
    if (settings.beatLength !== 'full' && messages.length > 4 && !session.beatsArmed) {
        syncBeats(!session.beatsDirty);
        session.beatsArmed = true;
        renderBeats();
        session.status = 'Edit the beats, then click Write the shots.';
        session.error = '';
        showStep('select');
        renderChrome();
        return;
    }
    session.beatsArmed = false;
    applyBudgetFit({ lockQuality: settings.quality === 'custom' || settings.quality === 'max' });
    const source = shotSource(selectedMessages());
    session.running = true;
    session.controller = new AbortController();
    session.error = '';
    session.status = 'Writing the shot list…';
    renderChrome();
    try {
        const library = ensureLibrary(settings);
        const result = await generateShotList({
            messages: source,
            cast: filmingCast(messages),
            settings,
            signal: session.controller.signal,
            hasReferenceImage: Boolean(session.imageDataUrl),
            wardrobeText: wardrobeSummary(Object.values(library.records).filter((record) => record.kind === 'character' || record.kind === 'persona').map((record) => ({ record, label: record.name }))),
        });
        settleScenes(result.scenes);
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
    applyBudgetFit({ lockQuality: liveSettings()?.quality === 'custom' || liveSettings()?.quality === 'max' });
    settleScenes(localShotList(messages, liveSettings()));
    session.shotNote = 'Local split, not a model. The prompts quote the chat. Edit them before you generate.';
    session.error = '';
    persistSession();
    renderShots();
    renderChrome();
}

async function memberReferenceUrls(member, record, records) {
    const medium = projectMedium(liveSettings());
    const urls = [];
    for (const source of [record, ...familyReferences(record, records)].filter(Boolean)) {
        const outfitId = source === record ? (member?.outfitId || '') : '';
        for (const image of imagesForPrompt(source, { outfitId, cap: 2, medium })) {
            const url = await materializeImage(image);
            if (url && !urls.includes(url)) urls.push(url);
        }
    }
    return urls.slice(0, 4);
}

async function sceneReferenceUrls(scene, records) {
    const urls = [];
    for (const member of scene.cast || []) {
        const still = scene.memberStills?.[member.key];
        if (still && !urls.includes(still)) urls.push(still);
    }
    for (const member of scene.cast || []) {
        if (urls.length >= 4) break;
        const record = records.find((item) => item.key === member.key);
        const image = imagesForPrompt(record, { outfitId: member.outfitId || '', cap: 1, medium: projectMedium(liveSettings()) })[0];
        const url = await materializeImage(image);
        if (url && !urls.includes(url)) urls.push(url);
    }
    return urls.slice(0, 4);
}

async function prepareKeyframePass(target, pass, records, settings, medium) {
    const { scene, index } = target;
    if (pass.kind === 'member') {
        const record = records.find((item) => item.key === pass.key);
        const member = (scene.cast || []).find((item) => item.key === pass.key) || { key: pass.key, name: pass.name, outfitId: pass.outfitId };
        const prompt = memberStillPrompt(member, record, outfitById(record, pass.outfitId), settings);
        const referenceImages = await memberReferenceUrls(member, record, records);
        const key = stillAssetKey({ prompt, modelId: settings.imageModel, medium, references: referenceImages });
        return {
            index,
            pass,
            key,
            cached: Boolean(scene.memberStills?.[pass.key] && scene.memberStillHashes?.[pass.key] === key),
            request: {
                prompt,
                referenceImages,
                label: pass.name || 'Outfit',
                settings,
                modelId: settings.imageModel,
            },
        };
    }
    const prompt = composeKeyframePrompt({ scene, settings, records, proposals: session.proposals });
    const referenceImages = await sceneReferenceUrls(scene, records);
    const key = keyframeAssetKey({
        prompt,
        modelId: settings.imageModel,
        medium: `${medium}|${stillAssetKey({ references: referenceImages })}`,
    });
    return {
        index,
        pass,
        key,
        cached: Boolean(scene.keyframeDataUrl && scene.keyframeHash === key),
        request: {
            prompt,
            referenceImages,
            label: scene.title || `Scene ${index + 1}`,
            settings,
            modelId: settings.imageModel,
        },
    };
}

async function paintStill(request) {
    try {
        return await generateReferenceImage(request);
    } catch (error) {
        const explained = explainError(error?.message);
        const wrapped = new Error(`${explained.plain} ${explained.fix}`.trim());
        wrapped.banner = Boolean(explained.banner);
        wrapped.cause = error;
        throw wrapped;
    }
}

async function generateKeyframes({ onlyIndex = null, owned = false } = {}) {
    if (session.running && !owned) return false;
    const settings = liveSettings();
    if (!settings) return false;
    const release = bindJob('keyframe', owned);
    if (!release) return false;
    try {
        const targets = session.scenes
            .map((scene, index) => ({ scene, index }))
            .filter(({ scene, index }) => (onlyIndex == null ? !(scene.keyframeApproved && scene.keyframeDataUrl) : index === onlyIndex));
        if (!targets.length) return true;
        const records = Object.values(ensureLibrary(settings).records);
        const medium = projectMedium(settings);
        const planned = [];
        for (const target of targets) {
            for (const pass of planKeyframeJob(target.scene, records)) {
                const prepared = await prepareKeyframePass(target, pass, records, settings, medium);
                planned.push(prepared);
            }
        }
        const missing = planned.filter((item) => !item.cached);
        const cost = missing.length ? stillCost(missing.length, settings.imageModel) : { usd: 0, label: 'cached, $0', note: 'cached, $0' };
        if (missing.length && !(await confirmSpend(cost, 'Keyframe stills'))) return false;
        if (!missing.length) {
            for (const { scene } of targets) {
                if (scene.keyframeDataUrl) scene.keyframeMock = settings.imageModel === 'mock';
            }
            session.status = 'Keyframes are cached, $0. Next: approve the still, then Make the animatic.';
            showStep('story');
            renderStatus();
            return false;
        }
        if (!session.controller) session.controller = new AbortController();
        session.error = '';
        showStep('story');
        renderChrome();
        for (const { scene, index } of targets) {
            if (session.controller.signal.aborted) throw abortError();
            scene.keyframeApproved = false;
            scene.memberStills = { ...(scene.memberStills || {}) };
            scene.memberStillHashes = { ...(scene.memberStillHashes || {}) };
            for (const item of planned.filter((entry) => entry.index === index && entry.pass.kind === 'member')) {
                if (item.cached) continue;
                if (session.controller.signal.aborted) throw abortError();
                session.status = `Outfit still for ${item.pass.name || 'a character'} before the group keyframe…`;
                renderStatus();
                scene.memberStills[item.pass.key] = await paintStill({ ...item.request, signal: session.controller.signal });
                scene.memberStillHashes[item.pass.key] = item.key;
                settings.assetCache = rememberAsset(settings.assetCache, item.key, 'outfit');
                session.stillCache[item.key] = scene.memberStills[item.pass.key];
                if (settings.imageModel !== 'mock') {
                    await storeStillOnChat(scene, scene.memberStills[item.pass.key], {
                        filename: `thoughtform-${item.pass.name || 'outfit'}-still`,
                        memberKey: item.pass.key,
                    });
                }
                renderShots();
            }
            const scenePass = planned.find((entry) => entry.index === index && entry.pass.kind !== 'member');
            if (scenePass?.cached) {
                scene.keyframePrompt = scenePass.request.prompt;
            } else if (scenePass) {
                scene.keyframePrompt = scenePass.request.prompt;
                session.status = `Keyframe for scene ${index + 1}…`;
                renderStatus();
                scene.keyframeDataUrl = await paintStill({ ...scenePass.request, signal: session.controller.signal });
                scene.keyframeHash = scenePass.key;
                settings.assetCache = rememberAsset(settings.assetCache, scenePass.key, 'keyframe');
                session.stillCache[scenePass.key] = scene.keyframeDataUrl;
            }
            if (scene.keyframeDataUrl) scene.keyframeMock = settings.imageModel === 'mock';
            if (scene.keyframeDataUrl && scene.keyframeMock !== true) {
                await storeStillOnChat(scene, scene.keyframeDataUrl, {
                    filename: `thoughtform-scene-${index + 1}-still`,
                });
            }
            scene.keyframeApproved = false;
            renderShots();
        }
        if (cost.usd) {
            settings.spentLedger = recordSpend(settings.spentLedger, { usd: cost.usd, label: 'Keyframe stills' });
            saveSettings(ctx());
        }
        const mock = targets.some(({ scene }) => scene.keyframeDataUrl && scene.keyframeMock);
        const next = ' Next: approve the still, then Make the animatic.';
        session.status = mock
            ? `Review the keyframes. This is a mock text card of the prompt, not a generated picture. Choose an image model under Cast and look before a paid video.${next}`
            : `Review the keyframes. Video does not start until you approve each still.${next}`;
        session.error = '';
        session.banner = '';
        persistSession();
        return false;
    } catch (error) {
        postError(error);
        session.status = '';
        persistSession();
        return false;
    } finally {
        release();
        renderShots();
        renderChrome();
    }
}

async function redoKeyframe(index) {
    const scene = session.scenes[index];
    if (!scene || session.running) return;
    scene.keyframeApproved = false;
    scene.keyframeDataUrl = '';
    scene.keyframePrompt = '';
    await generateKeyframes({ onlyIndex: index });
}

async function generateVideo({ owned = false } = {}) {
    if (session.running && !owned) return;
    const settings = liveSettings();
    if (!settings) return fail('SillyTavern settings are not available.');
    if (!session.scenes.length) return fail('Write a shot list, or use the local split, before generating.');
    const empty = session.scenes.findIndex((scene) => !String(scene.prompt || '').trim());
    if (empty >= 0) return fail(`Scene ${empty + 1} has an empty prompt.`);
    const release = bindJob(
        wantsImages(settings) || keyframesPending(session.scenes, settings) ? 'keyframe' : 'video',
        owned,
    );
    if (!release) return;
    try {
    if (wantsImages(settings)) {
        await generateKeyframes({ owned: true });
        finishImages();
        await attachReadyStills();
        return;
    }
    if (keyframesPending(session.scenes, settings)) {
        await generateKeyframes({ owned: true });
        return;
    }
    jobs.hold('video', { owned: true });
    syncJob();
    renderChrome();
    if (settings.stillsFirst !== false && !session.scenes.some((scene) => scene.asVideo)) {
        await runAnimatic({ owned: true });
        return;
    }
    const provider = getProvider(settings.provider);
    if (!session.controller) session.controller = new AbortController();
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
            const tuned = settingsForScene(settings, scene);
            session.jobs[index].state = 'running';
            session.jobs[index].message = 'Starting';
            renderJobs();
            if (!scene.asVideo && settings.stillsFirst !== false) {
                session.jobs[index].message = 'Moving still';
                renderJobs();
                const blob = await recordAnimatic(planAnimatic([scene]), {
                    signal: session.controller.signal,
                    onProgress: (info) => {
                        session.status = info?.message || session.status;
                        renderStatus();
                    },
                });
                clips.push({
                    blob,
                    duration: Number(blob.recordedSeconds) || Number(scene.duration) || Number(settings.secondsPerScene) || 5,
                });
                session.clips = clips.map((clip) => clip.blob);
                await storeClipOnChat(scene, blob, index);
                session.jobs[index].state = 'done';
                session.jobs[index].message = 'Moving still';
                renderJobs();
                continue;
            }
            const identity = clipIdentity(scene, tuned);
            if (scene.clipFile && scene.clipHash && scene.clipHash !== identity) scene.clipFile = '';
            let cachedBlob = session.clipCache[identity] || null;
            if (!cachedBlob && scene.clipFile && scene.clipHash === identity) {
                cachedBlob = await fetchStoredBlob(scene.clipFile);
                if (cachedBlob) session.clipCache[identity] = cachedBlob;
            }
            if (cachedBlob) {
                const blob = cachedBlob;
                clips.push({
                    blob,
                    duration: Number(blob.recordedSeconds) || Number(scene.duration) || Number(settings.secondsPerScene) || 5,
                });
                session.clips = clips.map((clip) => clip.blob);
                scene.clipHash = identity;
                if (!scene.clipFile) await storeClipOnChat(scene, blob, index);
                session.jobs[index].state = 'done';
                session.jobs[index].message = scene.clipFile ? 'saved file, $0' : 'cached, $0';
                renderJobs();
                continue;
            }
            if (scene.clipFile && scene.clipHash === identity) {
                session.jobs[index].state = 'done';
                session.jobs[index].message = 'Saved on the message. Click Redo clip to film it again.';
                renderJobs();
                continue;
            }
            const sceneQuote = estimateCost({
                providerId: tuned.provider,
                modelId: activeModelId(tuned),
                resolution: tuned.resolution,
                seconds: Number(scene.duration) || Number(tuned.secondsPerScene) || 5,
                sceneCount: 1,
                modelInfo: session.openRouterModels?.find((model) => model.id === tuned.openrouterVideoModel),
                customPerSecond: tuned.custom?.costPerSecond,
                imageInputs: (scene.keyframeDataUrl || session.imageDataUrl) ? 1 : 0,
            });
            if (!(await confirmSpend(sceneQuote, `Scene ${index + 1}`))) {
                session.jobs[index].state = 'error';
                session.jobs[index].message = 'Stopped';
                renderJobs();
                break;
            }
            const records = Object.values(ensureLibrary(settings).records);
            const referenceUrls = [];
            for (const image of collectReferenceImages(scene, records, { medium: projectMedium(settings) })) {
                const url = await materializeImage(image);
                if (url) referenceUrls.push(url);
            }
            const call = buildVideoCall({
                scene,
                settings: tuned,
                records,
                proposals: session.proposals,
                providerId: provider.id,
                modelId: activeModelId(tuned),
                index,
                manualStill: session.imageDataUrl,
                referenceUrls,
            });
            const started = Date.now();
            if (call.note && /mock text card|was text/.test(call.note)) {
                session.status = call.note;
                renderStatus();
            }
            debugLog({
                provider: provider.id,
                message: `${scene.title || `Scene ${index + 1}`} request`,
                detail: `${call.note || ''} ${call.prompt}`.slice(0, 500),
            });
            const blob = await provider.generate({
                prompt: call.prompt,
                negativePrompt: call.negativePrompt,
                duration: call.duration || Number(scene.duration) || Number(tuned.secondsPerScene) || 5,
                aspectRatio: tuned.aspectRatio,
                resolution: tuned.resolution,
                fps: Number(tuned.fps) || 24,
                steps: Number(tuned.steps) || 20,
                seed: call.seed,
                imageDataUrl: provider.supportsImage ? call.imageDataUrl : '',
                referenceImages: call.referenceImages,
                disableSafetyChecker: Boolean(settings.disableSafetyChecker),
                generateAudio: Boolean(tuned.generateAudio),
                modelId: activeModelId(tuned),
                modelInfo: session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel),
                settings: tuned,
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
            debugLog({ provider: provider.id, message: `${scene.title || `Scene ${index + 1}`} ready`, ms: Date.now() - started });
            clips.push({
                blob,
                duration: Number(blob.recordedSeconds) || Number(scene.duration) || Number(settings.secondsPerScene) || 5,
            });
            session.clips = clips.map((clip) => clip.blob);
            session.clipCache[identity] = blob;
            scene.clipHash = identity;
            await storeClipOnChat(scene, blob, index);
            settings.assetCache = rememberAsset(settings.assetCache, identity, 'clip');
            if (sceneQuote.usd) {
                settings.spentLedger = recordSpend(settings.spentLedger, { usd: sceneQuote.usd, label: scene.title || `Scene ${index + 1}` });
                saveSettings(ctx());
            }
            session.jobs[index].state = 'done';
            session.jobs[index].message = 'Clip ready';
            renderJobs();
        }
        if (!clips.length) {
            if (!session.error) session.error = 'Stopped so the spend stays inside your budget.';
            session.status = '';
            return;
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
        session.status = session.error ? 'Stopped. Finished scenes are in the result.' : 'Video ready.';
        showStep('review');
        if (!session.error && session.resultBlob) await revealFinishedVideo('Video ready');
    } catch (error) {
        session.clips = clips.map((clip) => clip.blob);
        const explained = explainError(error?.message);
        if (!isAbortError(error) && (explained.banner || error?.banner)) {
            session.banner = `${explained.plain} ${explained.fix}`.trim();
            session.error = '';
            notifyError(session.banner);
        } else {
            session.banner = '';
            session.error = isAbortError(error)
                ? 'Cancelled. Any finished clips can be downloaded below.'
                : `${explained.plain} ${explained.fix}`;
            if (!isAbortError(error)) notifyError(session.error);
        }
        if (session.clips.length && !isAbortError(error)) {
            session.error = `${session.error} Finished clips can be downloaded below.`;
            showStep('review');
        }
        session.jobs.forEach((job) => {
            if (job.state === 'running' || job.state === 'waiting') {
                job.state = 'error';
                job.message = 'Stopped';
            }
        });
    } finally {
        session.remoteCancel = null;
        renderJobs();
        renderResult();
    }
    } catch (error) {
        if (!session.error) {
            const explained = explainError(error?.message);
            session.error = `${explained.plain} ${explained.fix}`.trim() || 'The job failed.';
            notifyError(session.error);
            renderStatus();
        }
    } finally {
        release();
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
    const view = session.root.querySelector('#stsv-view-result');
    if (view) view.hidden = !hasMovie;
    const canAttach = Boolean(session.resultBlob);
    session.root.querySelector('#stsv-download').hidden = !hasMovie;
    session.root.querySelector('#stsv-attach').hidden = !canAttach;
    session.root.querySelector('#stsv-attach-new').hidden = !canAttach;
    session.root.querySelector('#stsv-clips').innerHTML = session.clips.map((blob, index) => (
        `<button type="button" data-clip="${index}">Download clip ${index + 1}</button>`
    )).join('');
}

function rememberMovie(blob) {
    clearMovie();
    session.movieFile = '';
    session.resultBlob = blob;
    session.resultUrl = URL.createObjectURL(blob);
}

function clearMovie() {
    if (session.resultUrl) URL.revokeObjectURL(session.resultUrl);
    session.resultUrl = '';
    session.resultBlob = null;
}

function downloadStill(index) {
    const url = session.scenes[index]?.keyframeDataUrl;
    if (!url) return fail('Generate the still before downloading it.');
    const link = document.createElement('a');
    link.href = url;
    link.download = safeFileName(`scene-${index + 1}-still.jpg`);
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function downloadMovie() {
    if (session.resultBlob) {
        const ext = session.resultBlob.type?.includes('webm') ? 'webm' : 'mp4';
        downloadBlob(session.resultBlob, safeFileName(`thoughtform-${Date.now()}.${ext}`));
        return;
    }
    const href = session.movieFile ? fileSrc(session.movieFile) : session.resultUrl;
    if (!href) return;
    const link = document.createElement('a');
    link.href = href;
    link.download = safeFileName(`thoughtform-${Date.now()}.mp4`);
    document.body.appendChild(link);
    link.click();
    link.remove();
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
    const filename = `thoughtform-${Date.now()}.${ext}`;
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
        const stats = await checkComfy({ settings: liveSettings() });
        session.status = comfyHardwareNote(stats);
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

function showStep(step) {
    const next = step || 'select';
    session.step = next;
    session.root?.querySelectorAll('[data-step]').forEach((section) => {
        section.hidden = section.dataset.step !== next;
    });
    session.root?.querySelectorAll('[data-step-jump]').forEach((button) => {
        const on = button.dataset.stepJump === next;
        button.setAttribute('aria-current', on ? 'step' : 'false');
        button.classList.toggle('stsv-on', on);
    });
    if (next === 'cast') renderPeople();
    if (next === 'story') renderShots();
}

function syncCastBoards() {
    const context = ctx();
    const settings = liveSettings();
    if (!context || !settings) return;
    const library = ensureLibrary(settings);
    const cast = collectCast(context);
    const changed = syncLibrary(library, { characters: cast.characters, personas: listPersonas(context) });
    if (changed) saveSettings(context);
}

function renderPeople() {
    const host = session.root?.querySelector('#stsv-board');
    if (!host || session.step !== 'cast') return;
    const active = document.activeElement;
    const typing = active && host.contains(active) && (
        active.tagName === 'TEXTAREA'
        || (active.tagName === 'INPUT' && /^(text|number|search|password)$/i.test(active.type || ''))
    );
    if (typing) return;
    const open = new Set(session.openDetails || []);
    host.querySelectorAll('details[data-keep]').forEach((node) => {
        if (node.open) open.add(node.dataset.keep);
        else open.delete(node.dataset.keep);
    });
    session.openDetails = [...open];
    syncCastBoards();
    host.innerHTML = renderBoard(boardModel(boardEnv()));
}

function renderConnectionTests() {
    const host = session.root?.querySelector('#stsv-connection-tests');
    if (!host) return;
    host.innerHTML = providers.map((provider) => (
        `<button type="button" data-test-provider="${escapeAttr(provider.id)}">Test ${escapeHtml(provider.label)}</button>`
    )).join('');
}

function renderQueue() {
    const host = session.root?.querySelector('#stsv-queue');
    if (!host) return;
    session.queue = loadQueue();
    const jobs = resumableJobs(session.queue);
    if (!jobs.length) {
        host.innerHTML = '';
        return;
    }
    host.innerHTML = `<p class="stsv-hint">Jobs still polling after a reload</p>${jobs.map((job) => (
        `<button type="button" data-resume="${escapeAttr(job.id)}">Resume ${escapeHtml(job.title || job.provider || 'job')}</button>`
    )).join('')}`;
}

async function resumeStoredJob(id) {
    const job = session.queue.find((item) => item.id === id);
    if (!job) return;
    session.status = `Resuming ${job.title || job.provider}…`;
    renderStatus();
    try {
        const update = await pollJob(job, { fetchImpl: globalThis.fetch, sleep: () => Promise.resolve() });
        const next = { ...job, state: update.failed ? 'error' : (update.done ? 'done' : job.state), message: update.message || '' };
        session.queue = upsertJob(session.queue, next);
        saveQueue(session.queue);
        session.status = update.done ? 'The resumed job is ready.' : (update.message || 'Still running.');
        if (update.failed) session.error = update.message || 'The resumed job failed.';
    } catch (error) {
        session.error = error.message || 'Could not resume that job.';
    }
    renderQueue();
    renderStatus();
}

function renderDebug() {
    const list = session.root?.querySelector('#stsv-log');
    if (!list || !liveSettings()?.debug) return;
    const entries = recentLogs();
    list.innerHTML = entries.length
        ? entries.map((entry) => `<li><strong>${escapeHtml(entry.provider || entry.level)}</strong> ${escapeHtml(entry.message)}${entry.ms != null ? ` · ${entry.ms}ms` : ''}${entry.detail ? `<br>${escapeHtml(entry.detail)}` : ''}</li>`).join('')
        : '<li>No debug lines yet. Generate a shot or test a connection.</li>';
}

function boardEnv() {
    const context = () => ctx();
    const settings = () => liveSettings();
    return {
        library: () => ensureLibrary(settings()),
        settings,
        personas: () => listPersonas(context()),
        chatPersonaId: () => chatPersona(context(), session.personaId).id,
        characters: () => {
            const library = ensureLibrary(settings());
            const keys = new Set(collectCast(context()).characters.map((character) => characterRecordKey(character)));
            const personaKeys = new Set(listPersonas(context()).map((persona) => {
                const board = resolvePersonaBoard(library, persona);
                return board?.key || '';
            }));
            return Object.values(library.records).filter((record) => (
                record.kind === 'character' && (keys.has(record.key) || (record.sourceKey && (keys.has(record.sourceKey) || personaKeys.has(record.sourceKey))))
            ));
        },
        places: () => Object.values(ensureLibrary(settings()).records).filter((record) => record.kind === 'location' || record.kind === 'prop'),
        boardFor: (persona) => resolvePersonaBoard(ensureLibrary(settings()), persona),
        forms: () => session.forms,
        studio: () => session.studio,
        setStudio: (studio) => { session.studio = studio; },
        proposals: () => session.proposals,
        scenes: () => session.scenes,
        placeDraft: () => session.placeDraft,
        setPlaceDraft: (draft) => { session.placeDraft = draft; },
        setChatPersona: (id) => { session.personaId = id; persistSession(); },
        record: (key) => ensureLibrary(settings()).records[key],
        voiceFor: (name) => voiceFor(name, sillyTavernVoices(context())),
        styleLine: () => [styleLockText(settings()), styleLine(settings())].filter(Boolean).join('\n'),
        medium: () => projectMedium(settings()),
        signal: () => session.controller?.signal,
        headers: () => context()?.getRequestHeaders?.() || {},
        save: () => saveSettings(context()),
        persist: () => persistSession(),
        rerender: () => { renderPeople(); renderShots(); },
        activeName: () => ctx()?.name2 || '',
        focusKey: () => session.focusKey || '',
        setFocusKey: (key) => { session.focusKey = key || ''; },
        openDetails: () => session.openDetails || [],
        sillyContext: () => ctx(),
        toast: (message, title, onClick) => toastAction(title, message, onClick),
        note: (message) => { session.status = message; session.error = ''; session.banner = ''; renderStatus(); },
        fail: (message) => fail(message),
        banner: (explained) => {
            session.banner = `${explained?.plain || ''} ${explained?.fix || ''}`.trim();
            session.error = '';
            renderStatus();
            if (session.banner) notifyError(session.banner);
        },
        download: (name, text, type) => downloadText(name, text, type),
        confirmSpend: (cost, label) => confirmSpend(cost, label),
        charge: (usd, label) => {
            const current = settings();
            current.spentLedger = recordSpend(current.spentLedger, { usd, label });
            saveSettings(context());
            renderChrome();
        },
        quoteStill: (request) => {
            const current = settings();
            const key = stillAssetKey({
                prompt: request?.prompt,
                modelId: current.imageModel,
                medium: projectMedium(current),
                references: request?.referenceImages,
                aspectRatio: request?.aspectRatio || '',
            });
            const records = Object.values(ensureLibrary(current).records);
            const url = session.stillCache[key] || lookupAsset(records, key);
            if (url) return { usd: 0, label: 'cached, $0', note: 'cached, $0', cached: true, key, url };
            const cost = stillCost(1, current.imageModel);
            return { ...cost, cached: false, key, url: '' };
        },
        generateImage: async (request) => {
            const current = settings();
            const key = stillAssetKey({
                prompt: request?.prompt,
                modelId: current.imageModel,
                medium: projectMedium(current),
                references: request?.referenceImages,
                aspectRatio: request?.aspectRatio || '',
            });
            const records = Object.values(ensureLibrary(current).records);
            const cached = session.stillCache[key] || lookupAsset(records, key);
            if (cached) return cached;
            const url = await generateReferenceImage({
                ...request,
                settings: current,
                modelId: current.imageModel,
                signal: session.controller?.signal,
            });
            session.stillCache[key] = url;
            current.assetCache = rememberAsset(current.assetCache, key, 'still');
            saveSettings(context());
            return url;
        },
    };
}

async function confirmSpend(cost, label) {
    const settings = liveSettings();
    const gate = assessSpend({
        ledger: settings?.spentLedger,
        cap: Number(settings?.budgetCap) || 0,
        confirmAbove: Number(settings?.confirmAbove) || 0,
        estimateUsd: cost?.usd,
        known: cost?.usd != null,
    });
    if (gate.blocked) {
        const settingsNow = liveSettings();
        const proceed = window.confirm(overCapMessage({ projectedUsd: gate.projected, capAud: settingsNow?.budgetCapAud }));
        if (!proceed) {
            fail('Stopped so the spend stays inside your budget.');
            return false;
        }
        return true;
    }
    if (!gate.needsConfirm) return true;
    if (cost?.label === 'cached, $0' || cost?.usd === 0) return true;
    const price = cost?.quote || cost?.label || 'Price unknown';
    return window.confirm(`${label ? `${label}. ` : ''}${price}. Continue?`);
}

async function runAnimatic({ owned = false } = {}) {
    if (session.running && !owned) return;
    if (!session.scenes.length) return fail('Write a shot list before the animatic.');
    const release = bindJob('video', owned);
    if (!release) return;
    session.status = 'Recording the animatic…';
    session.error = '';
    renderStatus();
    try {
        const blob = await recordAnimatic(planAnimatic(session.scenes), { signal: session.controller?.signal });
        rememberMovie(blob);
        session.status = `Animatic ready. Captions are on the picture. Mood: ${moodForTheme(liveSettings()?.themeId)}. Speak dialogue plays the lines. Tick Turn into video for any scene you want as real video.`;
        session.banner = '';
        showStep('review');
        renderResult();
        if (session.resultBlob) await revealFinishedVideo('Animatic ready');
    } catch (error) {
        session.error = error.message || 'The animatic failed.';
        notifyError(session.error);
    } finally {
        release();
        renderStatus();
    }
}

function showFinish() {
    const settings = liveSettings();
    const plan = finishPlan({ preset: settings?.aspectRatio || '16:9', resolution: settings?.resolution || '720p' });
    session.status = plan.note;
    renderStatus();
}

function startNextEpisode() {
    const project = nextEpisode(ensureProject(session.project, session.chatKey));
    session.project = snapshotVersion(project, { scenes: session.scenes, note: continuityPrompt(project.continuity) });
    session.scenes = [];
    session.shotNote = `${session.project.title} keeps the outfits and places from the last version.`;
    persistSession();
    showStep('select');
    renderShots();
    renderStatus();
    session.status = session.shotNote;
    renderStatus();
}

function explainLipsync() {
    try {
        const request = buildLipsyncRequest(liveSettings()?.lipSyncModel, {
            videoUrl: session.resultUrl || 'https://example.invalid/scene.mp4',
            audioUrl: session.resultUrl || 'https://example.invalid/dialogue.wav',
        });
        session.status = `Lip-sync is prepared for ${request.endpoint}. It needs a video URL and an audio URL the host can fetch, so this button does not upload the chat.`;
        session.error = '';
    } catch (error) {
        session.error = error.message || 'Lip-sync is not ready.';
    }
    renderStatus();
}

async function makeVideo() {
    if (session.running) return;
    const release = bindJob('keyframe', false);
    if (!release) return;
    try {
        const settings = liveSettings();
        if (settings) settings.stillsFirst = settings.stillsFirst !== false;
        applyBudgetFit({ lockQuality: settings?.quality === 'custom' || settings?.quality === 'max' });
        const messages = listMessages(ctx()?.chat);
        if (!session.selected.size) setSelection(messages.map((message) => message.id));
        if (!selectedMessages().length) return fail('This chat has no text messages yet.');
        if (!session.scenes.length) {
            const chosen = selectedMessages();
            settleScenes(localShotList(shotSource(chosen), liveSettings()));
            session.shotNote = wantsImages(liveSettings())
                ? 'Stills from your saved budget and look. Video stays off.'
                : 'Shots from your saved budget and look. Approve each still before anything is filmed.';
            session.beatsArmed = false;
            persistSession();
        }
        showStep('story');
        await generateVideo({ owned: true });
    } catch (error) {
        if (!session.error) {
            session.error = error?.message || 'The job failed.';
            notifyError(session.error);
            renderStatus();
        }
    } finally {
        release();
    }
}

function finishImages() {
    if (session.error || /cached/i.test(session.status || '')) return;
    const mock = session.scenes.some((scene) => scene.keyframeDataUrl && scene.keyframeMock);
    session.status = mock
        ? 'Stills are ready. They are mock text cards of the prompt, not generated pictures. Choose an image model under Cast and look. Download any card from the storyboard. Video stays off.'
        : 'Stills are ready. Download any picture from the storyboard. Video stays off.';
    renderStatus();
}

async function pictureMoment(messageId) {
    if (session.running) return;
    openPanel();
    const release = bindJob('keyframe', false);
    if (!release) return;
    try {
        const messages = listMessages(ctx()?.chat);
        const message = messages.find((item) => item.id === messageId);
        if (!message) return fail('That message is no longer in the chat.');
        setSelection([message.id]);
        const settings = liveSettings() || {};
        settleScenes(localShotList([message], { ...settings, sceneCount: 1 }));
        session.shotNote = 'One still for this message.';
        session.beatsArmed = false;
        persistSession();
        showStep('story');
        await generateKeyframes({ owned: true });
        finishImages();
        const stillScene = session.scenes[0];
        const still = stillScene?.keyframeDataUrl;
        if (!still || session.error) return;
        try {
            if (!stillScene.keyframeFile) {
                await attachImageDataUrl(still, {
                    messageId,
                    filename: `scene-still-${Date.now()}`,
                    context: ctx(),
                });
            }
            toastReady('Stills ready', messageId);
        } catch {
            session.status = `${session.status} The still stays on the storyboard.`.trim();
            renderStatus();
        }
    } finally {
        release();
    }
}

async function testConnection(providerId) {
    const id = providerId || liveSettings()?.provider;
    session.status = `Testing ${id}…`;
    session.error = '';
    renderStatus();
    const started = Date.now();
    const result = await testProviderConnection(id, liveSettings());
    debugLog({
        level: result.ok ? 'info' : 'error',
        provider: id,
        message: result.message,
        detail: result.fix || '',
        ms: Date.now() - started,
    });
    if (result.ok) {
        session.status = result.message;
        session.error = '';
    } else {
        session.error = result.fix ? `${result.message} ${result.fix}` : result.message;
        session.status = '';
    }
    renderDebug();
    renderStatus();
}

async function copyDiagnostics() {
    const payload = buildDiagnostics({
        version: '1.0.0',
        settings: liveSettings(),
        extra: { groupId: ctx()?.groupId || '', step: session.step },
    });
    const text = JSON.stringify(payload, null, 2);
    try {
        await navigator.clipboard.writeText(text);
        session.status = 'Diagnostics copied. API keys are redacted.';
    } catch {
        session.status = 'Could not reach the clipboard.';
        session.error = text.slice(0, 500);
    }
    renderStatus();
}

async function speakLines() {
    const lines = dialogueLines(session.scenes);
    if (!lines.length) return fail('No dialogue lines to speak. Write a shot list first.');
    const settings = liveSettings();
    const voices = sillyTavernVoices(ctx());
    session.status = `Speaking ${lines.length} line${lines.length === 1 ? '' : 's'}…`;
    renderStatus();
    try {
        for (const line of lines) {
            const blob = await synthesizeLine({
                provider: settings.ttsProvider,
                text: line.text,
                voice: voiceFor(line.speaker, voices),
                settings,
            });
            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            await audio.play().catch(() => {});
            URL.revokeObjectURL(url);
        }
        session.status = `Spoke ${lines.map((line) => line.speaker).join(', ')}.`;
    } catch (error) {
        session.error = error.message || 'Speech failed.';
    }
    renderStatus();
}

function downloadText(name, text, type) {
    downloadBlob(new Blob([text], { type: type || 'text/plain' }), safeFileName(name));
}

function syncJob() {
    session.running = jobs.state.running;
    session.phase = jobs.state.phase;
    session.startedAt = jobs.state.startedAt;
}

function startClock() {
    stopClock();
    session.clock = setInterval(() => { renderStatus(); }, 1000);
}

function stopClock() {
    if (session.clock) clearInterval(session.clock);
    session.clock = null;
}

function bindJob(phase, owned) {
    const ok = jobs.hold(phase, { owned });
    syncJob();
    if (!ok) return null;
    if (!owned) {
        session.controller = new AbortController();
        session.error = '';
        startClock();
    }
    renderChrome();
    return () => {
        jobs.release({ owned });
        syncJob();
        if (!owned) {
            session.controller = null;
            session.remoteCancel = null;
            stopClock();
            renderChrome();
        }
    };
}

function notifyError(message) {
    const text = String(message || '').trim();
    if (!text) return;
    const toast = globalThis.toastr;
    if (typeof toast?.error !== 'function') return;
    try {
        toast.error(text, 'Thoughtform');
    } catch {
        /* Preview and unit tests have no toastr. */
    }
}

function toastAction(title, message, onClick) {
    const toast = globalThis.toastr;
    if (typeof toast?.success !== 'function') return;
    try {
        toast.success(message, title || 'Thoughtform', {
            timeOut: 15000,
            extendedTimeOut: 6000,
            escapeHtml: false,
            onclick() { onClick?.(); },
        });
    } catch {
        /* Preview and unit tests have no toastr. */
    }
}

function toastReady(title, messageId) {
    const toast = globalThis.toastr;
    if (typeof toast?.success !== 'function') return;
    try {
        toast.success(title, 'Thoughtform', {
            timeOut: 15000,
            extendedTimeOut: 6000,
            onclick() { revealInChat(messageId); },
        });
    } catch {
        /* Preview and unit tests have no toastr. */
    }
}

function revealInChat(messageId) {
    const target = messageId == null ? null : document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!target) {
        showStep('review');
        const result = session.root?.querySelector('#stsv-result');
        result?.classList.add('stsv-flash');
        session.root?.querySelector('#stsv-video')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => result?.classList.remove('stsv-flash'), 2600);
        return;
    }
    closePanel();
    target.classList.add('stsv-flash');
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    window.setTimeout(() => target.classList.remove('stsv-flash'), 2600);
}

async function revealFinishedVideo(title) {
    const context = ctx();
    let messageId = null;
    if (session.resultBlob && context) {
        const ids = [...session.selected];
        messageId = ids.length ? ids[ids.length - 1] : null;
        const ext = session.resultBlob.type?.includes('webm') ? 'webm' : 'mp4';
        const filename = `thoughtform-${Date.now()}.${ext}`;
        try {
            const uploaded = messageId != null
                ? await attachVideoToMessage(session.resultBlob, { messageId, filename, context })
                : await attachVideoAsNewMessage(session.resultBlob, { filename, context });
            if (messageId == null) messageId = Math.max(0, (context.chat?.length || 1) - 1);
            if (uploaded?.path) {
                session.movieFile = uploaded.path;
                persistSession();
            }
        } catch {
            messageId = null;
            if (session.status && !/Review step/.test(session.status)) {
                session.status = `${session.status} The file is on the Review step.`;
            }
        }
    }
    toastReady(title, messageId);
}

async function attachReadyStills() {
    if (session.error) return;
    const stillScene = session.scenes.find((scene) => scene.keyframeDataUrl && scene.keyframeMock !== true);
    if (!stillScene) return;
    const ids = [...session.selected];
    const messageId = messageIdForScene(stillScene, ids.length ? ids[ids.length - 1] : null);
    if (messageId == null) return;
    try {
        if (!stillScene.keyframeFile) {
            await attachImageDataUrl(stillScene.keyframeDataUrl, {
                messageId,
                filename: `thoughtform-still-${Date.now()}`,
                context: ctx(),
            });
        }
        toastReady('Stills ready', messageId);
    } catch {
        /* Download stays on the storyboard. */
    }
}

async function storeStillOnChat(scene, dataUrl, { filename, memberKey } = {}) {
    if (!dataUrl || scene?.keyframeMock === true && !memberKey) return null;
    const context = ctx();
    if (!context) return null;
    try {
        const uploaded = await uploadDataUrl(dataUrl, filename, context);
        if (memberKey) scene.memberStillFiles = { ...(scene.memberStillFiles || {}), [memberKey]: uploaded.path };
        else scene.keyframeFile = uploaded.path;
        const messageId = messageIdForScene(scene, [...session.selected].at(-1) ?? null);
        const message = messageId != null ? context.chat?.[messageId] : null;
        if (message) {
            appendMessageMedia(message, { url: uploaded.path, type: 'image', title: uploaded.name }, context);
            paintMessageMedia(message, messageId, context);
            await context.saveChat?.();
        }
        return uploaded;
    } catch {
        return null;
    }
}

async function storeClipOnChat(scene, blob, index) {
    if (!blob) return null;
    const context = ctx();
    if (!context) return null;
    try {
        const uploaded = await uploadVideoBlob(blob, `thoughtform-scene-${index + 1}-${Date.now()}`, context);
        scene.clipFile = uploaded.path;
        const messageId = messageIdForScene(scene, [...session.selected].at(-1) ?? null);
        const message = messageId != null ? context.chat?.[messageId] : null;
        if (message) {
            appendMessageMedia(message, { url: uploaded.path, type: 'video', title: uploaded.name }, context);
            paintMessageMedia(message, messageId, context);
            await context.saveChat?.();
        }
        return uploaded;
    } catch {
        return null;
    }
}

async function fetchStoredBlob(path) {
    try {
        const response = await fetch(fileSrc(path));
        if (!response.ok) return null;
        const blob = await response.blob();
        return blob?.size ? blob : null;
    } catch {
        return null;
    }
}

function postError(error) {
    if (isAbortError(error)) {
        session.error = 'Cancelled.';
        session.banner = '';
        renderStatus();
        return;
    }
    if (error?.banner) {
        session.banner = error.message || 'Something failed.';
        session.error = '';
        notifyError(session.banner);
        renderStatus();
        return;
    }
    const explained = explainError(error?.message || error);
    const text = `${explained.plain} ${explained.fix}`.trim();
    if (explained.banner) {
        session.banner = text;
        session.error = '';
    } else {
        session.banner = '';
        session.error = text;
    }
    notifyError(session.banner || session.error);
    renderStatus();
}

function fail(message) {
    const explained = explainError(message);
    if (explained.banner) {
        session.banner = `${explained.plain} ${explained.fix}`.trim();
        session.error = '';
        notifyError(session.banner);
    } else {
        session.banner = '';
        session.error = message;
        notifyError(message);
    }
    renderStatus();
}

function sourceLabel(source) {
    if (source === 'openrouter') return 'OpenRouter';
    if (source === 'openai') return 'the OpenAI-compatible endpoint';
    return "SillyTavern's connected model";
}

function nameFields(root) {
    root?.querySelectorAll?.('input, select, textarea').forEach((field, index) => {
        if (!field.id) {
            const bind = field.dataset.bind || field.dataset.field || `field-${index}`;
            field.id = `stsv-${bind}`;
        }
        if (!field.getAttribute('name')) field.setAttribute('name', field.id);
    });
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
