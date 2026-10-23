import { animatePrompt } from './animate.js';
import { appendMessageMedia, attachImageDataUrl, attachVideoAsNewMessage, attachVideoToMessage, paintMessageMedia, uploadDataUrl, uploadVideoBlob } from './attach.js';
import { fileSrc, messageIdForScene, restoreSceneMedia, sceneForChat } from './media.js';
import { assessSpend, dayStartIso, ledgerSlice, ledgerTotal, recordSpend } from './budget.js';
import { estimateCost } from './cost.js';
import { ASPECTS, MODULE_NAME, RESOLUTIONS, STYLES, THEMES } from './constants.js';
import { testProviderConnection } from './connect.js';
import { buildDiagnostics, debugLog, formatFailure, recentLogs } from './debug.js';
import { finishPlan } from './finish.js';
import { createJobLock, jobButtonLabel } from './job-lock.js';
import { planAnimatic, recordAnimatic } from './animatic.js';
import { audToUsd, clipAssetKey, condenseBeats, beatsToMessages, fitPlan, formatAud, formatAudShort, keyframeAssetKey, lookupAsset, overCapMessage, releaseMissingClips, rememberAsset, restoredShotNote, stillAssetKey, usdToAud } from './simple.js';
import { completeText, generateShotList } from './llm.js';
import { describeAvatar } from './avatar-look.js';
import { blobToDataUrl, characterRecordKey, ensureLibrary, matchRecord, materializeImage, referenceBlock, referenceSummary, resolvePersonaBoard, syncLibrary } from './library.js';
import { appendUseNote, imageRole, mergeUsedLines, referenceUseNote, selectCastReferences, selectJobReferences, usedLine, usedName } from './inspiration.js';
import { familyReferences } from './relations.js';
import { composeKeyframePrompt, keyframesPending, memberStillPrompt, planKeyframeJob } from './keyframes.js';
import { boardsForMember, referenceChoices, referenceMembers } from './cast-filter.js';
import { styleLockText } from './style-lock.js';
import { projectMedium } from './variants.js';
import { castForMessages, collectCast, idsInRange, lastIds, listMessages, previewText } from './messages.js';
import { attachPlaces } from './places.js';
import { chatPersona, listPersonas } from './personas.js';
import { continuityPrompt, ensureProject, nextEpisode, snapshotVersion } from './project.js';
import { loadQueue, pollJob, resumableJobs, saveQueue, upsertJob } from './queue.js';
import { QUALITY_PRESETS, activeModelId, applyQualityPreset, getQualityPreset } from './presets.js';
import { EXAMPLE_WORKFLOWS, checkComfy, comfyHardwareNote, loadExampleWorkflow } from './providers/comfyui.js';
import { findImageModel, generateReferenceImage, IMAGE_MODELS, missingImageKey, stillCost } from './providers/image.js';
import { applyLipsyncProvider, applyPictureProvider, applySameProvider, choiceLine, keyStatuses, modelRows, pictureModels, PICTURE_PROVIDERS, sameProviderNote, SHOT_PROVIDERS } from './models.js';
import { getProvider, providers } from './providers/registry.js';
import { buildVideoCall, collectReferenceImages } from './scene-request.js';
import { getSettings, saveSettings } from './settings.js';
import { linesFromDialogue, localShotList, styleLine } from './shotlist.js';
import { speakerCues, toSrt, toVtt } from './subtitles.js';
import { dialogueLines, sillyTavernVoices, synthesizeLine, voiceFor } from './tts.js';
import { buildLipsyncRequest } from './lipsync.js';
import { musicForAnimatic } from './sound.js';
import { CAMERA_MOVES, SHOT_TYPES, mergeScenes, splitScene } from './timeline.js';
import { stitchClips } from './stitch.js';
import { boardModel, onBoardChange, onBoardClick, onBoardFiles, onBoardInput, renderBoard } from './ui/board.js';
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
    spendId: '',
    beats: [],
    beatsDirty: false,
    beatsArmed: false,
    focusKey: '',
    scrollGuide: false,
    collapseLook: false,
    charLookOpen: true,
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
        mes.querySelectorAll('img').forEach((img) => {
            if (img.closest('.avatar') || img.classList.contains('avatar')) return;
            const posted = img.classList.contains('mes_img') || img.closest('.mes_img_container, .mes_img_swipes');
            if (!posted) return;
            let animate = img.parentElement?.querySelector(':scope > .stsv-animate');
            if (!animate) {
                animate = document.createElement('button');
                animate.type = 'button';
                animate.className = 'stsv-animate';
                animate.textContent = 'Animate this still';
                animate.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const id = Number(mes.getAttribute('mesid'));
                    animatePosted({
                        dataUrl: img.currentSrc || img.src,
                        messageId: Number.isFinite(id) ? id : null,
                    });
                });
                img.insertAdjacentElement('afterend', animate);
            }
            animate.hidden = !show;
        });
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
        if (event.target.closest('[data-act="choose-image-model"]')) {
            event.preventDefault();
            focusImageModel();
        }
        if (event.target.closest('#stsv-fix')) {
            event.preventDefault();
            applyReferenceFix();
        }
        const boardButton = event.target.closest('[data-act="open-board"]');
        if (boardButton) {
            event.preventDefault();
            openCharacterPage(boardButton.dataset.name || '');
        }
        const keyButton = event.target.closest('[data-act="open-image-key"], [data-act="open-key"]');
        if (keyButton) {
            event.preventDefault();
            openExtensionKey(keyButton.dataset.keySetting || keyButton.closest('[data-image-key]')?.dataset.keySetting || '');
        }
        const modelsButton = event.target.closest('[data-act="open-models"]');
        if (modelsButton) {
            event.preventDefault();
            focusModelTask(modelsButton.dataset.task || 'pictures');
        }
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
    root.querySelector('#stsv-music-file')?.addEventListener('change', async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const settings = liveSettings();
        if (!settings) return;
        try {
            const url = await blobToDataUrl(file);
            const id = `track-${Date.now().toString(36)}`;
            const tags = String(settings.musicTag || '').split(',').map((tag) => tag.trim()).filter(Boolean);
            settings.audioLibrary = [...(settings.audioLibrary || []), { id, name: file.name, url, tags }].slice(-12);
            settings.musicTrackId = id;
            settings.musicEnabled = true;
            saveSettings(ctx());
            session.status = `${file.name} is in the track library.`;
            renderChrome();
        } catch (error) {
            fail(error.message || 'Could not read that audio file.');
        }
        event.target.value = '';
    });
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
    root.querySelector('#stsv-picture-provider')?.addEventListener('change', (event) => {
        const settings = liveSettings();
        if (!settings || session.running) return;
        applyPictureProvider(settings, event.target.value);
        saveSettings(ctx());
        renderChrome();
    });
    root.querySelector('#stsv-lipsync-provider')?.addEventListener('change', (event) => {
        const settings = liveSettings();
        if (!settings || session.running) return;
        applyLipsyncProvider(settings, event.target.value);
        saveSettings(ctx());
        renderChrome();
    });
    root.querySelector('#stsv-music-mode')?.addEventListener('change', (event) => {
        const settings = liveSettings();
        if (!settings || session.running) return;
        settings.musicEnabled = event.target.value === 'library';
        saveSettings(ctx());
        renderChrome();
    });
    root.querySelector('#stsv-same-apply')?.addEventListener('click', () => {
        const settings = liveSettings();
        const pick = root.querySelector('#stsv-same-provider')?.value || '';
        if (!settings || session.running) return;
        const result = applySameProvider(settings, pick);
        saveSettings(ctx());
        const note = root.querySelector('#stsv-same-note');
        if (note) note.textContent = sameProviderNote(result);
        renderChrome();
    });
    root.querySelector('.stsv-steps').addEventListener('click', (event) => {
        const button = event.target.closest('[data-step-jump]');
        if (button) showStep(button.dataset.stepJump);
    });
    const boardHost = root.querySelector('#stsv-board');
    boardHost.addEventListener('click', (event) => { onBoardClick(event, boardEnv()); });
    boardHost.addEventListener('input', (event) => { onBoardInput(event, boardEnv()); });
    boardHost.addEventListener('change', (event) => { onBoardChange(event, boardEnv()); });
    boardHost.addEventListener('dragover', (event) => {
        if ([...(event.dataTransfer?.types || [])].includes('Files')) event.preventDefault();
    });
    boardHost.addEventListener('drop', (event) => { onBoardFiles(event, boardEnv()); });
    boardHost.addEventListener('paste', (event) => { onBoardFiles(event, boardEnv()); });
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

