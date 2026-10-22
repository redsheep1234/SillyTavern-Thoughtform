import { stillCost } from '../providers/image.js';
import { formatAudShort } from '../simple.js';
import { fillExpressionCopies } from '../expressions.js';
import { expressionCoverage, expressionListText, planReferenceSet, parseExpressionList, resolveSuiteExpressions, stNameFor, suiteQuote, turnaroundForPreset } from '../refset.js';
import { addImage, createBoard, linkPersonaBoard, materializeImage, recordWeight, removeImage } from '../library.js';
import { acceptProposal, addOutfit, applyProposalToScenes, discardProposal, outfitPreviewPrompt, removeOutfit } from '../wardrobe.js';
import { applyTraitEdit, approveReplacement, assignRelation, createRelatedCharacter, familyReferences, RELATIONS, remixDraft, replacementPrompt, TRAIT_FIELDS, updateOutfitText } from '../relations.js';
import { formatFailure } from '../debug.js';
import { featureBriefPrompt, imageBelongsTo, STYLE_MEDIA, styleFallbackNote, usableFeatureBrief, variantImageRequest } from '../variants.js';
import { exportBundle } from '../bundle.js';
import { ST_EXPRESSIONS, openSpriteSet, setFallbackExpression, spriteExportPlan } from '../sprites.js';
import {
    INSPIRATION_HINT,
    PHOTO_ROLES,
    appendUseNote,
    jobForTags,
    mergeUsedLines,
    roleLookNote,
    selectJobReferences,
    tagsForUploadRole,
    uploadRoleFromName,
    usedName,
} from '../inspiration.js';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
}

