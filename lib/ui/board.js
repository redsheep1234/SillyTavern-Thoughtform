import { stillCost } from '../providers/image.js';
import { planReferenceSet, parseExpressionList } from '../refset.js';
import { addImage, createBoard, linkPersonaBoard, recordWeight, removeImage } from '../library.js';
import { acceptProposal, addOutfit, applyProposalToScenes, discardProposal, outfitPreviewPrompt, removeOutfit } from '../wardrobe.js';
import { createRelatedCharacter, familyReferences, RELATIONS } from '../relations.js';
import { explainError } from '../debug.js';
import { exportBundle } from '../bundle.js';

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
    const personas = model.personas.map((persona) => personaCard(persona, model)).join('');
    const characters = model.characters.map((record) => boardCard(record, model, { badge: '' })).join('');
    const places = model.places.map((record) => boardCard(record, model, { badge: record.kind })).join('');
    const proposals = model.proposals.filter((item) => item.status !== 'discarded').map((item) => proposalCard(item)).join('');
    return `
        <div class="stsv-people">
            <h4>Personas</h4>
            <p class="stsv-hint">Every SillyTavern persona has a reference board, an expression set, and a wardrobe. Link a persona to another board when two personas share a face. This chat attaches the badged persona whenever they appear in a shot.</p>
            ${personas || '<p class="stsv-empty">No persona yet. SillyTavern will add one from the current user.</p>'}
            <button type="button" data-act="new-board">New shared board</button>
        </div>
        <div class="stsv-people">
            <h4>Characters</h4>
            ${characters || '<p class="stsv-empty">Open a chat with a character and their card will land here.</p>'}
        </div>
        <div class="stsv-people">
            <h4>Locations and props</h4>
            <p class="stsv-hint">The shot list picks these up from lines like “at the bridge” or “holding the crane”, and from the model’s locations and props fields. They ride along into keyframes.</p>
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
        ${proposals ? `<div class="stsv-people"><h4>Proposed outfits</h4><p class="stsv-hint">Nothing here is saved until you approve it. Text only skips the still.</p>${proposals}</div>` : ''}
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

function boardBody(record, model, badge = '') {
    const weight = recordWeight(record);
    const images = (record.images || []).map((image) => imageCell(record, image)).join('');
    const outfitOptions = (record.outfits || []).map((outfit) => (
        `<option value="${escapeAttr(outfit.id)}" ${record.defaultOutfitId === outfit.id ? 'selected' : ''}>${escapeHtml(outfit.name)}</option>`
    )).join('');
    const human = record.kind === 'character' || record.kind === 'persona' || record.kind === 'board';
    const form = model.forms[record.key] || {};
    const studio = model.studio?.recordKey === record.key ? studioBlock(model.studio, model) : '';
    return `
        <header class="stsv-card-head">
            <strong>${escapeHtml(record.name)}</strong>
            ${badge ? `<span class="stsv-pill">${escapeHtml(badge)}</span>` : ''}
            ${model.voiceFor?.(record.name) ? `<span class="stsv-pill">Voice ${escapeHtml(model.voiceFor(record.name))}</span>` : ''}
        </header>
        <label>Appearance
            <textarea id="${domId(`look-${record.key}`)}" name="${domId(`look-${record.key}`)}" data-field="appearance" data-key="${escapeAttr(record.key)}" rows="2">${escapeHtml(record.appearance || '')}</textarea>
        </label>
        <div class="stsv-row">
            <button type="button" data-act="extract" data-key="${escapeAttr(record.key)}">Write appearance</button>
            <button type="button" data-act="build-set" data-key="${escapeAttr(record.key)}">Build reference set</button>
            <label class="stsv-file">Add image <input id="${domId(`file-${record.key}`)}" name="${domId(`file-${record.key}`)}" data-act="add-image" data-key="${escapeAttr(record.key)}" type="file" accept="image/*"></label>
            <button type="button" data-act="export-json" data-key="${escapeAttr(record.key)}">Export JSON</button>
            <label class="stsv-file">Import <input id="${domId(`import-${record.key}`)}" name="${domId(`import-${record.key}`)}" data-act="import-json" data-key="${escapeAttr(record.key)}" type="file" accept="application/json,.json"></label>
            ${record.kind === 'character' ? `<button type="button" data-act="export-sprites" data-key="${escapeAttr(record.key)}">Export expressions to SillyTavern</button>` : ''}
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
        <div class="stsv-board-grid">${images || '<p class="stsv-empty">No stills yet. Build a reference set or add an image.</p>'}</div>
        ${human ? `
            <label>Default outfit
                <select id="${domId(`outfit-${record.key}`)}" name="${domId(`outfit-${record.key}`)}" data-act="default-outfit" data-key="${escapeAttr(record.key)}">
                    <option value="">Card clothes</option>
                    ${outfitOptions}
                </select>
            </label>
            <div class="stsv-wardrobe">
                <h4>Wardrobe</h4>
                ${(record.outfits || []).map((outfit) => `<p>${escapeHtml(outfit.name)} — ${escapeHtml(outfit.description || 'No description')} <button type="button" data-act="delete-outfit" data-key="${escapeAttr(record.key)}" data-outfit="${escapeAttr(outfit.id)}">Delete</button></p>`).join('') || '<p class="stsv-empty">No outfits yet.</p>'}
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

function imageCell(record, image) {
    const src = image.dataUrl || image.url || '';
    return `
        <figure class="stsv-thumb">
            ${src ? `<img src="${escapeAttr(src)}" alt="${escapeAttr(image.label || 'reference')}">` : '<div class="stsv-ph">No preview</div>'}
            <figcaption>${escapeHtml(image.label || 'Still')}${record.primaryId === image.id ? ' · primary' : ''}</figcaption>
            <div class="stsv-row">
                <button type="button" data-act="primary" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}">Primary</button>
                <button type="button" data-act="delete-image" data-key="${escapeAttr(record.key)}" data-image="${escapeAttr(image.id)}">Delete</button>
            </div>
        </figure>
    `;
}

function studioBlock(studio, model) {
    if (studio.stage === 'options') {
        const count = planReferenceSet({
            expressions: parseExpressionList(studio.expressionText),
            includeExpressions: studio.includeExpressions,
            includeTurnaround: studio.includeTurnaround,
            includeCloseups: studio.includeCloseups,
            outfit: studio.outfit,
        }).length;
        const cost = stillCost(count, model.imageModel);
        return `
            <div class="stsv-studio">
                <h4>${studio.outfit ? `Reference set · ${escapeHtml(studio.outfit.name)}` : 'Reference set'}</h4>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeExpressions" ${studio.includeExpressions ? 'checked' : ''}> Expressions</label>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeTurnaround" ${studio.includeTurnaround ? 'checked' : ''}> Turnaround and poses</label>
                <label><input type="checkbox" data-act="studio-flag" data-flag="includeCloseups" ${studio.includeCloseups ? 'checked' : ''}> Face close-ups</label>
                <label>Expressions, one per line
                    <textarea id="stsv-expression-list" name="stsv-expression-list" data-form="expressionText" rows="3">${escapeHtml(studio.expressionText || '')}</textarea>
                </label>
                <p class="stsv-hint">${count} stills · ${escapeHtml(cost.label)}. ${escapeHtml(cost.note)}</p>
                <button type="button" data-act="run-set">Run reference set</button>
                <button type="button" data-act="close-studio">Close</button>
            </div>
        `;
    }
    const items = (studio.items || []).filter((item) => !item.dropped).map((item, index) => `
        <figure class="stsv-thumb" data-item="${index}">
            ${item.dataUrl ? `<img src="${escapeAttr(item.dataUrl)}" alt="${escapeAttr(item.label)}">` : `<div class="stsv-ph">${item.error ? escapeHtml(item.error) : 'Working…'}</div>`}
            <figcaption>${escapeHtml(item.label)}</figcaption>
            <textarea data-item-prompt="${index}" rows="3">${escapeHtml(item.prompt || '')}</textarea>
            <div class="stsv-row">
                ${item.dataUrl && !item.approved ? `<button type="button" data-act="approve-item" data-item="${index}">Approve</button>` : ''}
                <button type="button" data-act="reroll-item" data-item="${index}">Re-roll</button>
                <button type="button" data-act="drop-item" data-item="${index}">Delete</button>
            </div>
            ${studio.stage === 'outfit-preview' && item.dataUrl ? `
                <button type="button" data-act="keep-outfit">Keep just this image</button>
                <button type="button" data-act="full-outfit-set">Build full reference set</button>
            ` : ''}
        </figure>
    `).join('');
    return `<div class="stsv-studio"><h4>${studio.stage === 'outfit-preview' ? 'Outfit preview' : 'Reference set'}</h4><div class="stsv-board-grid">${items}</div><button type="button" data-act="close-studio">Close</button></div>`;
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
        voiceFor: (name) => env.voiceFor?.(name) || '',
        placeName: env.placeDraft().name,
        placeKind: env.placeDraft().kind,
    };
}

export async function onBoardClick(event, env) {
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
    if (act === 'build-set') {
        env.setStudio({
            stage: 'options',
            recordKey: key,
            includeExpressions: true,
            includeTurnaround: true,
            includeCloseups: false,
            expressionText: env.settings().expressionList || '',
            outfit: null,
            items: [],
        });
        env.rerender();
        return;
    }
    if (act === 'close-studio') {
        env.setStudio(null);
        env.rerender();
        return;
    }
    if (act === 'run-set') return runSet(env);
    if (act === 'preview-outfit') return previewOutfit(env, key);
    if (act === 'approve-item') return approveItem(env, Number(button.dataset.item));
    if (act === 'reroll-item') return rerollItem(env, Number(button.dataset.item));
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
            items: [],
        });
        env.rerender();
        return;
    }
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
    if (act === 'extract') return extractAppearance(env, key);
    if (act === 'export-json') return exportJson(env, key);
    if (act === 'primary') {
        const record = env.record(key);
        if (record) record.primaryId = button.dataset.image;
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
    if (act === 'export-sprites') return exportSprites(env, key);
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
        env.save();
        return;
    }
    if (field.dataset.form && key) {
        const forms = env.forms();
        forms[key] = { ...(forms[key] || {}), [field.dataset.form]: field.value };
        return;
    }
    if (field.dataset.form === 'expressionText' && env.studio()) {
        env.studio().expressionText = field.value;
        env.settings().expressionList = field.value;
        env.save();
        return;
    }
    if (field.dataset.form === 'place-name') env.setPlaceDraft({ ...env.placeDraft(), name: field.value });
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
    if (field.dataset.act === 'link-board') {
        linkPersonaBoard(env.library(), field.dataset.persona, field.value);
        env.save();
        env.note('Board link saved.');
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
        env.rerender();
        return;
    }
    if (field.dataset.form === 'place-kind') env.setPlaceDraft({ ...env.placeDraft(), kind: field.value });
    if (field.dataset.act === 'add-image') return readFile(field, (dataUrl) => {
        const record = env.record(field.dataset.key);
        if (!record || !dataUrl) return;
        addImage(record, { dataUrl, label: 'Upload', tags: ['face'], source: 'upload' });
        env.save();
        env.rerender();
    });
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

async function readFile(input, done) {
    const file = input.files?.[0];
    if (!file) return;
    const { blobToDataUrl } = await import('../library.js');
    done(await blobToDataUrl(file));
}

function shownError(error) {
    const explained = explainError(error?.message || error);
    return `${explained.plain} ${explained.fix}`.trim();
}

async function refsFor(env, record, outfitId) {
    const { imagesForPrompt, materializeImage } = await import('../library.js');
    const records = Object.values(env.library().records);
    const sources = [record, ...familyReferences(record, records)].filter(Boolean);
    const urls = [];
    for (const source of sources) {
        const images = imagesForPrompt(source, { outfitId: source === record ? outfitId : '', cap: 2 });
        for (const image of images) {
            const url = await materializeImage(image);
            if (url && !urls.includes(url)) urls.push(url);
        }
    }
    return urls.slice(0, 4);
}

async function runSet(env) {
    const studio = env.studio();
    const record = env.record(studio?.recordKey);
    if (!studio || !record) return;
    const items = planReferenceSet({
        expressions: parseExpressionList(studio.expressionText),
        includeExpressions: studio.includeExpressions,
        includeTurnaround: studio.includeTurnaround,
        includeCloseups: studio.includeCloseups,
        outfit: studio.outfit,
        styleLine: env.styleLine(),
        appearance: record.appearance,
    });
    const cost = stillCost(items.length, env.settings().imageModel);
    if (!(await env.confirmSpend(cost, `Reference set for ${record.name}`))) return;
    studio.stage = 'results';
    studio.items = items.map((item) => ({ ...item, dataUrl: '', error: '', approved: false }));
    env.rerender();
    const references = await refsFor(env, record, studio.outfit?.id);
    for (const item of studio.items) {
        if (env.signal()?.aborted) return;
        try {
            item.dataUrl = await env.generateImage({ prompt: item.prompt, referenceImages: references, label: item.label });
        } catch (error) {
            item.error = shownError(error);
        }
        env.rerender();
    }
    if (cost.usd) env.charge(cost.usd, `Reference set · ${record.name}`);
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
    const cost = stillCost(1, env.settings().imageModel);
    if (!(await env.confirmSpend(cost, `Outfit preview · ${outfit.name}`))) return;
    const prompt = outfitPreviewPrompt({ appearance: record.appearance, styleLine: env.styleLine(), outfit });
    env.setStudio({ stage: 'outfit-preview', recordKey: key, outfit, items: [{ label: outfit.name, prompt, tags: ['outfit', 'full body'], dataUrl: '', error: '' }] });
    env.rerender();
    const references = [...await refsFor(env, record, ''), form.clothingDataUrl].filter(Boolean).slice(0, 4);
    try {
        env.studio().items[0].dataUrl = await env.generateImage({ prompt, referenceImages: references, label: outfit.name });
    } catch (error) {
        env.studio().items[0].error = shownError(error);
    }
    if (cost.usd) env.charge(cost.usd, `Outfit preview · ${outfit.name}`);
    env.rerender();
}

function approveItem(env, index) {
    const studio = env.studio();
    const item = studio?.items?.[index];
    const record = env.record(studio?.recordKey);
    if (!item?.dataUrl || !record) return;
    addImage(record, {
        dataUrl: item.dataUrl,
        label: item.label,
        tags: item.tags || [],
        stLabel: item.stLabel || '',
        prompt: item.prompt || '',
        outfitId: studio.outfit?.id || '',
        source: 'generated',
    });
    item.approved = true;
    env.save();
    env.note(`${item.label} is on the board.`);
    env.rerender();
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
        item.dataUrl = await env.generateImage({
            prompt: item.prompt,
            referenceImages: await refsFor(env, record, studio.outfit?.id),
            label: item.label,
        });
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

async function exportSprites(env, key) {
    const record = env.record(key);
    try {
        const { uploadExpressionSprites } = await import('../sprites.js');
        const labels = await uploadExpressionSprites(record, { headers: env.headers() });
        env.note(`Sent ${labels.join(', ')} to SillyTavern expressions for ${record.stName}.`);
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
    const cost = stillCost(1, env.settings().imageModel);
    if (!(await env.confirmSpend(cost, `Outfit preview · ${proposal.name}`))) return;
    proposal.prompt = proposal.prompt || outfitPreviewPrompt({ appearance: record.appearance, styleLine: env.styleLine(), outfit: proposal });
    proposal.error = '';
    try {
        proposal.previewDataUrl = await env.generateImage({
            prompt: proposal.prompt,
            referenceImages: await refsFor(env, record, ''),
            label: proposal.name,
        });
        if (cost.usd) env.charge(cost.usd, `Outfit preview · ${proposal.name}`);
    } catch (error) {
        proposal.error = shownError(error);
    }
    env.rerender();
}