function imageModelOptions() {
    return IMAGE_MODELS.map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.short || model.label)}</option>`).join('');
}

function imageKeyNote() {
    return `<p class="stsv-warn stsv-image-key" data-image-key hidden><span class="stsv-image-key-text"></span> <button type="button" data-act="open-image-key">Add the key</button></p>`;
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
                <div class="stsv-header-copy">
                    <h2 id="stsv-title">Thoughtform</h2>
                    <p>Make my video uses your saved budget and look, draws the stills, and waits for you to approve them. Real video is optional after that.</p>
                </div>
                <button type="button" id="stsv-close" aria-label="Close">Close</button>
            </header>
            <nav class="stsv-steps" aria-label="Steps">
                <button type="button" data-step-jump="select" aria-current="step">Select</button>
                <button type="button" data-step-jump="cast">Cast and look</button>
                <button type="button" data-step-jump="story">Storyboard</button>
                <button type="button" data-step-jump="generate">Generate</button>
                <button type="button" data-step-jump="review">Review</button>
                <button type="button" data-step-jump="models">Models</button>
            </nav>
            <div class="stsv-body">
                <p id="stsv-banner" class="stsv-banner" role="alert" hidden></p>
                <div class="stsv-step" data-step="select">
                <section>
                    <h3>Messages</h3>
                    <p class="stsv-hint">Tick the lines to film. Make my video picks these if you have not, writes the shots, and stops so you can approve each still.</p>
                    <p class="stsv-model-line"><span id="stsv-pictures-line">Pictures made with</span> <button type="button" data-act="open-models" data-task="pictures">change</button></p>
                    ${imageKeyNote()}
                    <section class="stsv-budget" aria-label="Budget">
                        <div id="stsv-cap-controls">
                            <div class="stsv-slider">
                                <label id="stsv-cap-label" for="stsv-cap-range">Max spend</label>
                                <input id="stsv-cap-range" name="stsv-cap-range" data-bind="budgetCapAud" type="range" min="0" max="40" step="0.5" aria-labelledby="stsv-cap-label">
                                <output id="stsv-cap-value" for="stsv-cap-range">A$5.00</output>
                            </div>
                            <label>AUD <input id="stsv-cap-aud" name="stsv-cap-aud" data-bind="budgetCapAud" data-kind="number" type="number" min="0" step="0.5" aria-label="Max spend in Australian dollars"></label>
                            <div class="stsv-slider">
                                <label id="stsv-visit-label" for="stsv-visit-meter">This visit</label>
                                <progress id="stsv-visit-meter" aria-labelledby="stsv-visit-label" max="5" value="0">A$0.00 of A$5.00</progress>
                                <output id="stsv-visit-value" for="stsv-visit-meter">A$0.00 of A$5.00</output>
                            </div>
                            <label title="Estimated spend for this page visit. A reload starts again at zero. Zero means no visit cap.">This visit <input id="stsv-session-cap" name="stsv-session-cap" data-bind="sessionCapAud" data-kind="number" type="number" min="0" step="0.5" aria-label="This visit spend cap in Australian dollars"></label>
                            <label title="Estimated spend since midnight UTC. Zero means no daily cap.">Today <input id="stsv-day-cap" name="stsv-day-cap" data-bind="dayCapAud" data-kind="number" type="number" min="0" step="0.5" aria-label="Today spend cap in Australian dollars"></label>
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
                            <div class="stsv-slider">
                                <label id="stsv-length-label" for="stsv-length-range">Length</label>
                                <input id="stsv-length-range" name="stsv-length-range" data-bind="targetSeconds" type="range" min="10" max="180" step="5" aria-labelledby="stsv-length-label">
                                <output id="stsv-length-value" for="stsv-length-range">70 seconds</output>
                            </div>
                            <label>Seconds <input id="stsv-length-seconds" name="stsv-length-seconds" data-bind="targetSeconds" data-kind="number" type="number" min="10" max="180" step="5" aria-label="Target length in seconds"></label>
                        </div>
                        <p class="stsv-hint">Caps are estimates in Australian dollars, checked before a paid still or clip. The film cap, this visit, and today are separate. Zero means that cap is off. The US dollar figure uses about 0.66 USD per AUD, a rough rate, not a bank quote.</p>
                        <div class="stsv-qualities" role="radiogroup" aria-label="Picture quality">${qualities}</div>
                        <p class="stsv-hint">Draft is the cheapest. Standard is the usual look. Showcase is the sharp one. Finer controls sit under Advanced.</p>
                        <label title="A moving still is a free rough cut that pans across the pictures. Real video is the paid clip."><input data-bind="stillsFirst" type="checkbox"> Start with moving stills, then pick which scenes become real video</label>
                        <label class="stsv-output-label">Output
                            <select id="stsv-output" data-bind="outputMode" aria-label="Output">
                                <option value="video">Video</option>
                                <option value="images">Images only</option>
                            </select>
                        </label>
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
                        <button type="button" id="stsv-write">Write shot list</button>
                        <button type="button" id="stsv-local" title="Use local split">Local split</button>
                    </div>
                    <div id="stsv-roster" class="stsv-roster" hidden></div>
                    <div id="stsv-messages" class="stsv-messages"></div>
                </section>
                </div>
                <div class="stsv-step" data-step="cast" hidden>
                <section>
                    <details id="stsv-look-settings" open>
                    <summary>Look settings</summary>
                    <h3>Look</h3>
                    <p class="stsv-model-line"><span id="stsv-cast-pictures-line">Pictures made with</span> <button type="button" data-act="open-models" data-task="pictures">change</button></p>
                    <p class="stsv-model-line"><span id="stsv-shots-line">Shot list</span> <button type="button" data-act="open-models" data-task="shots">change</button></p>
                    <p class="stsv-model-line"><span id="stsv-describe-line">Describe a picture</span> <button type="button" data-act="open-models" data-task="describe">change</button></p>
                    <div class="stsv-grid">
                        <label>Style <select data-bind="style">${styles}</select></label>
                        <label>Theme <select data-bind="themeId">${themes}</select></label>
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
                    </details>
                    <div id="stsv-board"></div>
                </section>
                </div>
                <div class="stsv-step" data-step="generate" hidden>
                <section>
                    <h3>Video</h3>
                    <p class="stsv-model-line"><span id="stsv-video-line">Video</span> <button type="button" data-act="open-models" data-task="video">change</button></p>
                    <p class="stsv-model-line"><span id="stsv-voice-line">Dialogue voice</span> <button type="button" data-act="open-models" data-task="voice">change</button></p>
                    <p class="stsv-model-line"><span id="stsv-music-line">Music</span> <button type="button" data-act="open-models" data-task="music">change</button></p>
                    <p id="stsv-proxy" class="stsv-warn" hidden>Needs SillyTavern's built-in CORS proxy. Replicate blocks browser calls. Set enableCorsProxy: true in config.yaml, or start with --corsProxy, then restart.</p>
                    <p id="stsv-key-line" class="stsv-hint"></p>
                    <p id="stsv-setup" class="stsv-hint"></p>
                    <p id="stsv-nsfw" class="stsv-hint"></p>
                    <div class="stsv-qualities" role="radiogroup" aria-label="Quality">${qualities}</div>
                    <p id="stsv-quality-note" class="stsv-hint"></p>
                    <details class="stsv-advanced">
                        <summary>Advanced</summary>
                        <p class="stsv-hint">Resolution, frame rate, and steps. The model is on the Models tab. Changing these switches you off the simple presets.</p>
                        <div class="stsv-qualities" role="radiogroup" aria-label="Older quality presets">${advancedQualities}</div>
                        <div class="stsv-grid">
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
                    <p class="stsv-model-line"><span id="stsv-workflow-line">ComfyUI workflow</span> <button type="button" data-act="open-models" data-task="workflow">change</button></p>
                    <div id="stsv-custom" class="stsv-sub">
                        <p class="stsv-hint">The submit URL, poll URL, and JSON templates are under Extensions → Thoughtform. Runway, Luma, and other hosts go through this provider. Kling's own API needs the SillyTavern proxy.</p>
                    </div>
                    <div id="stsv-connection-tests" class="stsv-row"></div>
                    <div class="stsv-row">
                        <button type="button" id="stsv-test-provider">Test connection</button>
                        <label>Ask before spending more than <input data-bind="confirmAbove" data-kind="number" type="number" min="0" step="0.05"></label>
                    </div>
                    <p id="stsv-spend" class="stsv-hint"></p>
                    <label>Narration
                        <select data-bind="narrationMode">
                            <option value="off">Off</option>
                            <option value="captions">On-screen text</option>
                            <option value="voice">Narrator voiceover</option>
                        </select>
                    </label>
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
                <p id="stsv-review-empty" class="stsv-hint">No clip yet. Generate from Storyboard, then come back here to download it or attach it to the chat.</p>
                <p id="stsv-review-note" class="stsv-hint" hidden></p>
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
                <div class="stsv-step" data-step="models" hidden>
                <section>
                    <h3>Models</h3>
                    <p class="stsv-hint">Every task is chosen here. The other steps only show what you picked. Keys stay under Extensions → Thoughtform and are never written to the log.</p>
                    <div class="stsv-same">
                        <label>Use the same provider for everything
                            <select id="stsv-same-provider" aria-label="Use the same provider for everything">
                                <option value="">Choose…</option>
                                <option value="openrouter">OpenRouter</option>
                                <option value="fal">fal.ai</option>
                                <option value="comfyui">ComfyUI (local)</option>
                                <option value="mock">Mock (free preview)</option>
                            </select>
                        </label>
                        <button type="button" id="stsv-same-apply">Apply</button>
                    </div>
                    <p id="stsv-same-note" class="stsv-hint"></p>
                    <table class="stsv-models">
                        <thead>
                            <tr><th>Task</th><th>Provider</th><th>Model</th><th>Key</th><th>Cost</th></tr>
                        </thead>
                        <tbody>
                            <tr data-task="pictures">
                                <td data-label="Task"><strong>Pictures</strong><p class="stsv-hint">Expressions, turnarounds, scene stills, outfits, and Animate this still.</p></td>
                                <td data-label="Provider"><select id="stsv-picture-provider" aria-label="Picture provider">${PICTURE_PROVIDERS.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join('')}</select></td>
                                <td data-label="Model"><label id="stsv-image-model-label"><select id="stsv-image-model" data-bind="imageModel" aria-label="Pictures made with" title="Mock draws a text card. Gemini and Flux draw a picture.">${imageModelOptions()}</select></label></td>
                                <td data-label="Key"><span id="stsv-picture-key"></span></td>
                                <td data-label="Cost"><span id="stsv-picture-cost"></span></td>
                            </tr>
                            <tr data-task-warn="pictures"><td colspan="5"><p id="stsv-warn-pictures" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="video">
                                <td data-label="Task"><strong>Video</strong><p class="stsv-hint">The clip after you approve a still. A quality preset can change this model.</p></td>
                                <td data-label="Provider"><select id="stsv-video-provider" data-bind="provider" aria-label="Video provider">${providersHtml}</select></td>
                                <td data-label="Model"><select id="stsv-model" data-bind="model" aria-label="Video model"></select></td>
                                <td data-label="Key"><span id="stsv-video-key"></span></td>
                                <td data-label="Cost"><span id="stsv-video-cost"></span></td>
                            </tr>
                            <tr data-task-warn="video"><td colspan="5"><p id="stsv-warn-video" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="shots">
                                <td data-label="Task"><strong>Shot list</strong><p class="stsv-hint">Writes the scene prompts.</p></td>
                                <td data-label="Provider"><select data-bind="llmSource" aria-label="Shot list provider">${SHOT_PROVIDERS.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join('')}</select></td>
                                <td data-label="Model">
                                    <span id="stsv-shot-silly">SillyTavern's connected model</span>
                                    <div id="stsv-llm-openrouter" class="stsv-sub">
                                        <label>OpenRouter text model <input data-bind="openrouterTextModel" type="text" autocomplete="off"></label>
                                    </div>
                                    <div id="stsv-llm-openai" class="stsv-sub">
                                        <label>Model <input data-bind="openaiModel" type="text" autocomplete="off"></label>
                                        <label>Base URL <input data-bind="openaiBaseUrl" type="text" autocomplete="off"></label>
                                    </div>
                                </td>
                                <td data-label="Key"><span id="stsv-shot-key"></span></td>
                                <td data-label="Cost"><span id="stsv-shot-cost"></span></td>
                            </tr>
                            <tr data-task-warn="shots"><td colspan="5"><p id="stsv-warn-shots" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="describe">
                                <td data-label="Task"><strong>Describe a picture</strong><p class="stsv-hint">Describe from picture, and the first look at an avatar. It has to be a model that can see a picture.</p></td>
                                <td data-label="Provider"><select data-bind="describeSource" aria-label="Describe a picture provider"><option value="">Same as shot list</option>${SHOT_PROVIDERS.map((item) => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.label)}</option>`).join('')}</select></td>
                                <td data-label="Model"><span id="stsv-describe-model"></span></td>
                                <td data-label="Key"><span id="stsv-describe-key"></span></td>
                                <td data-label="Cost"><span id="stsv-describe-cost"></span></td>
                            </tr>
                            <tr data-task-warn="describe"><td colspan="5"><p id="stsv-warn-describe" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="voice">
                                <td data-label="Task"><strong>Dialogue voice</strong><p class="stsv-hint">Speak dialogue on Finish.</p></td>
                                <td data-label="Provider"><select data-bind="ttsProvider" aria-label="Dialogue voice"><option value="mock">Mock</option><option value="elevenlabs">ElevenLabs</option><option value="openai">OpenAI-compatible</option></select></td>
                                <td data-label="Model"><span id="stsv-voice-model"></span><label id="stsv-voice-openai">Speech model <input data-bind="openaiTtsModel" type="text" autocomplete="off"></label></td>
                                <td data-label="Key"><span id="stsv-voice-key"></span></td>
                                <td data-label="Cost"><span id="stsv-voice-cost"></span></td>
                            </tr>
                            <tr data-task-warn="voice"><td colspan="5"><p id="stsv-warn-voice" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="lipsync">
                                <td data-label="Task"><strong>Lip-sync</strong><p class="stsv-hint">A later pass on the finished clip.</p></td>
                                <td data-label="Provider"><select id="stsv-lipsync-provider" aria-label="Lip-sync provider"><option value="fal">fal.ai</option><option value="comfy">ComfyUI</option></select></td>
                                <td data-label="Model"><select data-bind="lipSyncModel" aria-label="Lip-sync model"><option value="fal-ai/sync-lipsync/v3">sync-lipsync v3</option><option value="fal-ai/latentsync">LatentSync</option><option value="comfy">ComfyUI workflow</option></select></td>
                                <td data-label="Key"><span id="stsv-lipsync-key"></span></td>
                                <td data-label="Cost"><span id="stsv-lipsync-cost"></span></td>
                            </tr>
                            <tr data-task-warn="lipsync"><td colspan="5"><p id="stsv-warn-lipsync" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="music">
                                <td data-label="Task"><strong>Music</strong><p class="stsv-hint">A track you already have. Thoughtform does not generate music.</p></td>
                                <td data-label="Provider">Your library</td>
                                <td data-label="Model">
                                    <select id="stsv-music-mode" aria-label="Music"><option value="off">Off</option><option value="library">A track from my library</option></select>
                                    <div id="stsv-music" class="stsv-sub" hidden>
                                        <label>Track <select id="stsv-music-track" data-bind="musicTrackId"></select></label>
                                        <label>Tag <input id="stsv-music-tag" name="stsv-music-tag" data-bind="musicTag" type="text" placeholder="rain, tense"></label>
                                        <label class="stsv-file">Add a track <input id="stsv-music-file" type="file" accept="audio/*"></label>
                                    </div>
                                </td>
                                <td data-label="Key">No key</td>
                                <td data-label="Cost">Free</td>
                            </tr>
                            <tr data-task-warn="music"><td colspan="5"><p id="stsv-warn-music" class="stsv-warn" hidden></p></td></tr>
                            <tr data-task="workflow">
                                <td data-label="Task"><strong>ComfyUI workflow</strong><p class="stsv-hint">Used when pictures or video are set to ComfyUI.</p></td>
                                <td data-label="Provider">ComfyUI</td>
                                <td data-label="Model"><span id="stsv-workflow-name">none</span></td>
                                <td data-label="Key">No key</td>
                                <td data-label="Cost">Free</td>
                            </tr>
                            <tr data-task-warn="workflow"><td colspan="5">
                                <p id="stsv-warn-workflow" class="stsv-warn" hidden></p>
                                <div id="stsv-comfy" class="stsv-sub">
                                    <label>ComfyUI URL <input data-bind="comfyUrl" type="text"></label>
                                    <div class="stsv-row">
                                        <button type="button" id="stsv-comfy-check">Test ComfyUI</button>
                                        <label class="stsv-file">API workflow <input id="stsv-workflow-file" type="file" accept="application/json,.json"></label>
                                        <span id="stsv-examples" class="stsv-row"></span>
                                    </div>
                                    <p class="stsv-hint">On an 8GB RTX 3060 Ti, use LTX-2.3 (the first example). Point the loader nodes at files that exist in your ComfyUI. Start it with <code>--enable-cors-header *</code> and keep that port off the public internet.</p>
                                    <label>Node mapping override <textarea data-bind="comfyMapping" rows="3" placeholder='{"prompt":{"node":"6","field":"text"}}'></textarea></label>
                                </div>
                            </td></tr>
                        </tbody>
                    </table>
                    <h4>Keys</h4>
                    <p class="stsv-hint">A tick means a key is saved. Thoughtform does not show the key.</p>
                    <ul id="stsv-key-status" class="stsv-key-status"></ul>
                </section>
                </div>
            </div>
            <div class="stsv-note-bar">
                <p id="stsv-error" class="stsv-error" role="alert" hidden></p>
                <p id="stsv-status" class="stsv-status" aria-live="polite"></p>
                <button type="button" id="stsv-choose-model" data-act="choose-image-model" hidden>Choose a picture model</button>
                <button type="button" id="stsv-fix" hidden></button>
            </div>
            <footer class="stsv-footer">
                <div class="stsv-footer-status">
                    <p id="stsv-cost" class="stsv-cost">≈ A$0.00</p>
                    <details class="stsv-cost-details">
                        <summary title="Price details">Price</summary>
                        <p id="stsv-cost-note"></p>
                    </details>
                </div>
                <div class="stsv-footer-actions">
                    <button type="button" id="stsv-make" class="stsv-primary">Make my video</button>
                    <button type="button" id="stsv-generate">Generate video</button>
                    <button type="button" id="stsv-view-result" hidden>View result</button>
                </div>
                <button type="button" id="stsv-cancel" title="Stop the job that is running">Cancel</button>
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
    if (key === 'imageModel') settings.imageModelChosen = true;
    if (key === 'budgetCapAud' || key === 'budgetMode' || key === 'targetSeconds') {
        applyBudgetFit({ lockQuality: settings.quality === 'custom' || settings.quality === 'max' });
        return;
    }
    saveSettings(ctx());
    syncSettingsForm();
    if (key === 'provider' || key === 'model' || field.dataset.customizes === '1' || key === 'llmSource' || key === 'describeSource' || key === 'ttsProvider' || key === 'lipSyncModel' || key === 'style' || key === 'stillsFirst' || key === 'imageModel' || key === 'outputMode' || key === 'musicEnabled' || key === 'openrouterTextModel' || key === 'openaiModel' || key === 'openaiTtsModel') renderChrome();
    else updateCost();
}