function domId(value) {
    return `stsv-${String(value).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

export function renderBoard(model) {
    const focus = focusBoard(model);
    const focusKey = focus?.key || '';
    const choices = boardChoices(model);
    const personas = model.personas
        .filter((persona) => model.boardFor(persona)?.key !== focusKey)
        .map((persona) => personaCard(persona, model)).join('');
    const characters = model.characters
        .filter((record) => record.key !== focusKey)
        .map((record) => boardCard(record, model, { badge: '' })).join('');
    const places = model.places.map((record) => boardCard(record, model, { badge: record.kind })).join('');
    const proposals = model.proposals.filter((item) => item.status !== 'discarded').map((item) => proposalCard(item)).join('');
    return `
        ${choices.length ? `<label>Whose board
            <select id="stsv-focus-board" name="stsv-focus-board" data-act="focus-board">
                ${choices.map((record) => `<option value="${escapeAttr(record.key)}" ${record.key === focusKey ? 'selected' : ''}>${escapeHtml(record.name)}</option>`).join('')}
            </select>
        </label>` : ''}
        ${focus ? guideCard(focus, model) : '<p class="stsv-empty">Open a chat and the character’s board will land here.</p>'}
        <details class="stsv-more-boards" data-keep="more" ${model.openDetails?.includes('more') ? 'open' : ''}>
            <summary>More boards</summary>
            <div class="stsv-people">
                <h4>Personas</h4>
                <p class="stsv-hint">Every SillyTavern persona has a reference board, an expression set, and a wardrobe. Link a persona to another board when two personas share a face. This chat attaches the badged persona whenever they appear in a shot.</p>
                ${personas || '<p class="stsv-empty">No other persona boards.</p>'}
                <button type="button" data-act="new-board">New shared board</button>
            </div>
            <div class="stsv-people">
                <h4>Characters</h4>
                ${characters || '<p class="stsv-empty">No other character boards.</p>'}
            </div>
            <div class="stsv-people">
                <h4>Locations and props</h4>
                <p class="stsv-hint">The shot list picks these up from lines like “at the bridge” or “holding the crane”, and from the model’s locations and props fields. They ride along into the stills.</p>
                <div class="stsv-row">
                    <label>Name <input id="stsv-place-name" name="stsv-place-name" data-form="place-name" type="text" value="${escapeAttr(model.placeName || '')}"></label>
                    <label>Kind
                        <select id="stsv-place-kind" name="stsv-place-kind" data-form="place-kind">
                            <option value="location" ${model.placeKind === 'prop' ? '' : 'selected'}>Location</option>
                            <option value="prop" ${model.placeKind === 'prop' ? 'selected' : ''}>Prop</option>
                        </select>
                    </label>
                    <button type="button" data-act="add-place">Add board</button>
                </div>
                ${places || '<p class="stsv-empty">No locations or props yet.</p>'}
            </div>
        </details>
        ${proposals ? `<div class="stsv-people"><h4>Proposed outfits</h4><p class="stsv-hint">Nothing here is saved until you approve it. Text only skips the still.</p>${proposals}</div>` : ''}
    `;
}

function boardChoices(model) {
    const people = [];
    for (const persona of model.personas || []) {
        const board = model.boardFor(persona);
        if (board) people.push(board);
    }
    for (const record of model.characters || []) people.push(record);
    const seen = new Set();
    return people.filter((record) => {
        if (!record?.key || seen.has(record.key) || record.kind === 'location' || record.kind === 'prop') return false;
        seen.add(record.key);
        return true;
    });
}

function focusBoard(model) {
    const choices = boardChoices(model);
    if (model.focusKey) {
        const chosen = choices.find((record) => record.key === model.focusKey);
        if (chosen) return chosen;
    }
    const named = model.activeName
        ? choices.find((record) => record.name === model.activeName || record.stName === model.activeName)
        : null;
    if (named) return named;
    return choices.find((record) => record.kind === 'character') || choices[0] || null;
}

function expressionNames(text) {
    return parseExpressionList(text)
        .map((item) => String(item.st || item.label || '').trim().toLowerCase())
        .filter(Boolean)
        .sort();
}

function sameExpressionNames(left, right) {
    const a = expressionNames(left);
    const b = expressionNames(right);
    return a.length === b.length && a.every((name, index) => name === b[index]);
}

function activeSuitePreset(model) {
    const stored = model?.suitePreset || 'quick';
    const text = String(model?.expressionList || '').trim();
    if (!text) return stored === 'full' ? 'full' : 'quick';
    if (sameExpressionNames(text, expressionListText('quick')) || sameExpressionNames(text, 'neutral\njoy\nsadness')) return 'quick';
    if (sameExpressionNames(text, expressionListText('full'))) return 'full';
    if (stored !== 'custom') return stored === 'full' ? 'full' : 'quick';
    return 'custom';
}

function suiteListText(model) {
    const preset = activeSuitePreset(model);
    if (preset === 'custom') return String(model?.expressionList || '').trim();
    return expressionListText(preset === 'full' ? 'full' : 'quick');
}

function suiteSize(preset) {
    return preset === 'full' ? 'full' : 'quick';
}

function fullExtraToggles(model) {
    const on = new Set(model?.expressionExtras || []);
    const boxes = [
        ['excitement', 'Excitement as its own picture'],
        ['disappointment', 'Disappointment as its own picture'],
        ['determined', 'Determined (extra, off by default)'],
        ['tired', 'Tired (extra, off by default)'],
    ];
    return `<div class="stsv-extras">${boxes.map(([id, label]) => `
        <label><input type="checkbox" data-act="suite-extra" data-extra="${id}" ${on.has(id) ? 'checked' : ''}> ${label}</label>
    `).join('')}</div>`;
}

function suiteExpressions(model) {
    const preset = activeSuitePreset(model);
    return resolveSuiteExpressions(suiteListText(model), {
        extras: model?.expressionExtras,
        full: preset === 'full',
    });
}

function suitePlan(model, record) {
    const preset = activeSuitePreset(model);
    return planReferenceSet({
        expressions: suiteExpressions(model),
        includeExpressions: true,
        includeTurnaround: true,
        includeCloseups: false,
        turnaround: turnaroundForPreset(suiteSize(preset)),
        appearance: record?.appearance || '',
    });
}

function expressionChecklist(record, text) {
    const names = parseExpressionList(text).map((item) => item.st || item.label);
    const rows = expressionCoverage(record, names);
    if (!rows.length) return '';
    return `<ul class="stsv-expr-done" id="stsv-expr-done">${rows.map((row) => (
        `<li class="${row.done ? 'stsv-done' : ''}">${escapeHtml(row.name)} <span>${row.done ? 'done' : 'not yet'}</span></li>`
    )).join('')}</ul>`;
}

function coverageCount(record) {
    const rows = expressionCoverage(record, ST_EXPRESSIONS);
    const done = rows.filter((row) => row.done).length;
    return `${done} of ${ST_EXPRESSIONS.length}`;
}

function taggedImages(record, tags) {
    return (record.images || []).filter((image) => {
        const list = image.tags || [];
        if (tags.includes('expression') && image.stLabel) return true;
        return tags.some((tag) => list.includes(tag));
    });
}

function stillFigure(image) {
    const src = image.dataUrl || image.url || '';
    const caption = stillCaption(image);
    return `
        <figure class="stsv-thumb">
            ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(caption)}">` : '<div class="stsv-ph">No preview</div>'}
            <figcaption>${escapeHtml(caption)}${image.copyOf ? ` <span class="stsv-copy">copy of ${escapeHtml(image.copyOf)}</span>` : ''}</figcaption>
        </figure>
    `;
}

function mainPicture(record) {
    const image = (record.images || []).find((item) => item.id === record.primaryId) || (record.images || [])[0];
    const src = image?.dataUrl || image?.url || '';
    if (!src) return '<div class="stsv-ph">No main picture yet</div>';
    return `<img src="${escapeAttr(src)}" alt="${escapeAttr(record.name || 'Main picture')}">`;
}

function usedMarkup(used, thumbs) {
    const pics = (thumbs || []).map((thumb) => (
        `<img class="stsv-used-thumb" src="${escapeAttr(thumb.src)}" alt="${escapeAttr(thumb.label || 'Reference')}">`
    )).join('');
    if (!used && !pics) return '';
    return `${used ? `<p class="stsv-used">${escapeHtml(used)}</p>` : ''}${pics ? `<div class="stsv-used-row">${pics}</div>` : ''}`;
}

function inspirationSection(record, model) {
    const photos = (record.images || []).filter((image) => image.source === 'inspiration');
    const cards = photos.map((image) => {
        const src = image.dataUrl || image.url || '';
        const chips = PHOTO_ROLES.map((role) => {
            const on = image.role === role.id;
            return `<button type="button" class="stsv-role${on ? ' stsv-on' : ''}" data-act="set-role" data-role="${role.id}" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}" aria-pressed="${on ? 'true' : 'false'}">${escapeHtml(role.label)}</button>`;
        }).join('');
        return `
            <figure class="stsv-thumb stsv-inspire-card">
                ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(image.label || 'Inspiration')}">` : '<div class="stsv-ph">No preview</div>'}
                <figcaption>${escapeHtml(image.label || 'Inspiration')}</figcaption>
                <div class="stsv-roles">${chips}</div>
                <label class="stsv-check"><input type="checkbox" data-act="set-identity" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}" ${image.identity === true ? 'checked' : ''}> Is this the character themself?</label>
            </figure>
        `;
    }).join('');
    const cost = model.roleNote ? `<p class="stsv-hint">${escapeHtml(model.roleNote)}</p>` : '';
    return `
        <section id="stsv-jump-inspire" class="stsv-inspire" data-key="${escapeAttr(record.key)}">
            <h4>Inspiration</h4>
            <p class="stsv-hint">${escapeHtml(INSPIRATION_HINT)}</p>
            ${cost}
            <label class="stsv-drop">Drop photos, paste, or choose files
                <input id="${domId(`inspire-${record.key}`)}" name="${domId(`inspire-${record.key}`)}" data-act="add-inspiration" data-key="${escapeAttr(record.key)}" type="file" accept="image/*" multiple>
            </label>
            ${cards ? `<div class="stsv-board-grid">${cards}</div>` : ''}
        </section>
    `;
}

function guideCard(record, model) {
    const preset = activeSuitePreset(model);
    const text = suiteListText(model);
    const quote = suiteQuote(suitePlan(model, record), model.imageModel);
    const studio = model.studio?.recordKey === record.key ? model.studio : null;
    const expressions = taggedImages(record, ['expression']);
    const turns = taggedImages(record, ['turnaround', 'pose']);
    const thumbs = (record.images || []).map((image) => imageCell(record, image, studio)).join('');
    const studioHtml = studio ? studioBlock(studio, model) : '';
    const pending = studio?.stage === 'results' ? pendingStudioCount(studio) : 0;
    const approveAll = pending
        ? `<button type="button" class="stsv-primary" data-act="approve-all">Approve all${pending > 1 ? ` (${pending})` : ''}</button>`
        : '';
    const pressed = (name) => (preset === name ? 'true' : 'false');
    const on = (name) => (preset === name ? ' stsv-on' : '');
    const exportButton = record.kind === 'character'
        ? `<button type="button" class="stsv-primary" data-act="export-sprites" data-key="${escapeAttr(record.key)}">Export to SillyTavern expressions</button>
           <button type="button" data-act="export-zip" data-key="${escapeAttr(record.key)}">Download expression zip</button>
           <p class="stsv-hint">Export to SillyTavern expressions uploads into the character’s sprite folder. Download expression zip saves the same names for you to copy in.</p>`
        : '<p class="stsv-hint">This persona board stays in Thoughtform. A character card can export its expressions to SillyTavern.</p>';
    return `
        <article class="stsv-card stsv-guide" data-key="${escapeAttr(record.key)}">
            <header id="stsv-jump-look" class="stsv-char-head">
                <figure>${mainPicture(record)}</figure>
                <div>
                    <h3>${escapeHtml(record.name)}</h3>
                    <label>Look
                        <textarea id="${domId(`look-${record.key}`)}" name="${domId(`look-${record.key}`)}" data-field="appearance" data-key="${escapeAttr(record.key)}" rows="3">${escapeHtml(record.appearance || '')}</textarea>
                    </label>
                    <label>Must keep <input id="${domId(`keep-${record.key}`)}" name="${domId(`keep-${record.key}`)}" data-field="mustKeep" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.mustKeep || '')}" placeholder="silver bob, amber eyes"></label>
                    <label>May change <input id="${domId(`change-${record.key}`)}" name="${domId(`change-${record.key}`)}" data-field="mayChange" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.mayChange || '')}" placeholder="outfit, pose"></label>
                    <button type="button" data-act="describe-look" data-key="${escapeAttr(record.key)}">Describe from picture</button>
                </div>
            </header>
            <nav class="stsv-jumps" aria-label="Character page">
                <button type="button" data-act="jump" data-target="stsv-jump-expressions">Expressions</button>
                <button type="button" data-act="jump" data-target="stsv-jump-turn">Turnaround</button>
                <button type="button" data-act="jump" data-target="stsv-jump-outfits">Outfits</button>
                <button type="button" data-act="jump" data-target="stsv-jump-inspire">Inspiration</button>
                <button type="button" data-act="jump" data-target="stsv-jump-board">All pictures</button>
                <button type="button" data-act="jump" data-target="stsv-jump-suite">Build suite</button>
                <button type="button" data-act="jump" data-target="stsv-jump-export">Export</button>
            </nav>
            <section id="stsv-jump-expressions">
                <h4>Expressions</h4>
                <p class="stsv-hint">${escapeHtml(coverageCount(record))}</p>
                ${expressions.length ? `<div class="stsv-board-grid">${expressions.map((image) => stillFigure(image)).join('')}</div>` : `<p class="stsv-empty">No expressions yet.</p><button type="button" data-act="build-set" data-key="${escapeAttr(record.key)}">Build suite</button>`}
            </section>
            <section id="stsv-jump-turn">
                <h4>Turnaround and poses</h4>
                ${turns.length ? `<div class="stsv-board-grid">${turns.map((image) => stillFigure(image)).join('')}</div>` : `<p class="stsv-empty">No turnaround yet.</p><button type="button" data-act="build-set" data-key="${escapeAttr(record.key)}">Build suite</button>`}
            </section>
            <section id="stsv-jump-outfits">
                <h4>Outfits</h4>
                ${wardrobeEditor(record, model)}
            </section>
            ${inspirationSection(record, model)}
            <section id="stsv-jump-board">
                <div class="stsv-board-head">
                    <h4>All pictures</h4>
                    ${approveAll}
                </div>
                ${studioHtml}
                <label class="stsv-file">Add a picture <input id="${domId(`file-${record.key}`)}" name="${domId(`file-${record.key}`)}" data-act="add-image" data-key="${escapeAttr(record.key)}" type="file" accept="image/*" multiple></label>
                <div class="stsv-board-grid">${thumbs || '<p class="stsv-empty">No pictures yet.</p><button type="button" data-act="build-set" data-key="' + escapeAttr(record.key) + '">Build suite</button>'}</div>
            </section>
            <section id="stsv-jump-suite">
                <h4>Build suite</h4>
                <div class="stsv-qualities" role="radiogroup" aria-label="Suite size">
                    <button type="button" class="${on('quick').trim()}" data-act="suite-preset" data-preset="quick" aria-pressed="${pressed('quick')}">Quick</button>
                    <button type="button" class="${on('full').trim()}" data-act="suite-preset" data-preset="full" aria-pressed="${pressed('full')}">Full</button>
                    <button type="button" class="${on('custom').trim()}" data-act="suite-preset" data-preset="custom" aria-pressed="${pressed('custom')}">Custom</button>
                </div>
                <p class="stsv-hint">Quick is neutral, joy, sadness, and anger, plus front, side, and back. Full is all 28 SillyTavern expressions. Near-duplicates are free copies. Determined and tired stay off unless you tick them.</p>
                ${preset === 'full' ? fullExtraToggles(model) : ''}
                <label>Expressions, one per line. Names match SillyTavern.
                    <textarea id="stsv-expression-list" name="stsv-expression-list" data-suite="1" rows="4">${escapeHtml(text)}</textarea>
                </label>
                ${expressionChecklist(record, text)}
                <p id="stsv-suite-quote">${escapeHtml(quote)}</p>
                <button type="button" class="stsv-primary" data-act="build-set" data-key="${escapeAttr(record.key)}">Build suite</button>
            </section>
            <p class="stsv-hint">Approve or re-roll each new still on its card. Nothing replaces the old picture until you choose Use new.</p>
            <section id="stsv-jump-export">
                <h4>Export</h4>
                ${exportButton}
            </section>
            <details data-keep="advanced" ${model.openDetails?.includes('advanced') ? 'open' : ''}>
                <summary>Style variants and advanced</summary>
                ${boardBody(record, model, '', 'advanced')}
            </details>
        </article>
    `;
}

function wardrobeEditor(record, model) {
    const form = model.forms?.[record.key] || {};
    const outfits = record.outfits || [];
    const outfitOptions = outfits.map((outfit) => (
        `<option value="${escapeAttr(outfit.id)}" ${record.defaultOutfitId === outfit.id ? 'selected' : ''}>${escapeHtml(outfit.name)}</option>`
    )).join('');
    const list = outfits.map((outfit) => `
        <div class="stsv-outfit">
            <strong>${escapeHtml(outfit.name)}</strong>
            <label>Clothes
                <textarea id="${domId(`outfit-text-${record.key}-${outfit.id}`)}" name="${domId(`outfit-text-${record.key}-${outfit.id}`)}" data-outfit-text="${escapeAttr(outfit.id)}" data-key="${escapeAttr(record.key)}" rows="2">${escapeHtml(outfit.description || '')}</textarea>
            </label>
            <div class="stsv-row">
                <button type="button" data-act="redo-outfit" data-key="${escapeAttr(record.key)}" data-outfit="${escapeAttr(outfit.id)}" title="Redraws only this outfit. The board changes only if you choose Use new.">Redo this outfit</button>
                <button type="button" data-act="delete-outfit" data-key="${escapeAttr(record.key)}" data-outfit="${escapeAttr(outfit.id)}">Delete</button>
            </div>
            ${outfitRedo(model.studio, outfit)}
        </div>
    `).join('');
    return `
        <div class="stsv-wardrobe">
            ${list || '<p class="stsv-empty">No outfits yet. Describe the clothes, then preview them.</p>'}
            ${outfits.length ? `<label>Default outfit
                <select id="${domId(`outfit-${record.key}`)}" name="${domId(`outfit-${record.key}`)}" data-act="default-outfit" data-key="${escapeAttr(record.key)}">
                    <option value="">Card clothes</option>
                    ${outfitOptions}
                </select>
            </label>` : `<select id="${domId(`outfit-${record.key}`)}" name="${domId(`outfit-${record.key}`)}" data-act="default-outfit" data-key="${escapeAttr(record.key)}" hidden><option value="">Card clothes</option></select>`}
            <label>New outfit <input id="${domId(`oname-${record.key}`)}" name="${domId(`oname-${record.key}`)}" data-form="outfitName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(form.outfitName || '')}"></label>
            <label>Clothes
                <textarea id="${domId(`odesc-${record.key}`)}" name="${domId(`odesc-${record.key}`)}" data-form="outfitDescription" data-key="${escapeAttr(record.key)}" rows="2">${escapeHtml(form.outfitDescription || '')}</textarea>
            </label>
            <label class="stsv-file">Clothing photo <input id="${domId(`ocloth-${record.key}`)}" name="${domId(`ocloth-${record.key}`)}" data-act="clothing" data-key="${escapeAttr(record.key)}" type="file" accept="image/*"></label>
            <p class="stsv-hint">Preview ${escapeHtml(stillCost(1, model.imageModel).label)}. You approve it before it is saved.</p>
            <button type="button" data-act="preview-outfit" data-key="${escapeAttr(record.key)}">Generate outfit preview</button>
        </div>
    `;
}

function personaCard(persona, model) {
    const record = model.boardFor(persona);
    const active = persona.id === model.chatPersonaId;
    const own = `persona:${persona.id}`;
    const linked = model.links[persona.id] || '';
    const options = model.allBoards.map((board) => (
        `<option value="${escapeAttr(board.key)}" ${board.key === linked ? 'selected' : ''}>${escapeHtml(board.name)} (${board.kind})</option>`
    )).join('');
    return `
        <article class="stsv-card" data-persona-id="${escapeAttr(persona.id)}">
            <header class="stsv-card-head">
                <strong>${escapeHtml(persona.name)}</strong>
                ${persona.active ? '<span class="stsv-pill">Active in SillyTavern</span>' : ''}
                ${active ? '<span class="stsv-pill">This chat</span>' : ''}
                <button type="button" data-act="use-persona" data-persona="${escapeAttr(persona.id)}">Use for this chat</button>
            </header>
            <label>Board
                <select id="${domId(`link-${persona.id}`)}" name="${domId(`link-${persona.id}`)}" data-act="link-board" data-persona="${escapeAttr(persona.id)}">
                    <option value="" ${linked ? '' : 'selected'}>This persona’s own board</option>
                    ${options}
                </select>
            </label>
            ${linked && linked !== own ? `<p class="stsv-hint">Linked. Edits below change “${escapeHtml(record?.name || 'board')}”, shared with anyone else on that board.</p>` : ''}
            ${record ? boardBody(record, model) : ''}
        </article>
    `;
}

function boardCard(record, model, { badge }) {
    return `<article class="stsv-card" data-key="${escapeAttr(record.key)}">${boardBody(record, model, badge)}</article>`;
}

function boardBody(record, model, badge = '', mode = 'full') {
    const weight = recordWeight(record);
    const images = (record.images || []).map((image) => imageCell(record, image, model.studio)).join('');
    const outfitOptions = (record.outfits || []).map((outfit) => (
        `<option value="${escapeAttr(outfit.id)}" ${record.defaultOutfitId === outfit.id ? 'selected' : ''}>${escapeHtml(outfit.name)}</option>`
    )).join('');
    const human = record.kind === 'character' || record.kind === 'persona' || record.kind === 'board';
    const form = model.forms[record.key] || {};
    const studio = mode === 'full' && model.studio?.recordKey === record.key ? studioBlock(model.studio, model) : '';
    if (mode === 'advanced') {
        return `
            ${relatedEditor(record, model)}
            ${human ? `
                <div class="stsv-row">
                    <label>Related
                        <select id="${domId(`rel-${record.key}`)}" name="${domId(`rel-${record.key}`)}" data-form="relation" data-key="${escapeAttr(record.key)}">
                            ${RELATIONS.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('')}
                        </select>
                    </label>
                    <label>Name <input id="${domId(`relname-${record.key}`)}" name="${domId(`relname-${record.key}`)}" data-form="relatedName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(form.relatedName || '')}" placeholder="Mother of ${escapeAttr(record.name)}"></label>
                    <button type="button" data-act="related" data-key="${escapeAttr(record.key)}">Create related character</button>
                </div>
                ${styleSets(record, model)}
                <details>
                    <summary>LoRA (optional)</summary>
                    <p class="stsv-hint">LoRAs drift. The board is what keeps a face. A name here is written only if your ComfyUI workflow already has a LoraLoader node.</p>
                    <label>File name <input id="${domId(`lora-${record.key}`)}" name="${domId(`lora-${record.key}`)}" data-field="loraName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.loraName || '')}"></label>
                    <label>Strength <input id="${domId(`loras-${record.key}`)}" name="${domId(`loras-${record.key}`)}" data-field="loraStrength" data-key="${escapeAttr(record.key)}" type="number" min="0" max="2" step="0.05" value="${Number(record.loraStrength ?? 0.8)}"></label>
                </details>
            ` : `<div class="stsv-board-grid">${images || '<p class="stsv-empty">No stills yet.</p>'}</div>`}
        `;
    }
    return `
        <header class="stsv-card-head">
            <strong>${escapeHtml(record.name)}</strong>
            ${badge ? `<span class="stsv-pill">${escapeHtml(badge)}</span>` : ''}
            ${model.voiceFor?.(record.name) ? `<span class="stsv-pill">Voice ${escapeHtml(model.voiceFor(record.name))}</span>` : ''}
        </header>
        <label>Appearance
            <textarea id="${domId(`look-${record.key}`)}" name="${domId(`look-${record.key}`)}" data-field="appearance" data-key="${escapeAttr(record.key)}" rows="3">${escapeHtml(record.appearance || '')}</textarea>
        </label>
        <label>Must keep <input id="${domId(`keep-${record.key}`)}" name="${domId(`keep-${record.key}`)}" data-field="mustKeep" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.mustKeep || '')}" placeholder="silver bob, amber eyes"></label>
        <label>May change <input id="${domId(`change-${record.key}`)}" name="${domId(`change-${record.key}`)}" data-field="mayChange" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.mayChange || '')}" placeholder="outfit, pose"></label>
        ${relatedEditor(record, model)}
        <div class="stsv-row">
            <button type="button" data-act="extract" data-key="${escapeAttr(record.key)}">Write appearance</button>
            <button type="button" data-act="build-set" data-key="${escapeAttr(record.key)}">Build suite</button>
            <label class="stsv-file">Add image <input id="${domId(`file-${record.key}`)}" name="${domId(`file-${record.key}`)}" data-act="add-image" data-key="${escapeAttr(record.key)}" type="file" accept="image/*"></label>
            <button type="button" data-act="export-json" data-key="${escapeAttr(record.key)}">Export JSON</button>
            <label class="stsv-file">Import <input id="${domId(`import-${record.key}`)}" name="${domId(`import-${record.key}`)}" data-act="import-json" data-key="${escapeAttr(record.key)}" type="file" accept="application/json,.json"></label>
            ${record.kind === 'character' ? `<button type="button" data-act="export-sprites" data-key="${escapeAttr(record.key)}">Export to SillyTavern expressions</button><button type="button" data-act="export-zip" data-key="${escapeAttr(record.key)}">Download expression zip</button><p class="stsv-hint">Export to SillyTavern expressions uploads into the character’s sprite folder. Download expression zip saves the same names for you to copy in.</p>` : ''}
        </div>
        ${human ? `
            <div class="stsv-row">
                <label>Related
                    <select id="${domId(`rel-${record.key}`)}" name="${domId(`rel-${record.key}`)}" data-form="relation" data-key="${escapeAttr(record.key)}">
                        ${RELATIONS.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('')}
                    </select>
                </label>
                <label>Name <input id="${domId(`relname-${record.key}`)}" name="${domId(`relname-${record.key}`)}" data-form="relatedName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(form.relatedName || '')}" placeholder="Mother of ${escapeAttr(record.name)}"></label>
                <button type="button" data-act="related" data-key="${escapeAttr(record.key)}">Create related character</button>
            </div>
            <p class="stsv-hint">The new board keeps this character’s features and sends this board as style and family-resemblance references.</p>
        ` : ''}
        ${weight > 2000000 ? '<p class="stsv-warn">This board is over 2MB. SillyTavern stores it in settings.json.</p>' : ''}
        ${human ? styleSets(record, model) : `<div class="stsv-board-grid">${images || '<p class="stsv-empty">No stills yet. Build a reference set or add an image.</p>'}</div>`}
        ${human ? `
            <label>Default outfit
                <select id="${domId(`outfit-${record.key}`)}" name="${domId(`outfit-${record.key}`)}" data-act="default-outfit" data-key="${escapeAttr(record.key)}">
                    <option value="">Card clothes</option>
                    ${outfitOptions}
                </select>
            </label>
            <div class="stsv-wardrobe">
                <h4>Wardrobe</h4>
                ${(record.outfits || []).map((outfit) => `
                    <div class="stsv-outfit">
                        <strong>${escapeHtml(outfit.name)}</strong>
                        <label>Clothes
                            <textarea id="${domId(`outfit-text-${record.key}-${outfit.id}`)}" name="${domId(`outfit-text-${record.key}-${outfit.id}`)}" data-outfit-text="${escapeAttr(outfit.id)}" data-key="${escapeAttr(record.key)}" rows="2">${escapeHtml(outfit.description || '')}</textarea>
                        </label>
                        <div class="stsv-row">
                            <button type="button" data-act="redo-outfit" data-key="${escapeAttr(record.key)}" data-outfit="${escapeAttr(outfit.id)}" title="Redraws only this outfit. The board changes only if you choose Use new.">Redo this outfit</button>
                            <button type="button" data-act="delete-outfit" data-key="${escapeAttr(record.key)}" data-outfit="${escapeAttr(outfit.id)}">Delete</button>
                        </div>
                        ${outfitRedo(model.studio, outfit)}
                    </div>
                `).join('') || '<p class="stsv-empty">No outfits yet.</p>'}
                <label>New outfit <input id="${domId(`oname-${record.key}`)}" name="${domId(`oname-${record.key}`)}" data-form="outfitName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(form.outfitName || '')}"></label>
                <label>Clothes
                    <textarea id="${domId(`odesc-${record.key}`)}" name="${domId(`odesc-${record.key}`)}" data-form="outfitDescription" data-key="${escapeAttr(record.key)}" rows="2">${escapeHtml(form.outfitDescription || '')}</textarea>
                </label>
                <label class="stsv-file">Clothing photo <input id="${domId(`ocloth-${record.key}`)}" name="${domId(`ocloth-${record.key}`)}" data-act="clothing" data-key="${escapeAttr(record.key)}" type="file" accept="image/*"></label>
                <p class="stsv-hint">Preview ${escapeHtml(stillCost(1, model.imageModel).label)}. ${escapeHtml(stillCost(1, model.imageModel).note)} You approve it before it is saved.</p>
                <button type="button" data-act="preview-outfit" data-key="${escapeAttr(record.key)}">Generate outfit preview</button>
            </div>
            <details>
                <summary>LoRA (optional)</summary>
                <p class="stsv-hint">LoRAs drift. The board is the consistency tool. A name here is written only if your ComfyUI workflow already has a LoraLoader node.</p>
                <label>File name <input id="${domId(`lora-${record.key}`)}" name="${domId(`lora-${record.key}`)}" data-field="loraName" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.loraName || '')}"></label>
                <label>Strength <input id="${domId(`loras-${record.key}`)}" name="${domId(`loras-${record.key}`)}" data-field="loraStrength" data-key="${escapeAttr(record.key)}" type="number" min="0" max="2" step="0.05" value="${Number(record.loraStrength ?? 0.8)}"></label>
            </details>
        ` : ''}
        ${studio}
    `;
}

function styleSets(record, model) {
    const project = model.medium?.() || '';
    const filed = record.sourceMedium || '';
    const unfiled = (record.images || []).filter((image) => !image.medium && !filed);
    const blocks = STYLE_MEDIA.map((medium) => {
        const stills = (record.images || []).filter((image) => imageBelongsTo(image, medium.id, filed));
        const active = project === medium.id ? ' <span class="stsv-pill">This project</span>' : '';
        const phrase = medium.id === 'anime' ? 'an anime avatar' : 'a live-action avatar';
        return `
            <h4>${escapeHtml(medium.label)}${active}</h4>
            <div class="stsv-board-grid">${stills.length ? stills.map((image) => imageCell(record, image, model.studio)).join('') : `<p class="stsv-empty">No ${escapeHtml(medium.label.toLowerCase())} stills yet.</p>`}</div>
            <button type="button" data-act="variant" data-key="${escapeAttr(record.key)}" data-medium="${medium.id}">Generate ${phrase}</button>
        `;
    }).join('');
    const note = styleFallbackNote(record, project);
    const switchLabel = note.switchTo === 'anime' ? 'Anime' : 'Live action';
    const warn = note.text
        ? `<p class="stsv-warn">${escapeHtml(note.text)} <button type="button" data-act="switch-style" data-style="${escapeAttr(note.switchTo)}">Switch style to ${switchLabel}</button></p>`
        : '';
    return `
        <div class="stsv-variants">
            <label>These stills are
                <select id="${domId(`srcmed-${record.key}`)}" name="${domId(`srcmed-${record.key}`)}" data-act="source-medium" data-key="${escapeAttr(record.key)}">
                    <option value="" ${filed ? '' : 'selected'}>Not filed</option>
                    <option value="anime" ${filed === 'anime' ? 'selected' : ''}>Anime</option>
                    <option value="live-action" ${filed === 'live-action' ? 'selected' : ''}>Live action</option>
                </select>
            </label>
            <p class="stsv-hint">Generate a style variant from a written description, with no picture reference. Approving it saves that avatar on its own set. Later outfits, keyframes, and video follow the project style and use only that set.</p>
            ${warn}
            ${blocks}
            ${unfiled.length ? `<h4>Not filed</h4><div class="stsv-board-grid">${unfiled.map((image) => imageCell(record, image, model.studio)).join('')}</div>` : ''}
        </div>
    `;
}

function stillCaption(image) {
    if (image?.stLabel) return image.stLabel;
    const mapped = stNameFor(image?.label);
    return mapped || image?.label || 'Still';
}

function imageApproved(image) {
    return image?.approved === true || image?.source === 'generated';
}

function imageCell(record, image, studio) {
    const src = image.dataUrl || image.url || '';
    const medium = image.medium || record.sourceMedium || '';
    const primary = record.primaryId === image.id || (medium && record.variantPrimary?.[medium] === image.id);
    const portrait = (image.tags || []).includes('expression') || image.aspectRatio === '3:4';
    const inline = studio?.stage === 'replace' && studio.imageId === image.id && !studio.outfitId;
    const caption = stillCaption(image);
    return `
        <figure class="stsv-thumb${portrait ? ' stsv-portrait' : ''}${inline ? ' stsv-active' : ''}" data-image="${escapeAttr(image.id)}">
            ${imageApproved(image) ? '<span class="stsv-pill stsv-approved-badge">Approved</span>' : ''}
            ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(caption)}">` : '<div class="stsv-ph">No preview</div>'}
            <figcaption>${escapeHtml(caption)}${image.copyOf ? ` <span class="stsv-copy">copy of ${escapeHtml(image.copyOf)}</span>` : ''}</figcaption>
                <div class="stsv-row">
                ${imageApproved(image) ? '' : `<button type="button" data-act="approve-image" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}">Approve</button>`}
                <button type="button" class="stsv-star${primary ? ' stsv-on' : ''}" data-act="primary" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}" title="Main picture" aria-label="Main picture" aria-pressed="${primary ? 'true' : 'false'}">${primary ? '★' : '☆'}</button>
                <button type="button" data-act="redo-still" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}" title="Redraws only this still. An expression is a portrait. The board changes only if you choose Use new.">Redo</button>
                <div class="stsv-card-menu">
                    <button type="button" data-act="card-menu" aria-expanded="false" aria-haspopup="true">More</button>
                    <div class="stsv-card-menu-pop" hidden>
                        ${src ? `<button type="button" data-act="animate-image" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}">Animate this still</button>` : ''}
                        <label class="stsv-file">Replace file <input id="${domId(`replace-${record.key}-${image.id}`)}" name="${domId(`replace-${record.key}-${image.id}`)}" data-act="stage-replace" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}" type="file" accept="image/*"></label>
                        <button type="button" data-act="delete-image" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}">Delete</button>
                    </div>
                </div>
            </div>
            ${inline ? redoPanel(studio) : ''}
        </figure>
    `;
}

function pendingStudioCount(studio) {
    return (studio?.items || []).filter((item) => !item.dropped && item.dataUrl && !item.approved).length;
}

function outfitRedo(studio, outfit) {
    if (studio?.stage !== 'replace' || studio.outfitId !== outfit?.id) return '';
    return redoPanel(studio);
}

function redoPanel(studio) {
    const item = studio?.items?.[0] || {};
    const busy = Boolean(studio?.busy) && !item.dataUrl && !item.error;
    const price = studio?.charge || studio?.quoted || '';
    const charge = item.dataUrl && price
        ? `<p class="stsv-charge">Charged ${escapeHtml(price)}</p>`
        : (item.error
            ? '<p class="stsv-charge">Not charged.</p>'
            : (price ? `<p class="stsv-charge">About ${escapeHtml(price)}</p>` : ''));
    const current = studio?.previousDataUrl
        ? `<figure><img src="${escapeAttr(studio.previousDataUrl)}" alt="Current still"><figcaption>Current</figcaption></figure>`
        : '';
    const fresh = item.dataUrl
        ? `<figure><img src="${escapeAttr(item.dataUrl)}" alt="New still"><figcaption>New</figcaption></figure>`
        : '';
    const body = busy
        ? `<p class="stsv-busy">Redrawing ${escapeHtml(item.label || 'still')}…</p>`
        : `<div class="stsv-redo-pair">${current}${fresh}</div>${item.error ? `<p class="stsv-error">${escapeHtml(item.error)}</p>` : ''}`;
    return `
        <div class="stsv-redo${studio?.aspectRatio === '3:4' ? ' stsv-redo-portrait' : ''}" data-image="${escapeAttr(studio?.imageId || '')}" data-outfit="${escapeAttr(studio?.outfitId || '')}" tabindex="-1" aria-busy="${busy ? 'true' : 'false'}">
            ${body}
            ${charge}
            ${usedMarkup(studio?.used, studio?.thumbs)}
            <div class="stsv-row">
                ${item.dataUrl ? '<button type="button" class="stsv-primary" data-act="approve-staged">Use new</button>' : ''}
                <button type="button" data-act="close-studio">Keep current</button>
            </div>
        </div>
    `;
}

function relatedEditor(record, model) {
    if (!record.sourceKey) return '';
    const parent = (model.allBoards || []).find((item) => item.key === record.sourceKey);
    const traits = record.traits || {};
    const lead = parent
        ? `Related to ${parent.name}. Edits stay on this board. ${parent.name} does not change.`
        : 'The original character is gone. This board keeps its own description. Remix uses that description.';
    return `
        <div class="stsv-related">
            <p class="stsv-hint">${escapeHtml(lead)}</p>
            <label>Name <input id="${domId(`name-${record.key}`)}" name="${domId(`name-${record.key}`)}" data-field="name" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(record.name || '')}"></label>
            <label>Relationship
                <select id="${domId(`relation-${record.key}`)}" name="${domId(`relation-${record.key}`)}" data-act="set-relation" data-key="${escapeAttr(record.key)}">
                    ${RELATIONS.map((item) => `<option value="${item.id}" ${record.relation === item.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
                </select>
            </label>
            <div class="stsv-grid">
                ${TRAIT_FIELDS.map((field) => `
                    <label>${escapeHtml(field.label)}
                        <input id="${domId(`trait-${field.id}-${record.key}`)}" name="${domId(`trait-${field.id}-${record.key}`)}" data-trait="${field.id}" data-key="${escapeAttr(record.key)}" type="text" value="${escapeAttr(traits[field.id] || '')}" placeholder="Blank removes it">
                    </label>
                `).join('')}
            </div>
            <div class="stsv-row">
                <button type="button" data-act="regen-avatar" data-key="${escapeAttr(record.key)}">Regenerate avatar from this description</button>
                <button type="button" data-act="remix" data-key="${escapeAttr(record.key)}">Remix</button>
            </div>
            <p class="stsv-hint">Remix draws a new still from the original character using the traits above. Current stills stay until you approve the new one. Redo or Replace on a single expression, turnaround, or outfit leaves the rest of the board alone.</p>
        </div>
    `;
}

function blockedStudio(studio) {
    const block = studio.block || {};
    const button = block.act === 'upload-face'
        ? `<button type="button" data-act="upload-face" data-key="${escapeAttr(studio.recordKey || '')}">Upload a face still</button>`
        : (block.switchTo
            ? `<button type="button" data-act="switch-style" data-style="${escapeAttr(block.switchTo)}">Switch style to ${block.switchTo === 'anime' ? 'Anime' : 'Live action'}</button>`
            : '');
    return `<div class="stsv-studio"><p class="stsv-warn">${escapeHtml(block.plain || '')} ${escapeHtml(block.fix || '')}</p><div class="stsv-row">${button}<button type="button" data-act="close-studio">Close</button></div></div>`;
}

function studioBlock(studio, model) {
    if (studio.stage === 'blocked') return blockedStudio(studio);
    if ((studio.stage === 'replace') && (studio.imageId || studio.outfitId)) return '';
    if (studio.stage === 'replace' || studio.stage === 'remix') {
        const item = (studio.items || [])[0] || {};
        const title = studio.stage === 'remix' ? 'Remix' : (item.label || 'New still');
        const current = studio.previousDataUrl
            ? `<figure class="stsv-thumb"><img src="${escapeAttr(studio.previousDataUrl)}" alt="Current still"><figcaption>Current</figcaption></figure>`
            : '';
        const candidate = item.dataUrl
            ? `<figure class="stsv-thumb"><img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(title)}"><figcaption>New</figcaption></figure>`
            : (item.error ? `<p class="stsv-error">${escapeHtml(item.error)}</p>` : (studio.busy ? '<p class="stsv-busy">Redrawing…</p>' : ''));
        return `
            <div class="stsv-studio" tabindex="-1">
                <h4>${escapeHtml(title)}</h4>
                <p class="stsv-hint">Nothing on the board changes until you choose Use new.</p>
                <div class="stsv-board-grid">${current}${candidate}</div>
                <label>Prompt <textarea id="stsv-replace-prompt" name="stsv-replace-prompt" data-item-prompt="0" rows="4">${escapeHtml(item.prompt || '')}</textarea></label>
                ${item.dataUrl || studio.busy ? '' : `<button type="button" data-act="${studio.stage === 'remix' ? 'run-remix' : 'run-replace'}">Generate this still</button>`}
                ${item.dataUrl ? '<button type="button" class="stsv-primary" data-act="approve-staged">Use new</button>' : ''}
                <button type="button" data-act="close-studio">Keep current</button>
            </div>
        `;
    }
    if (studio.stage === 'variant') {
        const label = studio.medium === 'anime' ? 'Anime' : 'Live action';
        const item = (studio.items || []).find((entry) => !entry.dropped);
        return `
            <div class="stsv-studio">
                <h4>${label} avatar</h4>
                <p class="stsv-hint">This still is generated from the description only. Pictures from the other style are not sent.</p>
                <label>Features
                    <textarea id="stsv-variant-text" name="stsv-variant-text" data-variant-description rows="5">${escapeHtml(studio.description || '')}</textarea>
                </label>
                <button type="button" data-act="run-variant">Generate avatar from text</button>
                ${item ? `
                    <figure class="stsv-thumb">
                        ${item.dataUrl ? `<img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(label)} avatar">` : `<div class="stsv-ph">${item.error ? escapeHtml(item.error) : 'Working…'}</div>`}
                        <figcaption>${escapeHtml(item.label || label)}</figcaption>
                        <div class="stsv-row">
                            ${item.dataUrl && !item.approved ? '<button type="button" data-act="approve-item" data-item="0">Approve</button>' : ''}
                            ${item.dataUrl ? '<button type="button" data-act="reroll-item" data-item="0">Redo</button>' : ''}
                        </div>
                    </figure>
                ` : ''}
                <button type="button" data-act="close-studio">Close</button>
            </div>
        `;
    }
    if (studio.stage === 'options') {
        const optionPlan = planReferenceSet({
            expressions: resolveSuiteExpressions(studio.expressionText, {
                extras: model.expressionExtras,
                full: activeSuitePreset(model) === 'full',
            }),
            includeExpressions: studio.includeExpressions,
            includeTurnaround: studio.includeTurnaround,
            includeCloseups: studio.includeCloseups,
            outfit: studio.outfit,
            turnaround: studio.turnaround || turnaroundForPreset(suiteSize(activeSuitePreset(model))),
        });
        const optionQuote = suiteQuote(optionPlan, model.imageModel);
        const optionCost = stillCost(optionPlan.filter((item) => !item.copyOf).length, model.imageModel);
        return `
            <div class="stsv-studio">
                <h4>${studio.outfit ? `Reference set · ${escapeHtml(studio.outfit.name)}` : 'Reference set'}</h4>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeExpressions" ${studio.includeExpressions ? 'checked' : ''}> Expressions</label>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeTurnaround" ${studio.includeTurnaround ? 'checked' : ''}> Turnaround and poses</label>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeCloseups" ${studio.includeCloseups ? 'checked' : ''}> Face close-ups</label>
                <label>Expressions, one per line
                    <textarea id="stsv-expression-list" name="stsv-expression-list" data-form="expressionText" rows="3">${escapeHtml(studio.expressionText || '')}</textarea>
                </label>
                <p class="stsv-hint">${escapeHtml(optionQuote)}. ${escapeHtml(optionCost.note)}</p>
                <button type="button" data-act="run-set">Run reference set</button>
                <button type="button" data-act="close-studio">Close</button>
            </div>
        `;
    }
    const visible = (studio.items || []).map((item, index) => ({ item, index })).filter(({ item }) => !item.dropped);
    const done = visible.filter(({ item }) => item.dataUrl || item.error || item.skipped).length;
    const total = visible.length;
    const width = total ? Math.round((100 * done) / total) : 0;
    const items = visible.map(({ item, index }) => `
        <figure class="stsv-thumb${item.approved ? ' stsv-approved' : ''}" data-item="${index}">
            ${item.dataUrl ? `<img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(item.label)}">` : `<div class="stsv-ph">${item.copyOf ? `copy of ${escapeHtml(item.copyOf)}` : (item.skipped ? 'Not run' : (item.error ? 'Failed' : 'Generating…'))}</div>`}
            <figcaption>${escapeHtml(item.stLabel || item.label)}${item.copyOf ? ` <span class="stsv-copy">copy of ${escapeHtml(item.copyOf)}</span>` : ''}</figcaption>
            ${usedMarkup(item.used, item.thumbs)}
            <textarea data-item-prompt="${index}" rows="3">${escapeHtml(item.prompt || '')}</textarea>
            <div class="stsv-row">
                ${item.dataUrl && !item.approved ? `<button type="button" data-act="approve-item" data-item="${index}">Approve</button>` : ''}
                ${item.approved ? '<span class="stsv-pill">Approved</span>' : ''}
                ${item.copyOf ? `<button type="button" data-act="make-unique" data-item="${index}">Make unique</button>` : `<button type="button" data-act="reroll-item" data-item="${index}">Re-roll</button>`}
                <button type="button" data-act="drop-item" data-item="${index}">Delete</button>
            </div>
            ${studio.stage === 'outfit-preview' && item.dataUrl ? `
                <button type="button" data-act="keep-outfit">Save outfit (this image only)</button>
                <button type="button" data-act="full-outfit-set">Save outfit + build full set</button>
            ` : ''}
        </figure>
    `).join('');
    const summary = studio.errorSummary ? `<p class="stsv-banner">${escapeHtml(studio.errorSummary)}</p>` : '';
    const pending = visible.filter(({ item }) => item.dataUrl && !item.approved).length;
    const approveAll = pending ? `<button type="button" class="stsv-primary" data-act="approve-all">Approve all${pending > 1 ? ` (${pending})` : ''}</button>` : '';
    const progress = total ? `<div class="stsv-progress" role="progressbar" aria-valuemin="0" aria-valuenow="${done}" aria-valuemax="${total}" aria-label="Suite progress, ${done} of ${total}"><span style="width:${width}%"></span></div><p class="stsv-progress-label">Progress: ${done} of ${total}</p>` : '';
    return `<div class="stsv-studio"><h4>${studio.stage === 'outfit-preview' ? 'Outfit preview' : 'Reference set'}</h4>${progress}${summary}${approveAll}<div class="stsv-board-grid">${items}</div><button type="button" data-act="close-studio">Close</button></div>`;
}

function proposalCard(proposal) {
    return `
        <article class="stsv-card" data-proposal="${escapeAttr(proposal.id)}">
            <strong>${escapeHtml(proposal.characterName)} · ${escapeHtml(proposal.name)}</strong>
            <p>${escapeHtml(proposal.description)}</p>
            ${proposal.previewDataUrl ? `<img src="${escapeAttr(proposal.previewDataUrl)}" alt="${escapeAttr(proposal.name)}">` : ''}
            ${proposal.error ? `<p class="stsv-error">${escapeHtml(proposal.error)}</p>` : ''}
            <label>Prompt <textarea data-proposal-prompt="${escapeAttr(proposal.id)}" rows="2">${escapeHtml(proposal.prompt || '')}</textarea></label>
            <div class="stsv-row">
                <button type="button" data-act="approve-proposal" data-proposal="${escapeAttr(proposal.id)}">Approve and save</button>
                <button type="button" data-act="text-proposal" data-proposal="${escapeAttr(proposal.id)}">Text description only</button>
                <button type="button" data-act="reroll-proposal" data-proposal="${escapeAttr(proposal.id)}">Re-roll still</button>
                <button type="button" data-act="discard-proposal" data-proposal="${escapeAttr(proposal.id)}">Discard</button>
            </div>
        </article>
    `;
}

export function boardModel(env) {
    const library = env.library();
    return {
        personas: env.personas(),
        chatPersonaId: env.chatPersonaId(),
        links: library.links,
        characters: env.characters(),
        places: env.places(),
        allBoards: Object.values(library.records),
        boardFor: (persona) => env.boardFor(persona),
        forms: env.forms(),
        studio: env.studio(),
        proposals: env.proposals(),
        imageModel: env.settings().imageModel || 'mock',
        suitePreset: env.settings().suitePreset || 'quick',
        expressionList: env.settings().expressionList || '',
        expressionExtras: env.settings().expressionExtras || [],
        activeName: env.activeName?.() || '',
        focusKey: env.focusKey?.() || '',
        openDetails: env.openDetails?.() || [],
        medium: () => env.medium?.() || '',
        voiceFor: (name) => env.voiceFor?.(name) || '',
        roleNote: roleLookNote(env.settings()),
        placeName: env.placeDraft().name,
        placeKind: env.placeDraft().kind,
    };
}

export async function onBoardClick(event, env) {
    const menuButton = event.target.closest('[data-act="card-menu"]');
    if (menuButton) {
        const pop = menuButton.parentElement?.querySelector('.stsv-card-menu-pop');
        const willOpen = Boolean(pop?.hidden);
        closeCardMenus();
        if (willOpen && pop) {
            pop.hidden = false;
            menuButton.setAttribute('aria-expanded', 'true');
        }
        return;
    }
    if (!event.target.closest('.stsv-card-menu-pop')) closeCardMenus();
    const button = event.target.closest('[data-act]');
    if (!button || button.tagName === 'INPUT' || button.tagName === 'SELECT' || button.tagName === 'TEXTAREA') return;
    const act = button.dataset.act;
    const key = button.dataset.key || env.studio()?.recordKey;
    if (act === 'use-persona') {
        env.setChatPersona(button.dataset.persona);
        env.note(`${env.personas().find((item) => item.id === button.dataset.persona)?.name || 'Persona'} will be attached in this chat.`);
        env.rerender();
        return;
    }
    if (act === 'new-board') {
        const board = createBoard(env.library(), 'Shared board');
        env.save();
        env.note(`Created ${board.name}. Link a persona to it.`);
        env.rerender();
        return;
    }
    if (act === 'add-place') {
        const draft = env.placeDraft();
        if (!draft.name.trim()) return env.fail('Name the location or prop first.');
        const { attachPlaces } = await import('../places.js');
        const library = env.library();
        attachPlaces([{ prompt: '', locations: draft.kind === 'location' ? [draft.name.trim()] : [], props: draft.kind === 'prop' ? [draft.name.trim()] : [] }], library);
        env.setPlaceDraft({ name: '', kind: draft.kind });
        env.save();
        env.rerender();
        return;
    }
    if (act === 'jump') {
        const target = document.getElementById(button.dataset.target || '');
        const details = target?.closest('details');
        if (details) details.open = true;
        target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        return;
    }
    if (act === 'suite-preset') {
        const preset = button.dataset.preset === 'full' ? 'full' : (button.dataset.preset === 'custom' ? 'custom' : 'quick');
        env.settings().suitePreset = preset;
        if (preset !== 'custom') env.settings().expressionList = expressionListText(preset);
        env.save();
        env.rerender();
        return;
    }
    if (act === 'build-set') {
        const preset = suiteSize(activeSuitePreset(env.settings()));
        env.setStudio({
            stage: 'options',
            recordKey: key,
            includeExpressions: true,
            includeTurnaround: true,
            includeCloseups: false,
            expressionText: suiteListText(env.settings()),
            turnaround: turnaroundForPreset(preset),
            outfit: null,
            medium: env.medium?.() || '',
            items: [],
            errorSummary: '',
        });
        return runSet(env);
    }
    if (act === 'close-studio') {
        env.setStudio(null);
        env.rerender();
        return;
    }
    if (act === 'run-set') return runSet(env);
    if (act === 'preview-outfit') return previewOutfit(env, key);
    if (act === 'approve-all') return approveAll(env);
    if (act === 'approve-item') return approveItem(env, Number(button.dataset.item));
    if (act === 'reroll-item') return rerollItem(env, Number(button.dataset.item));
    if (act === 'make-unique') return makeUnique(env, Number(button.dataset.item));
    if (act === 'drop-item') {
        const studio = env.studio();
        if (studio?.items?.[button.dataset.item]) studio.items[button.dataset.item].dropped = true;
        env.rerender();
        return;
    }
    if (act === 'keep-outfit') return keepOutfit(env, true);
    if (act === 'full-outfit-set') {
        const outfit = keepOutfit(env, false);
        if (!outfit) return;
        env.setStudio({
            stage: 'options',
            recordKey: key,
            includeExpressions: false,
            includeTurnaround: true,
            includeCloseups: false,
            expressionText: env.settings().expressionList || '',
            outfit,
            medium: env.medium?.() || '',
            items: [],
        });
        env.rerender();
        return;
    }
    if (act === 'regen-avatar') return startAvatar(env, key);
    if (act === 'remix') return startRemix(env, key);
    if (act === 'redo-still') return startReplace(env, key, button.dataset.image);
    if (act === 'redo-outfit') return startOutfitRedo(env, key, button.dataset.outfit);
    if (act === 'run-replace' || act === 'run-remix') return runStaged(env);
    if (act === 'approve-staged') return approveStaged(env);
    if (act === 'related') {
        const source = env.record(key);
        const card = button.closest('.stsv-card') || button.closest('article');
        const relation = card?.querySelector('[data-form="relation"]')?.value || 'parent';
        const name = card?.querySelector('[data-form="relatedName"]')?.value || '';
        try {
            const created = createRelatedCharacter(env.library(), source, { relation, name });
            env.save();
            env.note(`${created.name} is on a new board. Stills use ${source?.name || 'the source'} as style and family references.`);
            env.rerender();
        } catch (error) {
            env.fail(shownError(error));
        }
        return;
    }
    if (act === 'switch-style') {
        const style = button.dataset.style === 'anime' ? 'anime' : 'live-action';
        if (env.setStyle) env.setStyle(style);
        else {
            env.settings().style = style;
            env.save();
        }
        env.note(style === 'anime' ? 'Style is Anime.' : 'Style is Live action.');
        env.rerender();
        return;
    }
    if (act === 'upload-face') {
        const safe = key && typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(key) : String(key || '').replace(/"/g, '');
        document.querySelector(`[data-act="add-image"][data-key="${safe}"]`)?.click();
        return;
    }
    if (act === 'variant') return startVariant(env, key, button.dataset.medium);
    if (act === 'run-variant') return runVariant(env);
    if (act === 'extract') return extractAppearance(env, key);
    if (act === 'describe-look') return describeLook(env, key);
    if (act === 'export-json') return exportJson(env, key);
    if (act === 'primary') {
        const record = env.record(key);
        if (record) record.primaryId = button.dataset.image;
        env.save();
        env.rerender();
        return;
    }
    if (act === 'approve-image') {
        const record = env.record(key);
        const image = record?.images?.find((item) => item.id === button.dataset.image);
        if (image) image.approved = true;
        env.save();
        env.note('Approved.');
        env.rerender();
        return;
    }
    if (act === 'set-role') {
        const record = env.record(key);
        const image = record?.images?.find((item) => item.id === button.dataset.image);
        if (!image || !PHOTO_ROLES.some((role) => role.id === button.dataset.role)) return;
        image.role = button.dataset.role;
        const named = PHOTO_ROLES.find((role) => role.id === image.role);
        if (named && image.source === 'inspiration') image.label = named.label;
        env.save();
        env.rerender();
        return;
    }
    if (act === 'delete-image') {
        const record = env.record(key);
        if (record) removeImage(record, button.dataset.image);
        env.save();
        env.rerender();
        return;
    }
    if (act === 'delete-outfit') {
        const record = env.record(key);
        if (record) removeOutfit(record, button.dataset.outfit);
        env.save();
        env.rerender();
        return;
    }
    if (act === 'animate-image') {
        const record = env.record(key);
        const image = record?.images?.find((item) => item.id === button.dataset.image);
        const src = image?.dataUrl || image?.url || '';
        if (!src) return env.fail('That still has no image to animate.');
        return env.animateStill?.({
            dataUrl: src,
            prompt: image.prompt || record.appearance || '',
            title: image.label || record.name,
        });
    }
    if (act === 'export-sprites') return exportSprites(env, key);
    if (act === 'export-zip') return downloadExpressionZip(env, key);
    if (act === 'approve-proposal') return settleProposal(env, button.dataset.proposal, true);
    if (act === 'text-proposal') return settleProposal(env, button.dataset.proposal, false);
    if (act === 'discard-proposal') {
        const proposal = env.proposals().find((item) => item.id === button.dataset.proposal);
        if (!proposal) return;
        discardProposal(env.scenes(), proposal);
        proposal.status = 'discarded';
        env.persist();
        env.rerender();
        return;
    }
    if (act === 'reroll-proposal') return rerollProposal(env, button.dataset.proposal);
}

export function onBoardInput(event, env) {
    const field = event.target;
    const key = field.dataset.key;
    if (field.dataset.field && key) {
        const record = env.record(key);
        if (!record) return;
        record[field.dataset.field] = field.dataset.field === 'loraStrength' ? Number(field.value) : field.value;
        if (field.dataset.field === 'name') {
            record.nameLocked = true;
            record.stName = field.value;
        }
        env.save();
        return;
    }
    if (field.dataset.trait && key) {
        const record = env.record(key);
        const source = familyReferences(record, Object.values(env.library().records))[0];
        if (!record || !source) return;
        applyTraitEdit(record, source, { [field.dataset.trait]: field.value });
        const look = field.closest('article')?.querySelector('[data-field="appearance"]');
        if (look && document.activeElement !== look) look.value = record.appearance;
        env.save();
        return;
    }
    if (field.dataset.outfitText && key) {
        updateOutfitText(env.record(key), field.dataset.outfitText, field.value);
        env.save();
        return;
    }
    if (field.dataset.form && key) {
        const forms = env.forms();
        forms[key] = { ...(forms[key] || {}), [field.dataset.form]: field.value };
        return;
    }
    if (field.dataset.suite === '1' || (field.dataset.form === 'expressionText' && env.studio())) {
        const preset = activeSuitePreset({ suitePreset: 'custom', expressionList: field.value });
        const canonical = preset === 'custom' ? field.value : expressionListText(preset === 'full' ? 'full' : 'quick');
        if (env.studio()) env.studio().expressionText = canonical;
        env.settings().expressionList = canonical;
        env.settings().suitePreset = preset;
        if (preset !== 'custom' && field.value !== canonical) field.value = canonical;
        paintSuiteChrome(env);
        env.save();
        return;
    }
    if (field.dataset.form === 'place-name') env.setPlaceDraft({ ...env.placeDraft(), name: field.value });
    if (field.dataset.variantDescription != null && env.studio()?.stage === 'variant') {
        env.studio().description = field.value;
        const record = env.record(env.studio().recordKey);
        const medium = env.studio().medium;
        if (record && medium) {
            record.variantText = { ...(record.variantText || {}), [medium]: field.value };
        }
        return;
    }
    if (field.dataset.itemPrompt != null && env.studio()?.items?.[field.dataset.itemPrompt]) {
        env.studio().items[field.dataset.itemPrompt].prompt = field.value;
    }
    if (field.dataset.proposalPrompt) {
        const proposal = env.proposals().find((item) => item.id === field.dataset.proposalPrompt);
        if (proposal) proposal.prompt = field.value;
    }
}

export function onBoardChange(event, env) {
    const field = event.target;
    if (field.dataset.act === 'focus-board') {
        env.setFocusKey?.(field.value);
        env.rerender();
        return;
    }
    if (field.dataset.act === 'link-board') {
        linkPersonaBoard(env.library(), field.dataset.persona, field.value);
        env.save();
        env.note('Board link saved.');
        env.rerender();
        return;
    }
    if (field.dataset.act === 'set-relation') {
        const record = env.record(field.dataset.key);
        const source = familyReferences(record, Object.values(env.library().records))[0];
        if (!record || !source) return;
        assignRelation(record, source, field.value);
        env.save();
        env.note(`Relationship is now ${RELATIONS.find((item) => item.id === record.relation)?.label || record.relation}. ${source.name} was not changed.`);
        env.rerender();
        return;
    }
    if (field.dataset.act === 'source-medium') {
        const record = env.record(field.dataset.key);
        if (!record) return;
        record.sourceMedium = field.value || '';
        env.save();
        env.note(record.sourceMedium ? `Stills filed as ${record.sourceMedium === 'anime' ? 'anime' : 'live action'}.` : 'Stills are not filed to a style yet.');
        env.rerender();
        return;
    }
    if (field.dataset.act === 'default-outfit') {
        const record = env.record(field.dataset.key);
        if (record) record.defaultOutfitId = field.value;
        env.save();
        return;
    }
    if (field.dataset.act === 'studio-flag' && env.studio()) {
        env.studio()[field.dataset.flag] = field.checked;
        writeSuiteQuote(env);
        return;
    }
    if (field.dataset.act === 'suite-extra') {
        const name = field.dataset.extra;
        const settings = env.settings();
        const current = new Set(settings.expressionExtras || []);
        if (field.checked) current.add(name);
        else current.delete(name);
        settings.expressionExtras = [...current];
        env.save();
        writeSuiteQuote(env);
        return;
    }
    if (field.dataset.form === 'place-kind') env.setPlaceDraft({ ...env.placeDraft(), kind: field.value });
    if (field.dataset.act === 'stage-replace') return readFile(field, (dataUrl) => {
        const record = env.record(field.dataset.key);
        const image = record?.images?.find((item) => item.id === field.dataset.image);
        if (!record || !image || !dataUrl) return;
        env.setStudio({
            stage: 'replace',
            recordKey: record.key,
            imageId: image.id,
            previousDataUrl: image.dataUrl || image.url || '',
            items: [{
                label: image.label || 'Still',
                prompt: image.prompt || replacementPrompt(record, image),
                tags: image.tags || [],
                outfitId: image.outfitId || '',
                dataUrl,
                approved: false,
            }],
        });
        env.note('The current still stays until you approve the replacement.');
        env.rerender();
    });
    if (field.dataset.act === 'add-image') {
        const files = [...(field.files || [])];
        if (!files.length) return undefined;
        return (async () => {
            const { blobToDataUrl } = await import('../library.js');
            const record = env.record(field.dataset.key);
            if (!record) return;
            for (const file of files) {
                const dataUrl = await blobToDataUrl(file);
                const size = await measureDataUrl(dataUrl);
                let role = uploadRoleFromName(file.name || '');
                const wide = size && size.width >= 64 && size.width >= size.height * 1.15;
                if (!role && wide) role = 'body';
                addImage(record, {
                    dataUrl,
                    label: file.name || 'Upload',
                    tags: tagsForUploadRole(role),
                    role,
                    source: 'upload',
                    width: size?.width || 0,
                    height: size?.height || 0,
                    aspectRatio: wide ? '16:9' : (size && size.height > size.width ? '3:4' : ''),
                });
            }
            field.value = '';
            env.save();
            env.rerender();
        })();
    }
    if (field.dataset.act === 'add-inspiration') {
        const files = [...(field.files || [])];
        field.value = '';
        if (!files.length) return undefined;
        return addInspirationFiles(env, field.dataset.key, files);
    }
    if (field.dataset.act === 'set-identity') {
        const record = env.record(field.dataset.key);
        const image = record?.images?.find((item) => item.id === field.dataset.image);
        if (!image) return undefined;
        image.identity = field.checked;
        env.save();
        env.note(field.checked
            ? 'This photo can steer the face.'
            : 'This photo is used only for its role.');
        return undefined;
    }
    if (field.dataset.act === 'clothing') return readFile(field, (dataUrl) => {
        const forms = env.forms();
        forms[field.dataset.key] = { ...(forms[field.dataset.key] || {}), clothingDataUrl: dataUrl };
        env.note('Clothing photo attached to the next preview.');
    });
    if (field.dataset.act === 'import-json') {
        const file = field.files?.[0];
        if (!file) return;
        file.text().then(async (text) => {
            const { importBundle } = await import('../bundle.js');
            importBundle(env.library(), JSON.parse(text), { key: field.dataset.key });
            env.save();
            env.note('Imported the board.');
            env.rerender();
        }).catch((error) => env.fail(error.message || 'Could not import that file.'));
    }
}

export function onBoardFiles(event, env) {
    const target = event.target;
    if (event.type === 'paste' && target?.closest?.('input, textarea')) return undefined;
    const bag = event.clipboardData || event.dataTransfer;
    const files = [...(bag?.files || [])].filter((file) => /^image\//.test(file.type || ''));
    if (!files.length) return undefined;
    event.preventDefault();
    const key = target?.closest?.('.stsv-guide')?.dataset.key
        || target?.closest?.('[data-key]')?.dataset.key
        || (typeof document !== 'undefined' ? document.querySelector('.stsv-guide')?.dataset.key : '');
    if (!key) return undefined;
    return addInspirationFiles(env, key, files);
}

async function addInspirationFiles(env, key, files) {
    const record = env.record(key);
    if (!record || !files?.length) return;
    const { blobToDataUrl } = await import('../library.js');
    const { uploadDataUrl } = await import('../attach.js');
    const { fileSrc } = await import('../media.js');
    const { completeText } = await import('../llm.js');
    const { parseRoleSuggestion, roleSuggestionRequest } = await import('../inspiration.js');
    const costNote = roleLookNote(env.settings());
    if (costNote) env.note(costNote);
    const request = roleSuggestionRequest();
    let unnamed = 0;
    for (const file of files) {
        const dataUrl = await blobToDataUrl(file);
        let stored = { dataUrl, url: '', file: '' };
        try {
            const uploaded = await uploadDataUrl(dataUrl, file.name || 'inspiration.jpg', env.sillyContext?.(), globalThis.fetch);
            stored = { dataUrl, url: fileSrc(uploaded.path), file: uploaded.path };
        } catch {
            stored = { dataUrl, url: '', file: '' };
        }
        let role = '';
        try {
            const text = await completeText({
                settings: env.settings(),
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                image: dataUrl,
                signal: env.signal?.(),
                responseLength: 80,
            });
            role = parseRoleSuggestion(text);
        } catch {
            role = '';
        }
        if (!role) unnamed += 1;
        const named = PHOTO_ROLES.find((item) => item.id === role);
        addImage(record, {
            dataUrl: stored.dataUrl,
            url: stored.url,
            file: stored.file,
            label: named?.label || file.name || 'Inspiration',
            tags: [],
            role,
            identity: false,
            source: 'inspiration',
        });
    }
    env.save();
    if (unnamed) env.note('Pick a role for the new photo. Thoughtform uses it only for that role.');
    else if (costNote) env.note(costNote);
    else env.note(files.length === 1 ? 'Inspiration photo added.' : `${files.length} inspiration photos added.`);
    env.rerender();
}

function measureDataUrl(dataUrl) {
    if (typeof Image === 'undefined' || !dataUrl) return Promise.resolve(null);
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 });
        image.onerror = () => resolve(null);
        image.src = dataUrl;
    });
}

async function describeLook(env, key) {
    const record = env.record(key);
    if (!record) return;
    const image = (record.images || []).find((item) => item.id === record.primaryId)
        || (record.images || []).find((item) => item.source === 'avatar')
        || (record.images || []).find((item) => item.dataUrl || item.url);
    if (!image) {
        env.fail('Add a main picture first.');
        return;
    }
    try {
        const { describeAvatar } = await import('../avatar-look.js');
        const { completeText } = await import('../llm.js');
        if (roleLookNote(env.settings())) env.note('Describing the picture uses your text model once.');
        const dataUrl = image.dataUrl || await materializeImage(image, globalThis.fetch, { headers: env.headers?.() || {} });
        const look = await describeAvatar(record, {
            image: dataUrl,
            force: true,
            complete: (request) => completeText({
                settings: env.settings(),
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                image: dataUrl,
                signal: env.signal?.(),
                responseLength: 400,
            }),
        });
        if (!look?.mustKeep) {
            env.fail('Could not describe that picture. The card text is still there.');
            return;
        }
        env.save();
        env.rerender();
        env.note('Must keep was filled from the main picture.');
    } catch (error) {
        env.fail(error.message || 'Could not describe that picture.');
    }
}

async function readFile(input, done) {
    const file = input.files?.[0];
    if (!file) return;
    const { blobToDataUrl } = await import('../library.js');
    done(await blobToDataUrl(file));
}

function shownError(error) {
    return formatFailure(error).text;
}

function showBlock(env, record, error) {
    env.setStudio({
        stage: 'blocked',
        recordKey: record?.key || env.studio()?.recordKey || '',
        block: error?.block || { plain: error?.message || 'No reference image.', fix: '', act: 'upload-face' },
        items: [],
    });
    env.fail(error?.message || 'No reference image.');
    env.rerender();
}

async function loadCharacterRefs(env, record, outfitId, job = 'expression') {
    const { materializeImage, referenceBlock } = await import('../library.js');
    const medium = env.medium?.() || '';
    const headers = env.headers?.() || {};
    let owner = record;
    let selection = selectJobReferences(record, { job, medium, cap: 4, outfitId: outfitId || '' });
    if (!selection.images.length) {
        const records = Object.values(env.library().records);
        for (const source of familyReferences(record, records)) {
            const next = selectJobReferences(source, { job, medium, cap: 4, outfitId: '' });
            if (next.images.length) {
                selection = next;
                owner = source;
                break;
            }
        }
    }
    const urls = [];
    const thumbs = [];
    let failure = null;
    const saw = selection.images.length > 0;
    for (const image of selection.images) {
        if (urls.length >= 4) break;
        try {
            const url = await materializeImage(image, globalThis.fetch, { headers });
            if (url && !urls.includes(url)) {
                urls.push(url);
                thumbs.push({ src: url, label: usedName(image, owner) });
            }
        } catch (error) {
            failure = error;
        }
    }
    if (!urls.length) {
        if (saw && failure) {
            const error = new Error(`Could not load ${record?.name || 'the character'}'s avatar. ${failure.message} Nothing was requested.`);
            error.block = {
                plain: `Could not load ${record?.name || 'the character'}'s avatar.`,
                fix: failure.message,
                act: '',
                switchTo: '',
            };
            throw error;
        }
        const block = referenceBlock(record);
        const error = new Error(`${block.plain} ${block.fix}`);
        error.block = block;
        throw error;
    }
    try {
        const { describeAvatar } = await import('../avatar-look.js');
        const { completeText } = await import('../llm.js');
        const look = await describeAvatar(record, {
            image: urls[0],
            complete: (request) => completeText({
                settings: env.settings(),
                systemPrompt: request.systemPrompt,
                prompt: request.prompt,
                image: urls[0],
                signal: env.signal?.(),
                responseLength: 400,
            }),
        });
        if (look) env.save();
    } catch (error) {
        env.note?.(`Could not describe the avatar, so hair and eyes were not filled in. ${error?.message || ''}`.trim());
    }
    return {
        urls,
        thumbs,
        warning: selection.warning,
        switchTo: selection.switchTo,
        used: selection.used,
        useNote: selection.useNote,
    };
}

function withReferences(quote, loaded) {
    return {
        ...quote,
        references: loaded?.thumbs || [],
        warning: loaded?.warning || '',
        switchTo: loaded?.switchTo || '',
        used: loaded?.used || '',
    };
}

function quoteOf(env, request) {
    if (env.quoteStill) return env.quoteStill(request);
    const cost = stillCost(1, env.settings().imageModel);
    return { ...cost, cached: false, key: '', url: '' };
}

function startAvatar(env, key) {
    const record = env.record(key);
    if (!record) return;
    const primary = (record.images || []).find((image) => image.id === record.primaryId) || record.images?.[0];
    env.setStudio({
        stage: 'replace',
        recordKey: key,
        imageId: '',
        previousDataUrl: primary?.dataUrl || primary?.url || '',
        items: [{ label: 'Avatar', prompt: record.appearance || record.name, tags: ['face'], dataUrl: '', approved: false }],
    });
    env.note('The current avatar stays until you approve the new one.');
    env.rerender();
}

function startRemix(env, key) {
    const record = env.record(key);
    if (!record?.sourceKey) return env.fail('Remix is for a character made from another board.');
    const source = familyReferences(record, Object.values(env.library().records))[0];
    const draft = remixDraft(record, source);
    const primary = (record.images || []).find((image) => image.id === record.primaryId) || record.images?.[0];
    env.setStudio({
        stage: 'remix',
        recordKey: key,
        imageId: '',
        previousDataUrl: primary?.dataUrl || primary?.url || '',
        draft,
        items: [{ label: 'Remix', prompt: draft.prompt, tags: ['face'], dataUrl: '', approved: false }],
    });
    env.note(source
        ? `Remix keeps ${source.name} unchanged. Approve to add the new still.`
        : 'The original character is gone. Remix uses this board’s own description.');
    env.rerender();
}

function redoPrice(quote) {
    if (quote?.cached || quote?.label === 'cached, $0') return 'cached, $0';
    if (quote?.usd == null) return quote?.label || 'Price unknown';
    return formatAudShort(quote.usd);
}

function aspectForTags(tags) {
    if ((tags || []).includes('expression') || (tags || []).includes('closeup')) return '3:4';
    if ((tags || []).some((tag) => tag === 'turnaround' || tag === 'pose' || tag === 'outfit')) return '16:9';
    return '';
}

function revealInScroller(node) {
    const scroller = node.closest?.('.stsv-body');
    if (!scroller) return;
    const box = scroller.getBoundingClientRect();
    const nodeBox = node.getBoundingClientRect();
    if (nodeBox.bottom > box.bottom - 48) scroller.scrollTop += nodeBox.bottom - box.bottom + 48;
    else if (nodeBox.top < box.top + 8) scroller.scrollTop -= box.top - nodeBox.top + 12;
}

async function focusRedo(id) {
    if (typeof document === 'undefined') return;
    const safe = id && typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : String(id || '').replace(/"/g, '');
    const node = (safe && document.querySelector(`.stsv-redo[data-image="${safe}"], .stsv-redo[data-outfit="${safe}"]`))
        || document.querySelector('.stsv-redo, .stsv-studio');
    if (!node) return;
    const target = node.querySelector('[data-act="approve-staged"]') || node;
    const apply = () => {
        if (!node.isConnected) return;
        revealInScroller(target);
        node.focus?.({ preventScroll: true });
    };
    apply();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    apply();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    apply();
}

export function redoConfirmLabel(image) {
    return stillCaption(image);
}

function closeCardMenus(except) {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.stsv-card-menu-pop').forEach((node) => {
        if (except && node === except) return;
        node.hidden = true;
        const opener = node.parentElement?.querySelector('[data-act="card-menu"]');
        if (opener) opener.setAttribute('aria-expanded', 'false');
    });
}

async function paintFrame() {
    await new Promise((resolve) => setTimeout(resolve, 300));
}

function startReplace(env, key, imageId) {
    const record = env.record(key);
    const image = record?.images?.find((item) => item.id === imageId);
    if (!record || !image) return;
    const tags = image.tags || [];
    return beginRedo(env, {
        key,
        imageId,
        label: redoConfirmLabel(image),
        tags,
        stLabel: image.stLabel || '',
        outfitId: '',
        aspectRatio: image.aspectRatio || aspectForTags(tags),
        previousDataUrl: image.dataUrl || image.url || '',
        basePrompt: replacementPrompt(record, image),
        image,
    });
}

function startOutfitRedo(env, key, outfitId) {
    const record = env.record(key);
    const outfit = record?.outfits?.find((item) => item.id === outfitId);
    if (!record || !outfit) return;
    const existing = (record.images || []).find((image) => image.outfitId === outfitId);
    const tags = ['outfit', 'full body'];
    const prompt = outfitPreviewPrompt({ appearance: record.appearance, styleLine: env.styleLine(), outfit });
    return beginRedo(env, {
        key,
        imageId: '',
        outfitId,
        label: outfit.name || 'outfit',
        tags,
        aspectRatio: '16:9',
        previousDataUrl: existing?.dataUrl || existing?.url || '',
        basePrompt: prompt,
        image: { label: outfit.name, tags, prompt },
    });
}

async function beginRedo(env, spec) {
    const record = env.record(spec.key);
    if (!record) return;
    const seed = Math.floor(Math.random() * 1e9);
    const tags = spec.tags || [];
    const aspectRatio = spec.aspectRatio || aspectForTags(tags);
    let loaded;
    try {
        loaded = await loadCharacterRefs(env, record, spec.outfitId || '', jobForTags(tags));
    } catch (error) {
        return showBlock(env, record, error);
    }
    const prompt = appendUseNote(replacementPrompt(record, spec.image || { label: spec.label, tags, prompt: spec.basePrompt || '' }, { vary: true, seed }), loaded.useNote);
    const references = loaded.urls;
    const request = { prompt, referenceImages: references, label: spec.label, aspectRatio, seed };
    const quote = quoteOf(env, request);
    const price = redoPrice(quote);
    if (env.confirmSpend && !(await env.confirmSpend(withReferences(quote, loaded), `Redo ${spec.label || 'still'} ≈ ${price}`))) return;
    const release = env.hold?.('keyframe');
    if (env.hold && !release) return env.fail('A job is already running.');
    env.setStudio({
        stage: 'replace',
        recordKey: spec.key,
        imageId: spec.imageId || '',
        outfitId: spec.outfitId || '',
        busy: true,
        charge: '',
        quoted: price,
        aspectRatio,
        seed,
        used: loaded.used || '',
        thumbs: loaded.thumbs || [],
        previousDataUrl: spec.previousDataUrl || '',
        items: [{
            label: spec.label || 'Still',
            prompt,
            tags,
            outfitId: spec.outfitId || '',
            stLabel: spec.stLabel || '',
            aspectRatio,
            seed,
            dataUrl: '',
            approved: false,
            error: '',
        }],
    });
    env.rerender();
    await focusRedo(spec.imageId || spec.outfitId);
    try {
        await paintFrame();
        if (env.signal()?.aborted) {
            const studio = env.studio();
            if (studio?.items?.[0]) studio.items[0].error = 'Cancelled. Nothing was charged.';
            if (studio) studio.busy = false;
            env.rerender();
            return;
        }
        await runStaged(env, { quote, confirmed: true, references });
    } finally {
        release?.();
        await focusRedo(spec.imageId || spec.outfitId);
    }
}

async function runStaged(env, options = {}) {
    const studio = env.studio();
    const item = studio?.items?.[0];
    const record = env.record(studio?.recordKey);
    if (!studio || !item || !record) return;
    const aspectRatio = item.aspectRatio || aspectForTags(item.tags);
    let references = options.references;
    let loaded = null;
    if (!references) {
        try {
            const source = studio.stage === 'remix'
                ? familyReferences(record, Object.values(env.library().records))[0]
                : record;
            if (!source) {
                const { referenceBlock } = await import('../library.js');
                const block = referenceBlock(record);
                const error = new Error(`${block.plain} ${block.fix}`);
                error.block = block;
                throw error;
            }
            loaded = await loadCharacterRefs(env, source, item.outfitId || studio.outfitId || '', jobForTags(item.tags));
            references = loaded.urls;
            studio.used = loaded.used || '';
            studio.thumbs = loaded.thumbs || [];
            item.prompt = appendUseNote(item.prompt || replacementPrompt(record, item, { vary: Boolean(item.seed), seed: item.seed }), loaded.useNote);
        } catch (error) {
            return showBlock(env, record, error);
        }
    }
    if (!references?.length) {
        const { referenceBlock } = await import('../library.js');
        const block = referenceBlock(record);
        const error = new Error(`${block.plain} ${block.fix}`);
        error.block = block;
        return showBlock(env, record, error);
    }
    const request = {
        prompt: item.prompt,
        referenceImages: references,
        label: item.label,
        aspectRatio,
        seed: item.seed || '',
    };
    const quote = options.quote || quoteOf(env, request);
    if (!options.confirmed && !(await env.confirmSpend(withReferences(quote, loaded), item.label || 'Still'))) return;
    studio.busy = true;
    studio.quoted = studio.quoted || redoPrice(quote);
    item.error = '';
    env.rerender();
    await focusRedo(studio.imageId || studio.outfitId);
    try {
        if (env.signal()?.aborted) throw new Error('Cancelled. Nothing was charged.');
        item.dataUrl = quote.cached ? quote.url : await env.generateImage(request);
        item.cacheKey = quote.key || '';
        item.aspectRatio = aspectRatio;
        studio.charge = redoPrice(quote);
        if (!quote.cached && quote.usd) env.charge(quote.usd, item.label || 'Still');
    } catch (error) {
        item.error = shownError(error);
        studio.charge = '';
        studio.quoted = '';
    }
    studio.busy = false;
    env.rerender();
    await focusRedo(studio.imageId || studio.outfitId);
}

function approveStaged(env) {
    const studio = env.studio();
    const item = studio?.items?.[0];
    const record = env.record(studio?.recordKey);
    if (!record || !item?.dataUrl) return env.fail('Generate the new still before approving it.');
    if (studio.imageId) {
        const image = approveReplacement(record, studio.imageId, { dataUrl: item.dataUrl, prompt: item.prompt });
        if (image && item.cacheKey) image.cacheKey = item.cacheKey;
        env.note('Approved. This view uses the new still. The rest of the board was left alone.');
    } else {
        const saved = addImage(record, {
            dataUrl: item.dataUrl,
            label: item.label || 'Avatar',
            tags: item.tags || ['face'],
            prompt: item.prompt || '',
            outfitId: item.outfitId || '',
            source: 'generated',
            medium: studio.medium || env.medium?.() || '',
            cacheKey: item.cacheKey || '',
        });
        record.primaryId = saved.id;
        if (studio.stage === 'remix' && studio.draft?.appearance) {
            record.appearance = studio.draft.appearance;
            record.traits = { ...(studio.draft.traits || record.traits) };
            record.composedAppearance = studio.draft.appearance;
        }
        env.note('Approved. Older stills stay on the board until you delete them.');
    }
    env.setStudio(null);
    env.save();
    env.rerender();
}

async function runSet(env) {
    const studio = env.studio();
    const record = env.record(studio?.recordKey);
    if (!studio || !record) return;
    const preset = activeSuitePreset(env.settings());
    const size = suiteSize(preset);
    const items = planReferenceSet({
        expressions: resolveSuiteExpressions(studio.expressionText || expressionListText(size), {
            extras: env.settings().expressionExtras,
            full: preset === 'full',
        }),
        includeExpressions: studio.includeExpressions,
        includeTurnaround: studio.includeTurnaround,
        includeCloseups: studio.includeCloseups,
        turnaround: studio.turnaround || turnaroundForPreset(size),
        outfit: studio.outfit,
        styleLine: env.styleLine(),
        appearance: record.appearance,
        mustKeep: record.mustKeep,
    });
    const jobs = new Map();
    try {
        for (const item of items) {
            if (item.copyOf) continue;
            const job = jobForTags(item.tags);
            if (jobs.has(job)) continue;
            jobs.set(job, await loadCharacterRefs(env, record, studio.outfit?.id, job));
        }
    } catch (error) {
        return showBlock(env, record, error);
    }
    const packed = items.map((item) => {
        if (item.copyOf) return { quote: null, prompt: item.prompt, loaded: jobs.get('expression') || null };
        const loaded = jobs.get(jobForTags(item.tags));
        const prompt = appendUseNote(item.prompt, loaded?.useNote);
        return {
            quote: quoteOf(env, { prompt, referenceImages: loaded?.urls || [], label: item.label }),
            prompt,
            loaded,
        };
    });
    const quotes = packed.map((entry) => entry.quote);
    const missing = quotes.filter((quote) => quote && !quote.cached).length;
    const cost = missing ? stillCost(missing, env.settings().imageModel) : { usd: 0, label: 'cached, $0', note: 'cached, $0' };
    const thumbs = [];
    let warning = '';
    let switchTo = '';
    for (const loaded of jobs.values()) {
        warning = warning || loaded.warning;
        switchTo = switchTo || loaded.switchTo;
        for (const thumb of loaded.thumbs || []) {
            if (!thumbs.some((item) => item.src === thumb.src)) thumbs.push(thumb);
        }
    }
    const used = mergeUsedLines([...jobs.values()].map((loaded) => loaded.used));
    if (missing && !(await env.confirmSpend(withReferences({ ...cost, used }, { thumbs, warning, switchTo, used }), `Reference set for ${record.name}`))) return;
    if (!missing) env.note('cached, $0');
    studio.stage = 'results';
    studio.errorSummary = '';
    studio.items = items.map((item, index) => ({
        ...item,
        prompt: packed[index].prompt,
        used: packed[index].loaded?.used || used,
        thumbs: packed[index].loaded?.thumbs || [],
        dataUrl: '',
        error: '',
        skipped: false,
        approved: false,
        cacheKey: quotes[index]?.key || '',
    }));
    env.rerender();
    let bannerShown = false;
    for (let index = 0; index < studio.items.length; index += 1) {
        const item = studio.items[index];
        if (env.signal()?.aborted) return;
        const quote = quotes[index];
        if (!quote) {
            fillExpressionCopies(studio.items);
            env.rerender();
            continue;
        }
        try {
            item.cached = Boolean(quote.cached);
            item.dataUrl = quote.cached ? quote.url : await env.generateImage({
                prompt: item.prompt,
                referenceImages: packed[index].loaded?.urls || [],
                label: item.label,
                aspectRatio: item.aspectRatio || '3:4',
            });
            item.cacheKey = quote.key || item.cacheKey;
            fillExpressionCopies(studio.items);
        } catch (error) {
            const explained = formatFailure(error);
            if (explained.banner) {
                bannerShown = true;
                env.banner?.(explained);
                for (let rest = index; rest < studio.items.length; rest += 1) {
                    studio.items[rest].skipped = true;
                    studio.items[rest].error = '';
                }
                studio.errorSummary = explained.text;
                env.rerender();
                break;
            }
            item.error = explained.text;
        }
        env.rerender();
    }
    fillExpressionCopies(studio.items);
    const failed = studio.items.filter((item) => item.error && !item.copyOf);
    if (!bannerShown && failed.length) {
        const same = failed.every((item) => item.error === failed[0].error);
        studio.errorSummary = same ? failed[0].error : `${failed.length} of ${studio.items.length} stills failed.`;
        env.rerender();
    }
    const fresh = studio.items.filter((item, index) => item.dataUrl && !item.copyOf && !quotes[index]?.cached).length;
    const billed = bannerShown ? stillCost(fresh, env.settings().imageModel) : cost;
    if (billed.usd) env.charge(billed.usd, `Reference set · ${record.name}`);
}

function paintSuiteChrome(env) {
    if (typeof document === 'undefined') return;
    const preset = activeSuitePreset(env.settings());
    document.querySelectorAll('[data-act="suite-preset"]').forEach((button) => {
        const on = button.dataset.preset === preset;
        button.setAttribute('aria-pressed', on ? 'true' : 'false');
        button.classList.toggle('stsv-on', on);
    });
    writeSuiteQuote(env);
    const field = document.getElementById('stsv-expression-list');
    const list = document.getElementById('stsv-expr-done');
    const key = document.querySelector('.stsv-guide')?.dataset.key;
    const record = key ? env.record(key) : null;
    if (list && record) list.outerHTML = expressionChecklist(record, field?.value || env.settings().expressionList || '');
}

function writeSuiteQuote(env) {
    if (typeof document === 'undefined') return;
    const node = document.getElementById('stsv-suite-quote');
    if (!node) return;
    const settings = env.settings();
    const preset = activeSuitePreset(settings);
    const size = suiteSize(preset);
    const field = document.getElementById('stsv-expression-list');
    const text = field?.value || settings.expressionList || expressionListText(size);
    const studio = env.studio();
    const plan = planReferenceSet({
        expressions: resolveSuiteExpressions(text, { extras: settings.expressionExtras, full: preset === 'full' }),
        includeExpressions: studio?.includeExpressions !== false,
        includeTurnaround: studio?.includeTurnaround !== false,
        includeCloseups: Boolean(studio?.includeCloseups),
        turnaround: studio?.turnaround || turnaroundForPreset(size),
    });
    node.textContent = suiteQuote(plan, settings.imageModel);
}

async function previewOutfit(env, key) {
    const record = env.record(key);
    const form = env.forms()[key] || {};
    if (!record) return;
    if (!String(form.outfitName || '').trim() && !String(form.outfitDescription || '').trim()) {
        env.fail('Describe the outfit or give it a name.');
        return;
    }
    const outfit = { name: form.outfitName || 'Outfit', description: form.outfitDescription || '' };
    let loaded;
    try {
        loaded = await loadCharacterRefs(env, record, '', 'outfit');
    } catch (error) {
        return showBlock(env, record, error);
    }
    const references = [...loaded.urls];
    let note = loaded.useNote || '';
    if (form.clothingDataUrl && references.length < 4 && !references.includes(form.clothingDataUrl)) {
        references.push(form.clothingDataUrl);
        const which = ['first', 'second', 'third', 'fourth'][references.length - 1] || 'last';
        const extra = `Use the ${which} image only for the outfit. Keep the face from the first image.`;
        note = [note, extra].filter(Boolean).join(' ');
        loaded = { ...loaded, useNote: note, used: loaded.used };
    }
    const prompt = appendUseNote(outfitPreviewPrompt({ appearance: record.appearance, styleLine: env.styleLine(), outfit, mustKeep: record.mustKeep }), note);
    const quote = quoteOf(env, { prompt, referenceImages: references, label: outfit.name });
    const cost = quote.cached ? { usd: 0, label: 'cached, $0' } : stillCost(1, env.settings().imageModel);
    if (!quote.cached && !(await env.confirmSpend(withReferences(cost, loaded), `Outfit preview · ${outfit.name}`))) return;
    if (quote.cached) env.note('cached, $0');
    env.setStudio({ stage: 'outfit-preview', recordKey: key, medium: env.medium?.() || '', outfit, items: [{ label: outfit.name, prompt, tags: ['outfit', 'full body'], used: loaded.used || '', thumbs: loaded.thumbs || [], dataUrl: quote.cached ? quote.url : '', cacheKey: quote.key || '', error: '' }] });
    env.rerender();
    if (!quote.cached) {
        try {
            env.studio().items[0].dataUrl = await env.generateImage({ prompt, referenceImages: references, label: outfit.name, aspectRatio: '16:9' });
            env.studio().items[0].cacheKey = quote.key || '';
        } catch (error) {
            env.studio().items[0].error = shownError(error);
        }
    }
    if (cost.usd) env.charge(cost.usd, `Outfit preview · ${outfit.name}`);
    env.rerender();
}

function approveAll(env) {
    const studio = env.studio();
    if (!studio?.items) return;
    let count = 0;
    studio.items.forEach((item, index) => {
        if (!item.dropped && item.dataUrl && !item.approved && approveItem(env, index, { quiet: true })) count += 1;
    });
    env.save();
    env.note(count ? `Approved ${count} still${count === 1 ? '' : 's'}.` : 'Nothing new to approve.');
    env.rerender();
}

function approveItem(env, index, { quiet = false } = {}) {
    const studio = env.studio();
    const item = studio?.items?.[index];
    const record = env.record(studio?.recordKey);
    if (!item?.dataUrl || !record) return false;
    const medium = studio.stage === 'variant' ? (studio.medium || '') : (studio.medium || env.medium?.() || '');
    const saved = addImage(record, {
        dataUrl: item.dataUrl,
        label: item.label,
        tags: item.tags || (studio.stage === 'variant' ? ['face'] : []),
        stLabel: item.stLabel || '',
        copyOf: item.copyOf || '',
        prompt: item.prompt || '',
        outfitId: studio.outfit?.id || '',
        source: 'generated',
        medium,
        cacheKey: item.cacheKey || '',
        approved: true,
        aspectRatio: item.aspectRatio || '',
    });
    if (medium) {
        const current = record.variantPrimary?.[medium];
        record.variantPrimary = {
            ...(record.variantPrimary || {}),
            [medium]: studio.stage === 'variant' ? saved.id : (current || saved.id),
        };
        if (studio.stage === 'variant' && studio.description) {
            record.variantText = { ...(record.variantText || {}), [medium]: studio.description };
        }
    }
    item.approved = true;
    if (quiet) return true;
    env.save();
    env.note(`${item.label} is approved and on the board.`);
    env.rerender();
    return true;
}

async function rerollItem(env, index) {
    const studio = env.studio();
    const item = studio?.items?.[index];
    const record = env.record(studio?.recordKey);
    if (!item || !record) return;
    item.error = '';
    item.dataUrl = '';
    env.rerender();
    try {
        if (studio.stage === 'variant') {
            const request = variantImageRequest({
                medium: studio.medium,
                description: studio.description,
                name: record.name,
            });
            item.prompt = request.prompt;
            item.dataUrl = await env.generateImage({ ...request, label: item.label });
        } else {
            const loaded = await loadCharacterRefs(env, record, studio.outfit?.id, jobForTags(item.tags));
            item.used = loaded.used;
            item.thumbs = loaded.thumbs;
            item.prompt = appendUseNote(item.prompt, loaded.useNote);
            item.dataUrl = await env.generateImage({
                prompt: item.prompt,
                referenceImages: loaded.urls,
                label: item.label,
                aspectRatio: item.aspectRatio || aspectForTags(item.tags),
                seed: Math.floor(Math.random() * 1e9),
            });
        }
    } catch (error) {
        item.error = shownError(error);
    }
    env.rerender();
}

async function makeUnique(env, index) {
    const studio = env.studio();
    const item = studio?.items?.[index];
    const record = env.record(studio?.recordKey);
    if (!item?.copyOf || !record) return;
    let loaded;
    try {
        loaded = await loadCharacterRefs(env, record, studio.outfit?.id, jobForTags(item.tags));
    } catch (error) {
        return showBlock(env, record, error);
    }
    const request = {
        prompt: appendUseNote(item.prompt, loaded.useNote),
        referenceImages: loaded.urls,
        label: item.stLabel || item.label,
        aspectRatio: item.aspectRatio || '3:4',
    };
    const quote = quoteOf(env, request);
    const price = quote.cached ? 'cached, $0' : (quote.quote || quote.label || stillCost(1, env.settings().imageModel).quote);
    if (!quote.cached && !(await env.confirmSpend(withReferences(quote, loaded), `Make ${item.stLabel || item.label} unique ≈ ${price}`))) return;
    item.copyOf = '';
    item.prompt = request.prompt;
    item.used = loaded.used || '';
    item.thumbs = loaded.thumbs || [];
    item.error = '';
    item.skipped = false;
    env.rerender();
    try {
        item.dataUrl = quote.cached ? quote.url : await env.generateImage(request);
        item.cacheKey = quote.key || '';
        if (!quote.cached && quote.usd) env.charge(quote.usd, `Unique ${item.stLabel || item.label}`);
    } catch (error) {
        item.error = shownError(error);
    }
    env.rerender();
}

function keepOutfit(env, close) {
    const studio = env.studio();
    const record = env.record(studio?.recordKey);
    const item = studio?.items?.find((entry) => entry.dataUrl);
    if (!record || !studio?.outfit || !item) return null;
    const outfit = addOutfit(record, studio.outfit);
    if (!record.defaultOutfitId) record.defaultOutfitId = outfit.id;
    addImage(record, {
        dataUrl: item.dataUrl,
        label: outfit.name,
        tags: ['outfit', 'full body'],
        outfitId: outfit.id,
        prompt: item.prompt || '',
        source: 'generated',
        medium: studio.medium || env.medium?.() || '',
        cacheKey: item.cacheKey || '',
    });
    env.save();
    if (close) {
        env.setStudio(null);
        env.note(`${outfit.name} is in the wardrobe.`);
        env.rerender();
    }
    return outfit;
}

function exportJson(env, key) {
    const record = env.record(key);
    if (!record) return;
    env.download(`${record.name}-board.json`, JSON.stringify(exportBundle(record), null, 2), 'application/json');
}

async function startVariant(env, key, medium) {
    const record = env.record(key);
    const target = medium === 'anime' ? 'anime' : 'live-action';
    if (!record) return;
    const brief = featureBriefPrompt(record);
    let description = record.variantText?.[target] || '';
    if (!description) {
        try {
            const { completeText } = await import('../llm.js');
            const text = await completeText({
                settings: env.settings(),
                systemPrompt: brief.systemPrompt,
                prompt: brief.prompt,
                responseLength: 400,
            });
            description = usableFeatureBrief(text, record.appearance || record.name);
        } catch {
            description = record.appearance || record.name;
        }
    }
    record.variantText = { ...(record.variantText || {}), [target]: description };
    env.setStudio({
        stage: 'variant',
        recordKey: key,
        medium: target,
        description,
        items: [],
    });
    env.save();
    env.note(`Edit the ${target === 'anime' ? 'anime' : 'live-action'} description, then generate the avatar from that text.`);
    env.rerender();
}

async function runVariant(env) {
    const studio = env.studio();
    const record = env.record(studio?.recordKey);
    if (!studio || studio.stage !== 'variant' || !record) return;
    const description = String(studio.description || record.appearance || record.name).trim();
    if (!description) return env.fail('Write the features before generating the avatar.');
    const label = studio.medium === 'anime' ? 'Anime avatar' : 'Live-action avatar';
    const request = variantImageRequest({ medium: studio.medium, description, name: record.name });
    const quote = quoteOf(env, { ...request, label });
    const cost = quote.cached ? { usd: 0, label: 'cached, $0' } : stillCost(1, env.settings().imageModel);
    if (!quote.cached && !(await env.confirmSpend(cost, label))) return;
    studio.items = [{ label, prompt: request.prompt, tags: ['face'], dataUrl: quote.cached ? quote.url : '', cacheKey: quote.key || '', error: '', approved: false }];
    record.variantText = { ...(record.variantText || {}), [studio.medium]: description };
    env.rerender();
    if (quote.cached) env.note('cached, $0');
    else {
        try {
            studio.items[0].dataUrl = await env.generateImage({ ...request, label });
        } catch (error) {
            studio.items[0].error = shownError(error);
        }
        if (cost.usd) env.charge(cost.usd, label);
    }
    env.rerender();
}

async function extractAppearance(env, key) {
    const record = env.record(key);
    if (!record) return;
    try {
        const { completeText } = await import('../llm.js');
        const text = await completeText({
            settings: env.settings(),
            systemPrompt: 'Write a visual description for an image model: face, hair, body, usual clothes. Under 80 words. No biography.',
            prompt: `${record.name}\n${record.appearance || ''}`,
        });
        record.appearance = String(text || '').trim().slice(0, 1200) || record.appearance;
        env.save();
        env.rerender();
    } catch (error) {
        env.fail(error.message || 'Could not write the appearance. The card text is still there.');
    }
}

async function downloadExpressionZip(env, key) {
    const record = env.record(key);
    if (!record) return;
    try {
        const { zipExpressionSet, spriteExportPlan: planOf } = await import('../sprites.js');
        const bytes = zipExpressionSet(record);
        const blob = new Blob([bytes], { type: 'application/zip' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const folder = String(record.stName || record.name || 'expressions').replace(/[\\/:*?"<>|]/g, '_');
        link.href = url;
        link.download = `${folder}-expressions.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        const count = planOf(record).targets.length;
        env.note(`Downloaded ${count} expression file${count === 1 ? '' : 's'}, named for SillyTavern's expressions folder.`);
    } catch (error) {
        env.fail(error.message);
    }
}

async function exportSprites(env, key) {
    const record = env.record(key);
    if (!record) return;
    const plan = spriteExportPlan(record);
    if (!plan.targets.length) return env.fail('Approve an expression still before exporting sprites.');
    const lines = plan.mappings.map((item) => {
        if (item.copyOf) return `${item.to} is a copy of ${item.copyOf}`;
        return item.from.toLowerCase() === item.to.toLowerCase() ? `${item.to} stays ${item.to}` : `${item.from} → ${item.to}`;
    });
    const emptyNote = plan.empty.length
        ? `${plan.empty.length} other SillyTavern expression labels stay empty (${plan.empty.slice(0, 6).join(', ')}${plan.empty.length > 6 ? ', …' : ''}).`
        : 'Every standard SillyTavern expression label has a sprite.';
    if (!window.confirm(`Sprites use SillyTavern's names:\n${lines.join('\n')}\n\n${emptyNote}\n\nExport these sprites?`)) return;
    const fallback = window.confirm('Set the fallback expression to neutral? With the classifier off, SillyTavern only shows the fallback sprite.');
    try {
        const { uploadExpressionSprites } = await import('../sprites.js');
        const labels = await uploadExpressionSprites(record, { headers: env.headers() });
        if (fallback) setFallbackExpression('neutral', env.sillyContext?.());
        const message = `Saved ${labels.join(', ')} for ${record.stName || record.name}. ${emptyNote}`;
        env.note(message);
        env.toast?.(
            `${escapeHtml(message)}<br><button type="button">Open sprite set</button>`,
            'Sprites saved',
            () => openSpriteSet(),
        );
    } catch (error) {
        env.fail(error.message);
    }
}

async function settleProposal(env, id, withImage) {
    const proposal = env.proposals().find((item) => item.id === id);
    const record = env.record(proposal?.characterKey);
    if (!proposal || !record) return;
    const outfit = acceptProposal(record, proposal, { withImage: withImage && Boolean(proposal.previewDataUrl) });
    applyProposalToScenes(env.scenes(), proposal, outfit.id);
    proposal.status = 'saved';
    env.save();
    env.persist();
    env.note(withImage && proposal.previewDataUrl ? `${outfit.name} is saved with its preview.` : `${outfit.name} is saved as text.`);
    env.rerender();
}

async function rerollProposal(env, id) {
    const proposal = env.proposals().find((item) => item.id === id);
    const record = env.record(proposal?.characterKey);
    if (!proposal || !record) return;
    let loaded;
    try {
        loaded = await loadCharacterRefs(env, record, '');
    } catch (error) {
        return showBlock(env, record, error);
    }
    proposal.prompt = proposal.prompt || outfitPreviewPrompt({ appearance: record.appearance, styleLine: env.styleLine(), outfit: proposal, mustKeep: record.mustKeep });
    const references = loaded.urls;
    const quote = quoteOf(env, { prompt: proposal.prompt, referenceImages: references, label: proposal.name });
    const cost = quote.cached ? { usd: 0, label: 'cached, $0' } : stillCost(1, env.settings().imageModel);
    if (!quote.cached && !(await env.confirmSpend(withReferences(cost, loaded), `Outfit preview · ${proposal.name}`))) return;
    proposal.error = '';
    try {
        proposal.previewDataUrl = quote.cached ? quote.url : await env.generateImage({
            prompt: proposal.prompt,
            referenceImages: references,
            label: proposal.name,
        });
        if (quote.cached) env.note('cached, $0');
        else if (cost.usd) env.charge(cost.usd, `Outfit preview · ${proposal.name}`);
    } catch (error) {
        proposal.error = shownError(error);
    }
    env.rerender();
}