function assignModel(settings, modelId) {
    if (settings.provider === 'xai') settings.xaiModel = modelId;
    if (settings.provider === 'fal') settings.falModel = modelId;
    if (settings.provider === 'replicate') settings.replicateModel = modelId;
    if (settings.provider === 'openrouter') settings.openrouterVideoModel = modelId;
}

function syncMusicMenu(settings) {
    const select = session.root?.querySelector('#stsv-music-track');
    if (!select) return;
    const library = Array.isArray(settings.audioLibrary) ? settings.audioLibrary : [];
    const key = library.map((track) => track.id).join('|');
    if (select.dataset.menu !== key) {
        select.dataset.menu = key;
        select.innerHTML = [
            '<option value="">No track selected</option>',
            ...library.map((track) => `<option value="${escapeAttr(track.id)}">${escapeHtml(track.name || track.id)}</option>`),
        ].join('');
    }
    show('stsv-music', settings.musicEnabled === true);
}

function renderChrome() {
    const settings = liveSettings();
    if (!settings || !session.root) return;
    syncMusicMenu(settings);
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
    show('stsv-shot-silly', settings.llmSource !== 'openrouter' && settings.llmSource !== 'openai');
    show('stsv-voice-openai', settings.ttsProvider === 'openai');
    show('stsv-style-other', settings.style === 'other');
    paintModelTable(settings);
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
    const capValue = session.root.querySelector('#stsv-cap-value');
    if (capValue) capValue.textContent = `A$${Number(settings.budgetCapAud || 0).toFixed(2)}`;
    const lengthValue = session.root.querySelector('#stsv-length-value');
    if (lengthValue) lengthValue.textContent = `${Number(settings.targetSeconds) || 0} seconds`;
    const visitUsd = ledgerSlice(settings.spentLedger, { sessionId: spendSessionId() });
    const visitAud = usdToAud(visitUsd);
    const visitCap = Number(settings.sessionCapAud) || 0;
    const meter = session.root.querySelector('#stsv-visit-meter');
    const visitValue = session.root.querySelector('#stsv-visit-value');
    const visitText = visitCap > 0 ? `A$${visitAud.toFixed(2)} of A$${visitCap.toFixed(2)}` : `A$${visitAud.toFixed(2)}`;
    if (meter) {
        meter.max = visitCap > 0 ? visitCap : Math.max(visitAud, 1);
        meter.value = visitCap > 0 ? Math.min(visitAud, visitCap) : visitAud;
        meter.textContent = visitText;
    }
    if (visitValue) visitValue.textContent = visitText;
    const cancel = session.root.querySelector('#stsv-cancel');
    cancel.disabled = !session.running;
    cancel.hidden = false;
    updateCost();
    show('stsv-debug', Boolean(settings.debug));
    paintSpend(settings);
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
        spendLine(settings),
        priced.known ? '' : 'This step has no stored price yet.',
    ].filter(Boolean).join(' ');
    text('stsv-cost-note', detail);
    text('stsv-video-total', session.scenes.length ? running : '');
}

function spendSessionId() {
    if (!session.spendId) session.spendId = `visit-${Date.now().toString(36)}`;
    return session.spendId;
}

function spendLine(settings) {
    if (!settings) return '';
    const visit = ledgerSlice(settings.spentLedger, { sessionId: spendSessionId() });
    const today = ledgerSlice(settings.spentLedger, { since: dayStartIso() });
    const visitCap = Number(settings.sessionCapAud) || 0;
    const dayCap = Number(settings.dayCapAud) || 0;
    return `This visit ${formatAudShort(visit)} of A$${visitCap.toFixed(2)}. Today ${formatAudShort(today)} of A$${dayCap.toFixed(2)}.`;
}

function paintSpend(settings) {
    const spent = ledgerTotal(settings?.spentLedger);
    const line = spendLine(settings);
    text('stsv-spend', spent ? `${line} About $${spent.toFixed(2)} USD on this browser.` : line);
}

function runningTotal(plan, settings) {
    if (!session.scenes.length || plan.usd == null) return '';
    const spent = formatAud((plan.spentUsd || 0) + plan.usd);
    if (settings.budgetMode === 'length' || !Number(settings.budgetCapAud)) return `Running total ${spent}.`;
    return `Running total ${spent} of $${Number(settings.budgetCapAud).toFixed(2)} AUD.`;
}

function markClipReady(extra = '') {
    session.status = 'Your clip is in Review — attach it to the chat';
    const note = session.root?.querySelector('#stsv-review-note');
    if (!note) return;
    note.hidden = !extra;
    note.textContent = extra;
}

function paintImageKey(settings) {
    const gap = missingImageKey(settings);
    session.root?.querySelectorAll('[data-image-key]').forEach((node) => {
        node.hidden = !gap;
        const text = node.querySelector('.stsv-image-key-text');
        if (text) text.textContent = gap?.text || '';
        if (gap) node.dataset.keySetting = gap.setting;
    });
}

function focusImageModel() {
    focusModelTask('pictures');
}

function focusModelTask(task) {
    showStep('models');
    const row = session.root?.querySelector(`[data-task="${task}"]`) || session.root?.querySelector('#stsv-image-model-label');
    const field = task === 'pictures' ? session.root?.querySelector('#stsv-image-model') : row?.querySelector('select, input');
    const mark = task === 'pictures' ? session.root?.querySelector('#stsv-image-model-label') : row;
    if (!row || !mark) return;
    requestAnimationFrame(() => {
        mark.scrollIntoView({ block: 'center' });
        mark.classList.add('stsv-highlight');
        field?.focus?.({ preventScroll: true });
        window.setTimeout(() => mark.classList.remove('stsv-highlight'), 2700);
    });
}

function keyMarkup(key, { button = false } = {}) {
    if (!key || key.state === 'local') return 'No key';
    if (key.state === 'ok') return '<span class="stsv-key-ok">Saved</span>';
    const chip = '<span class="stsv-key-need">Needs key</span>';
    if (!button || !key.setting) return chip;
    return `${chip} <button type="button" data-act="open-key" data-key-setting="${escapeAttr(key.setting)}">Add the key</button>`;
}

function paintWarning(node, row) {
    if (!node) return;
    const notes = row.warnings || [];
    node.hidden = notes.length === 0;
    if (!notes.length) {
        node.replaceChildren();
        return;
    }
    const needsKey = row.key?.state === 'needs' && row.key.setting;
    const button = needsKey
        ? `<button type="button" data-act="open-key" data-key-setting="${escapeAttr(row.key.setting)}">Add the key</button>`
        : '';
    node.innerHTML = `${escapeHtml(notes.join(' '))}${button ? ` ${button}` : ''}`;
}

function paintModelTable(settings) {
    const rows = modelRows(settings);
    const byId = Object.fromEntries(rows.map((row) => [row.id, row]));
    const pictureProvider = session.root.querySelector('#stsv-picture-provider');
    if (pictureProvider && document.activeElement !== pictureProvider) pictureProvider.value = byId.pictures.providerId;
    const pictureSelect = session.root.querySelector('#stsv-image-model');
    const wanted = pictureModels(byId.pictures.providerId);
    const menuKey = wanted.map((model) => model.id).join('|');
    if (pictureSelect && pictureSelect.dataset.menu !== menuKey) {
        pictureSelect.dataset.menu = menuKey;
        pictureSelect.innerHTML = wanted.map((model) => `<option value="${escapeAttr(model.id)}">${escapeHtml(model.short || model.label)}</option>`).join('');
    }
    setControl(pictureSelect, settings.imageModel);
    const lipsyncProvider = session.root.querySelector('#stsv-lipsync-provider');
    if (lipsyncProvider && document.activeElement !== lipsyncProvider) lipsyncProvider.value = byId.lipsync.providerId;
    const musicMode = session.root.querySelector('#stsv-music-mode');
    if (musicMode && document.activeElement !== musicMode) musicMode.value = settings.musicEnabled === true ? 'library' : 'off';
    const keyIds = {
        pictures: 'stsv-picture-key',
        video: 'stsv-video-key',
        shots: 'stsv-shot-key',
        describe: 'stsv-describe-key',
        voice: 'stsv-voice-key',
        lipsync: 'stsv-lipsync-key',
    };
    const costIds = {
        pictures: 'stsv-picture-cost',
        video: 'stsv-video-cost',
        shots: 'stsv-shot-cost',
        describe: 'stsv-describe-cost',
        voice: 'stsv-voice-cost',
        lipsync: 'stsv-lipsync-cost',
    };
    for (const row of rows) {
        const warn = session.root.querySelector(`#stsv-warn-${row.id}`);
        paintWarning(warn, row);
        if (keyIds[row.id]) {
            const host = session.root.querySelector(`#${keyIds[row.id]}`);
            if (host) host.innerHTML = keyMarkup(row.key);
        }
        if (costIds[row.id]) text(costIds[row.id], row.cost);
    }
    text('stsv-describe-model', byId.describe.summary);
    text('stsv-voice-model', byId.voice.modelLabel);
    const lines = [
        ['stsv-pictures-line', 'pictures'],
        ['stsv-cast-pictures-line', 'pictures'],
        ['stsv-video-line', 'video'],
        ['stsv-shots-line', 'shots'],
        ['stsv-describe-line', 'describe'],
        ['stsv-voice-line', 'voice'],
        ['stsv-music-line', 'music'],
        ['stsv-workflow-line', 'workflow'],
    ];
    for (const [id, task] of lines) text(id, choiceLine(settings, task));
    const keys = session.root.querySelector('#stsv-key-status');
    if (keys) {
        keys.innerHTML = keyStatuses(settings).map((item) => (
            `<li><span>${escapeHtml(item.label)}</span> ${keyMarkup(item, { button: true })}</li>`
        )).join('');
    }
}

function openExtensionKey(setting) {
    const names = {
        falKey: 'fal.ai API key',
        openrouterKey: 'OpenRouter API key',
        xaiKey: 'xAI API key',
        replicateKey: 'Replicate API token',
        openaiKey: 'OpenAI-compatible key',
        'custom.apiKey': 'Custom API key',
    };
    const name = names[setting] || 'API key';
    const root = document.getElementById('stsv-settings');
    if (!root) {
        session.status = `Add the ${name} under Extensions → Thoughtform.`;
        renderStatus();
        return;
    }
    closePanel();
    document.querySelector('#extensions-settings-button, #extensions_settings_button, #extensionsMenuButton')?.click();
    const content = root.querySelector('.inline-drawer-content');
    if (content) content.style.display = 'block';
    const toggle = root.querySelector('.inline-drawer-toggle');
    if (toggle && content && getComputedStyle(content).display === 'none') toggle.click();
    const field = root.querySelector(`[data-setting="${setting}"]`);
    const label = field?.closest('label') || field;
    window.setTimeout(() => {
        label?.scrollIntoView({ block: 'center' });
        label?.classList.add('stsv-highlight');
        field?.focus?.();
        window.setTimeout(() => label?.classList.remove('stsv-highlight'), 2700);
    }, 60);
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
    const choose = session.root?.querySelector('#stsv-choose-model');
    if (choose) choose.hidden = !/mock text card/i.test(status.textContent);
    const fix = session.root?.querySelector('#stsv-fix');
    if (fix) {
        fix.hidden = !session.fix?.label;
        fix.textContent = session.fix?.label || '';
    }
    paintImageKey(liveSettings());
}

function applyReferenceFix() {
    const fix = session.fix;
    if (!fix) return;
    if (fix.style) {
        const settings = liveSettings();
        if (settings) {
            settings.style = fix.style === 'anime' ? 'anime' : 'live-action';
            saveSettings(ctx());
            syncSettingsForm();
        }
        session.fix = null;
        session.error = fix.style === 'anime' ? 'Style is Anime.' : 'Style is Live action.';
        renderStatus();
        renderChrome();
        return;
    }
    session.fix = null;
    showStep('cast');
    renderPeople();
    const key = fix.key || '';
    const safe = key && typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : String(key).replace(/"/g, '');
    window.setTimeout(() => {
        document.querySelector(`#stsv-people [data-act="add-image"][data-key="${safe}"]`)?.click();
    }, 40);
    renderStatus();
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
        <ul>${people.map((person) => `<li><strong>${escapeHtml(person.name)}</strong> <span>${escapeHtml(person.note)}</span>${person.voice ? ` <span>Voice ${escapeHtml(person.voice)}</span>` : ''} <button type="button" data-act="open-board" data-name="${escapeAttr(person.name)}">Board</button></li>`).join('')}</ul>
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
            ${referencePicker(scene, index)}
            ${keyframeReview(scene, index)}
        </article>
    `).join('');
}

function referencePicker(scene, index) {
    const records = Object.values(ensureLibrary(liveSettings()).records);
    const choices = referenceChoices(scene, records, selectedMessages());
    if (!choices.length) return '';
    return `
        <fieldset class="stsv-refs">
            <legend>Boards in this shot</legend>
            <p class="stsv-hint">Only people named in this scene are sent. Untick someone to leave their board out.</p>
            ${choices.map((choice) => `
                <label>
                    <input id="stsv-ref-${index}-${escapeAttr(choice.key)}" name="stsv-ref-${index}-${escapeAttr(choice.key)}" data-field="reference-key" data-ref="${escapeAttr(choice.key)}" type="checkbox" ${choice.checked ? 'checked' : ''}>
                    ${escapeHtml(choice.name)}
                </label>
            `).join('')}
        </fieldset>
    `;
}

function keyframeReview(scene, index) {
    const settings = liveSettings();
    const records = Object.values(ensureLibrary(settings).records);
    const focused = { ...scene, cast: referenceMembers(scene, records, selectedMessages()) };
    const composed = scene.keyframePrompt || composeKeyframePrompt({ scene: focused, settings, records, proposals: session.proposals });
    const mockCard = Boolean(scene.keyframeDataUrl) && (scene.keyframeMock === true || (scene.keyframeMock !== false && settings?.imageModel === 'mock'));
    const preview = scene.keyframeDataUrl
        ? `<img class="stsv-keyframe-still" src="${escapeAttr(scene.keyframeDataUrl)}" alt="${mockCard ? 'Mock text card for scene' : 'Keyframe for scene'} ${index + 1}">`
        : '<div class="stsv-keyframe-empty">No keyframe yet. Generate stills, compare them with the references, then approve. Video stays off until then.</div>';
    const mockHint = mockCard
        ? `<div class="stsv-mock-card"><p class="stsv-hint">This is a mock text card of the prompt, not a generated picture.</p><button type="button" data-act="choose-image-model">Choose a picture model</button></div>`
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
                <button type="button" data-act="animate-still" ${scene.keyframeDataUrl && !mockCard ? '' : 'disabled'}>Animate this still</button>
            </div>
        </section>
    `;
}

function referenceThumbs(scene, records) {
    const members = referenceMembers(scene, records, selectedMessages());
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
    if (field === 'reference-key') {
        scene.referenceOverride = true;
        scene.referenceKeys = [...card.querySelectorAll('[data-field="reference-key"]:checked')].map((box) => box.dataset.ref);
        persistSession();
        return;
    }
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
    if (button.dataset.act === 'choose-image-model') return;
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
    if (button.dataset.act === 'animate-still') {
        const scene = session.scenes[index];
        if (!scene?.keyframeDataUrl || scene.keyframeMock) return fail('Choose a real still before animating it.');
        animatePosted({
            dataUrl: scene.keyframeDataUrl,
            prompt: scene.prompt,
            title: scene.title,
            messageId: messageIdForScene(scene, [...session.selected].at(-1) ?? null),
        });
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
        session.error = isAbortError(error) ? 'Cancelled.' : (formatFailure(error).text || 'The shot list failed.');
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

async function materializeList(images) {
    const headers = ctx()?.getRequestHeaders?.() || {};
    const urls = [];
    const thumbs = [];
    let failure = null;
    for (const image of images || []) {
        if (!image || urls.length >= 4) break;
        try {
            const url = await materializeImage(image, globalThis.fetch, { headers });
            if (url && !urls.includes(url)) {
                urls.push(url);
                thumbs.push({ src: url, label: image.label || image.source || 'reference' });
            }
        } catch (error) {
            failure = error;
        }
    }
    return { urls, thumbs, failure };
}

async function describeRecord(record, image) {
    if (!record || !image || String(record.appearance || '').trim()) return;
    try {
        const settings = liveSettings();
        const look = await describeAvatar(record, {
            image,
            complete: (request) => completeText({
                settings,
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                image,
                signal: session.controller?.signal,
                responseLength: 400,
            }),
        });
        if (look) saveSettings(ctx());
    } catch (error) {
        session.status = `Could not describe the avatar, so hair and eyes were not filled in. ${error?.message || ''}`.trim();
    }
}

function referenceGap(record, loaded) {
    if (loaded?.urls?.length) return null;
    if (loaded?.failure) {
        const name = record?.name || 'This character';
        return {
            referenceError: `Could not load ${name}'s avatar. ${loaded.failure.message} Nothing was requested.`,
            fix: null,
        };
    }
    const block = referenceBlock(record);
    return {
        referenceError: `${block.plain} ${block.fix}`,
        fix: { label: 'Upload a face still', act: block.act, key: record?.key || '' },
    };
}

async function memberReferenceUrls(member, record, records, scene) {
    const medium = projectMedium(liveSettings());
    const allowed = referenceMembers(scene, records, selectedMessages()).map((item) => item.key);
    let selection = selectJobReferences(null, { job: 'body', medium, cap: 4 });
    const sources = [...boardsForMember(record, records, allowed)];
    if (!sources.length && record) sources.push(record);
    for (const source of sources) {
        const outfitId = source === record ? (member?.outfitId || '') : '';
        const next = selectJobReferences(source, { job: 'body', medium, cap: 4, outfitId });
        if (next.images.length) {
            selection = next;
            break;
        }
    }
    if (!selection.images.length) {
        for (const source of familyReferences(record, records)) {
            const next = selectJobReferences(source, { job: 'body', medium, cap: 4 });
            if (next.images.length) {
                selection = next;
                break;
            }
        }
    }
    const labeled = selection.images.map((image) => ({ ...image, label: usedName(image, record) }));
    const loaded = await materializeList(labeled);
    return {
        ...loaded,
        warning: selection.warning,
        switchTo: selection.switchTo,
        used: selection.used,
        useNote: selection.useNote,
    };
}

async function sceneReferencePack(scene, records) {
    const members = referenceMembers(scene, records, selectedMessages());
    const medium = projectMedium(liveSettings());
    const people = members.map((member) => records.find((item) => item.key === member.key)).filter(Boolean);
    const selection = selectCastReferences(people, { job: 'scene', medium, cap: 4 });
    const chosen = [];
    for (const member of members) {
        const still = scene.memberStills?.[member.key];
        if (!still || chosen.some((image) => image.url === still)) continue;
        chosen.push({
            id: `still-${member.key}`,
            url: still,
            label: 'main picture',
            source: 'generated',
            tags: ['face'],
            identity: true,
        });
    }
    for (const image of selection.images) {
        if (chosen.length >= 4) break;
        const role = imageRole(image);
        if (chosen.some((item) => item.identity) && role !== 'outfit' && role !== 'style') continue;
        if (chosen.some((item) => item.id && item.id === image.id)) continue;
        chosen.push(image);
    }
    if (!chosen.length) {
        for (const image of selection.images) {
            if (chosen.length >= 4) break;
            if (!chosen.some((item) => item.id === image.id)) chosen.push(image);
        }
    }
    const owner = people[0];
    const labeled = chosen.map((image) => ({ ...image, label: image.label === 'main picture' ? 'main picture' : usedName(image, owner) }));
    const loaded = await materializeList(labeled);
    const noteRecord = owner || { mustKeep: '' };
    return {
        urls: loaded.urls,
        thumbs: loaded.thumbs,
        failure: loaded.failure,
        cast: members.length,
        warning: selection.warning,
        switchTo: selection.switchTo || '',
        used: usedLine(chosen, noteRecord),
        useNote: referenceUseNote(chosen, noteRecord),
    };
}

async function prepareKeyframePass(target, pass, records, settings, medium) {
    const { scene, index } = target;
    if (pass.kind === 'member') {
        const record = records.find((item) => item.key === pass.key);
        const member = (scene.cast || []).find((item) => item.key === pass.key) || { key: pass.key, name: pass.name, outfitId: pass.outfitId };
        const loaded = await memberReferenceUrls(member, record, records, scene);
        const gap = referenceGap(record || { name: pass.name }, loaded);
        if (loaded.urls[0]) await describeRecord(record, loaded.urls[0]);
        const prompt = appendUseNote(memberStillPrompt(member, record, outfitById(record, pass.outfitId), settings), loaded.useNote);
        const referenceImages = loaded.urls;
        const key = stillAssetKey({ prompt, modelId: settings.imageModel, medium, references: referenceImages });
        return {
            index,
            pass,
            key,
            cached: Boolean(scene.memberStills?.[pass.key] && scene.memberStillHashes?.[pass.key] === key),
            referenceError: gap?.referenceError || '',
            fix: gap?.fix || (loaded.switchTo ? { label: `Switch style to ${loaded.switchTo === 'anime' ? 'Anime' : 'Live action'}`, style: loaded.switchTo } : null),
            thumbs: loaded.thumbs,
            warning: loaded.warning || '',
            switchTo: loaded.switchTo || '',
            used: loaded.used || '',
            request: {
                prompt,
                referenceImages,
                label: pass.name || 'Outfit',
                settings,
                modelId: settings.imageModel,
            },
        };
    }
    const focused = { ...scene, cast: referenceMembers(scene, records, selectedMessages()) };
    const packed = await sceneReferencePack(scene, records);
    if (packed.urls[0]) {
        const first = focused.cast?.[0];
        const record = records.find((item) => item.key === first?.key);
        await describeRecord(record, packed.urls[0]);
    }
    const prompt = appendUseNote(composeKeyframePrompt({ scene: focused, settings, records, proposals: session.proposals }), packed.useNote);
    const referenceImages = packed.urls;
    const gap = packed.cast && !referenceImages.length ? referenceGap(focused.cast?.[0] ? records.find((item) => item.key === focused.cast[0].key) || { name: focused.cast[0].name } : { name: 'This character' }, packed) : null;
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
        referenceError: gap?.referenceError || '',
        fix: gap?.fix || (packed.switchTo ? { label: `Switch style to ${packed.switchTo === 'anime' ? 'Anime' : 'Live action'}`, style: packed.switchTo } : null),
        thumbs: packed.thumbs,
        warning: packed.warning || '',
        switchTo: packed.switchTo || '',
        used: packed.used || '',
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
    return generateReferenceImage(request);
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
            const focused = { ...target.scene, cast: referenceMembers(target.scene, records, selectedMessages()) };
            for (const pass of planKeyframeJob(focused, records)) {
                const prepared = await prepareKeyframePass(target, pass, records, settings, medium);
                planned.push(prepared);
            }
        }
        session.fix = null;
        const missing = planned.filter((item) => !item.cached);
        const blocked = missing.find((item) => item.referenceError);
        if (blocked) {
            session.fix = blocked.fix || null;
            fail(blocked.referenceError);
            return false;
        }
        const thumbs = [];
        for (const item of missing) {
            for (const thumb of item.thumbs || []) {
                if (!thumbs.some((entry) => entry.src === thumb.src)) thumbs.push(thumb);
            }
        }
        const warning = missing.find((item) => item.warning)?.warning || '';
        const switchTo = missing.find((item) => item.switchTo)?.switchTo || '';
        const cost = missing.length ? stillCost(missing.length, settings.imageModel) : { usd: 0, label: 'cached, $0', note: 'cached, $0' };
        const used = mergeUsedLines(missing.map((item) => item.used));
        if (missing.length && !(await confirmSpend({ ...cost, references: thumbs, warning, switchTo, used }, 'Keyframe stills'))) return false;
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
            settings.spentLedger = recordSpend(settings.spentLedger, { usd: cost.usd, label: 'Keyframe stills', sessionId: spendSessionId() });
            saveSettings(ctx());
        }
        const mock = targets.some(({ scene }) => scene.keyframeDataUrl && scene.keyframeMock);
        const next = ' Next: approve the still, then Make the animatic.';
        session.status = mock
            ? `Review the keyframes. This is a mock text card of the prompt, not a generated picture. Choose a picture model before a paid video.${next}`
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
            const headers = ctx()?.getRequestHeaders?.() || {};
            for (const image of collectReferenceImages(scene, records, { medium: projectMedium(settings), messages: selectedMessages() })) {
                const url = await materializeImage(image, globalThis.fetch, { headers });
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
                settings.spentLedger = recordSpend(settings.spentLedger, { usd: sceneQuote.usd, label: scene.title || `Scene ${index + 1}`, sessionId: spendSessionId() });
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
        if (session.error) session.status = 'Stopped. Finished scenes are in the result.';
        else markClipReady();
        showStep('review');
        if (!session.error && session.resultBlob) await revealFinishedVideo('Video ready');
    } catch (error) {
        session.clips = clips.map((clip) => clip.blob);
        const explained = formatFailure(error);
        if (!isAbortError(error) && (explained.banner || error?.banner)) {
            session.banner = explained.text;
            session.error = '';
            notifyError(session.banner);
        } else {
            session.banner = '';
            session.error = isAbortError(error)
                ? 'Cancelled. Any finished clips can be downloaded below.'
                : explained.text;
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
            const explained = formatFailure(error);
            session.error = explained.text || 'The job failed.';
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
    const empty = session.root.querySelector('#stsv-review-empty');
    const hasResult = hasMovie || session.clips.length > 0;
    if (empty) empty.hidden = hasResult;
    section.hidden = !hasResult;
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
        session.error = formatFailure(error).text || 'Could not load OpenRouter models.';
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

export function openCharacterPage(name) {
    openPanel();
    syncCastBoards();
    const settings = liveSettings();
    const records = Object.values(ensureLibrary(settings).records || {});
    const wanted = String(name || '').trim();
    const found = wanted
        ? (matchRecord(records, wanted, 'character') || matchRecord(records, wanted, 'persona') || matchRecord(records, wanted))
        : null;
    if (found) session.focusKey = found.key;
    else if (!session.focusKey) {
        const current = matchRecord(records, ctx()?.name2 || '', 'character') || matchRecord(records, ctx()?.name2 || '');
        if (current) session.focusKey = current.key;
    }
    session.scrollGuide = true;
    session.collapseLook = true;
    session.charLookOpen = false;
    showStep('cast');
}

function showStep(step) {
    const next = step || 'select';
    const collapseLook = next === 'cast' && session.collapseLook;
    session.step = next;
    session.root?.querySelectorAll('[data-step]').forEach((section) => {
        section.hidden = section.dataset.step !== next;
    });
    session.root?.querySelectorAll('[data-step-jump]').forEach((button) => {
        const on = button.dataset.stepJump === next;
        button.setAttribute('aria-current', on ? 'step' : 'false');
        button.classList.toggle('stsv-on', on);
    });
    if (next === 'cast') {
        const look = session.root?.querySelector('#stsv-look-settings');
        if (look) look.open = !collapseLook;
        renderPeople();
    }
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
    const scroller = host.closest('.stsv-body');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const pinGuide = session.scrollGuide;
    const collapseLook = session.collapseLook;
    const charLook = host.querySelector('#stsv-char-look');
    if (charLook && !collapseLook) session.charLookOpen = charLook.open;
    session.scrollGuide = false;
    session.collapseLook = false;
    if (active && host.contains(active) && typeof active.blur === 'function') active.blur();
    const open = new Set(session.openDetails || []);
    host.querySelectorAll('details[data-keep]').forEach((node) => {
        if (node.open) open.add(node.dataset.keep);
        else open.delete(node.dataset.keep);
    });
    session.openDetails = [...open];
    syncCastBoards();
    const model = boardModel(boardEnv());
    model.charLookOpen = collapseLook ? false : session.charLookOpen !== false;
    host.innerHTML = renderBoard(model);
    if (!scroller) return;
    const restore = () => {
        if (!scroller.isConnected) return;
        if (collapseLook) {
            const look = session.root?.querySelector('#stsv-look-settings');
            if (look) look.open = false;
        }
        if (!pinGuide) {
            scroller.scrollTop = scrollTop;
            return;
        }
        const target = host.querySelector('#stsv-jump-look') || host.querySelector('.stsv-guide');
        if (!target?.isConnected) return;
        const delta = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTop = Math.max(0, scroller.scrollTop + delta);
    };
    restore();
    requestAnimationFrame(() => {
        restore();
        requestAnimationFrame(restore);
    });
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
        setStyle: (style) => {
            const current = settings();
            if (!current) return;
            current.style = style === 'anime' ? 'anime' : 'live-action';
            saveSettings(context());
            syncSettingsForm();
            renderChrome();
        },
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
        animateStill: (args) => animatePosted(args),
        note: (message) => { session.status = message; session.error = ''; session.banner = ''; renderStatus(); },
        hold: (phase) => bindJob(phase, false),
        fail: (message) => fail(message),
        banner: (explained) => {
            session.banner = explained?.text || `${explained?.plain || ''} ${explained?.detail || ''} ${explained?.fix || ''}`.replace(/\s+/g, ' ').trim();
            session.error = '';
            renderStatus();
            if (session.banner) notifyError(session.banner);
        },
        download: (name, text, type) => downloadText(name, text, type),
        confirmSpend: (cost, label) => confirmSpend(cost, label),
        charge: (usd, label) => {
            const current = settings();
            current.spentLedger = recordSpend(current.spentLedger, { usd, label, sessionId: spendSessionId() });
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
                seed: request?.seed || '',
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
                seed: request?.seed || '',
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
        dayCap: audToUsd(settings?.dayCapAud),
        sessionCap: audToUsd(settings?.sessionCapAud),
        sessionId: spendSessionId(),
        confirmAbove: Number(settings?.confirmAbove) || 0,
        estimateUsd: cost?.usd,
        known: cost?.usd != null,
    });
    if (gate.blocked) {
        const settingsNow = liveSettings();
        const capAud = gate.capKind === 'session'
            ? settingsNow?.sessionCapAud
            : gate.capKind === 'day'
                ? settingsNow?.dayCapAud
                : settingsNow?.budgetCapAud;
        const projectedUsd = gate.capKind === 'session'
            ? gate.projectedSession
            : gate.capKind === 'day'
                ? gate.projectedDay
                : gate.projected;
        const quote = cost?.quote || cost?.label || '';
        const proceed = window.confirm(`${overCapMessage({ projectedUsd, capAud, kind: gate.capKind })} ${quote}`.trim());
        if (!proceed) {
            fail('Stopped so the spend stays inside your budget.');
            return false;
        }
        return true;
    }
    const references = Array.isArray(cost?.references) ? cost.references : [];
    const note = cost?.used || referenceSummary(references);
    const cached = cost?.label === 'cached, $0' || cost?.usd === 0;
    if (cached && !references.length && !cost?.warning) return true;
    if (cost?.confirmed && !references.length && !cost?.warning) return true;
    const needsPrice = gate.needsConfirm && !cached;
    if (!needsPrice && !references.length && !cost?.warning) return true;
    return askSpend({
        title: label || 'This still',
        price: cost?.quote || cost?.label || '',
        note,
        warning: cost?.warning || '',
        references,
        switchTo: cost?.switchTo || '',
        spend: spendLine(settings),
    });
}

function askSpend({ title, price, note, warning, references, switchTo, spend }) {
    const line = [title, price, spend].filter(Boolean).join('. ');
    if (typeof document === 'undefined') {
        return Promise.resolve(window.confirm([line, note, warning, 'Continue?'].filter(Boolean).join(' ')));
    }
    const host = document.createElement('div');
    host.className = 'stsv-confirm-pop';
    const figures = (references || []).map((ref) => `
        <figure><img src="${escapeAttr(ref.src)}" alt="${escapeAttr(ref.label || 'Reference')}"><figcaption>${escapeHtml(ref.label || 'Reference')}</figcaption></figure>
    `).join('');
    const switchLabel = switchTo === 'anime' ? 'Anime' : 'Live action';
    const switchButton = switchTo
        ? `<button type="button" data-switch="${escapeAttr(switchTo)}">Switch style to ${switchLabel}</button>`
        : '';
    host.innerHTML = `
        <div class="stsv-confirm-card" role="dialog" aria-modal="true">
            <p>${escapeHtml(line)}</p>
            ${note ? `<p>${escapeHtml(note)}</p>` : ''}
            ${warning ? `<p class="stsv-warn">${escapeHtml(warning)}</p>` : ''}
            <div class="stsv-confirm-refs">${figures}</div>
            <div class="stsv-row">
                <button type="button" class="stsv-primary" data-ok>Continue</button>
                ${switchButton}
                <button type="button" data-cancel>Cancel</button>
            </div>
        </div>`;
    (session.root || document.body).appendChild(host);
    return new Promise((resolve) => {
        const done = (value) => {
            host.remove();
            resolve(value);
        };
        host.querySelector('[data-ok]')?.addEventListener('click', () => done(true));
        host.querySelector('[data-cancel]')?.addEventListener('click', () => done(false));
        host.querySelector('[data-switch]')?.addEventListener('click', () => {
            const style = host.querySelector('[data-switch]')?.dataset.switch;
            const settings = liveSettings();
            if (settings && style) {
                settings.style = style;
                saveSettings(ctx());
                syncSettingsForm();
                renderChrome();
            }
            done(false);
        });
    });
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
        const settings = liveSettings();
        const track = musicForAnimatic({
            enabled: settings?.musicEnabled === true,
            library: settings?.audioLibrary,
            trackId: settings?.musicTrackId,
            tag: settings?.musicTag,
        });
        const blob = await recordAnimatic(planAnimatic(session.scenes), {
            signal: session.controller?.signal,
            audioUrl: track?.url || '',
        });
        rememberMovie(blob);
        const musicNote = settings?.musicEnabled
            ? (track ? `Track: ${track.name}.` : 'Music is on, but no track matched, so the animatic stays silent.')
            : 'Music is off.';
        markClipReady(`Animatic ready. Captions are on the picture. ${musicNote} Speak dialogue plays the lines. Tick Turn into video for any scene you want as real video.`);
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
            session.error = formatFailure(error).text || 'The job failed.';
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
        ? 'Stills are ready. They are mock text cards of the prompt, not generated pictures. Choose a picture model. Download any card from the storyboard. Video stays off.'
        : 'Stills are ready. Download any picture from the storyboard. Video stays off.';
    renderStatus();
}

async function animatePosted({ dataUrl, prompt, messageId, title } = {}) {
    if (session.running) return;
    const source = String(dataUrl || '').trim();
    if (!source) return fail('That still has no image to animate.');
    openPanel();
    const release = bindJob('video', false);
    if (!release) return;
    try {
        const settings = liveSettings();
        if (!settings) return fail('SillyTavern settings are not available.');
        const provider = getProvider(settings.provider);
        if (!provider?.supportsImage) {
            return fail('This provider cannot start from a still. Switch to one that accepts an image, then click Animate this still again.');
        }
        let image = source;
        if (!image.startsWith('data:image/')) {
            const response = await fetch(image);
            if (!response.ok) throw new Error('Could not read that still. Nothing was requested again.');
            image = await blobToDataUrl(await response.blob());
        }
        const scene = {
            title: title || 'Animated still',
            prompt: animatePrompt(prompt),
            negative_prompt: '',
            camera: '',
            duration: Number(settings.secondsPerScene) || 5,
            characters: [],
            cast: [],
            lines: messageId != null ? [{ messageId, speaker: '', text: title || 'Animated still' }] : [],
            keyframeDataUrl: image,
            keyframeApproved: true,
            keyframeMock: false,
            asVideo: true,
        };
        const quote = estimateCost({
            providerId: settings.provider,
            modelId: activeModelId(settings),
            resolution: settings.resolution,
            seconds: scene.duration,
            sceneCount: 1,
            modelInfo: session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel),
            customPerSecond: settings.custom?.costPerSecond,
            imageInputs: 1,
        });
        if (!(await confirmSpend(quote, 'Animate this still'))) return;
        if (!session.controller) session.controller = new AbortController();
        session.status = 'Animating this still…';
        session.error = '';
        session.banner = '';
        renderStatus();
        const call = buildVideoCall({
            scene,
            settings,
            records: Object.values(ensureLibrary(settings).records),
            proposals: [],
            providerId: provider.id,
            modelId: activeModelId(settings),
            manualStill: image,
            referenceUrls: [],
        });
        const blob = await provider.generate({
            prompt: call.prompt,
            negativePrompt: call.negativePrompt,
            duration: call.duration || scene.duration,
            aspectRatio: settings.aspectRatio,
            resolution: settings.resolution,
            fps: Number(settings.fps) || 24,
            steps: Number(settings.steps) || 20,
            seed: call.seed,
            imageDataUrl: image,
            referenceImages: [],
            disableSafetyChecker: Boolean(settings.disableSafetyChecker),
            generateAudio: false,
            modelId: activeModelId(settings),
            modelInfo: session.openRouterModels?.find((model) => model.id === settings.openrouterVideoModel),
            settings,
            signal: session.controller.signal,
            corsMode: settings.corsMode || 'auto',
            workflowText: settings.comfyWorkflow,
            onProgress: (info) => {
                session.status = info?.message || 'Animating this still…';
                renderStatus();
            },
            registerCancel: (fn) => { session.remoteCancel = fn; },
        });
        session.remoteCancel = null;
        rememberMovie(blob);
        const context = ctx();
        const ext = blob.type?.includes('webm') ? 'webm' : 'mp4';
        const filename = `thoughtform-animate-${Date.now()}.${ext}`;
        try {
            const uploaded = messageId != null
                ? await attachVideoToMessage(blob, { messageId, filename, context })
                : await attachVideoAsNewMessage(blob, { filename, context });
            if (uploaded?.path) {
                session.movieFile = uploaded.path;
                persistSession();
            }
        } catch {
            markClipReady();
        }
        if (quote.usd) {
            settings.spentLedger = recordSpend(settings.spentLedger, { usd: quote.usd, label: 'Animate this still', sessionId: spendSessionId() });
            saveSettings(ctx());
        }
        markClipReady();
        session.banner = '';
        showStep('review');
        toastReady('Video ready', messageId);
    } catch (error) {
        postError(error);
    } finally {
        release();
        renderResult();
        renderChrome();
    }
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
            markClipReady();
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
    const explained = formatFailure(error);
    const text = explained.text;
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
    const explained = formatFailure(message);
    if (explained.banner) {
        session.banner = explained.text;
        session.error = '';
        notifyError(session.banner);
    } else {
        const raw = typeof message === 'string' ? message : '';
        session.banner = '';
        session.error = raw && explained.plain === raw ? raw : explained.text;
        notifyError(session.error);
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
