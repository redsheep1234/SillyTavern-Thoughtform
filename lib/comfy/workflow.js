const TEXT_FIELD = /^(text|prompt|positive_prompt|negative_prompt|string)$/;
const NEGATIVE_TITLE = /negative/;
const POSITIVE_TITLE = /positive|prompt/;

function titleOf(node) {
    return String(node?._meta?.title || '');
}

function inputEntries(node) {
    return Object.entries(node?.inputs || {}).filter(([, value]) => value == null || !Array.isArray(value));
}

function isTextNode(node) {
    const type = String(node?.class_type || '');
    if (/textencode|prompt|conditioning/i.test(type) && inputEntries(node).some(([key]) => TEXT_FIELD.test(key))) return true;
    return inputEntries(node).some(([key]) => /^(text|positive_prompt|negative_prompt)$/.test(key));
}

function textFields(node) {
    return inputEntries(node).map(([key]) => key).filter((key) => TEXT_FIELD.test(key) || /prompt/i.test(key));
}

/**
 * Find where a scene should be written inside a ComfyUI API-format graph.
 * Titles win. Common Wan, Hunyuan, and LTX field names are the fallback.
 * @param {Record<string, any>} workflow
 */
export function detectMapping(workflow) {
    const mapping = {
        prompt: null,
        negative: null,
        seeds: [],
        steps: [],
        rates: [],
        width: null,
        height: null,
        frames: null,
        fps: null,
        image: null,
    };
    const textNodes = [];
    for (const [id, node] of Object.entries(workflow || {})) {
        if (!node || typeof node !== 'object' || !node.class_type) continue;
        const title = titleOf(node).toLowerCase();
        const type = String(node.class_type);
        if (isTextNode(node)) {
            for (const field of textFields(node)) {
                textNodes.push({ id, field, title, node });
            }
        }
        for (const [field, value] of inputEntries(node)) {
            if (/^(seed|noise_seed)$/.test(field) && typeof value !== 'object') mapping.seeds.push({ node: id, field });
            if (field === 'steps' && /sample|ksampler|scheduler/i.test(type)) mapping.steps.push({ node: id, field });
        }
        if (/loadimage/i.test(type) && node.inputs && 'image' in node.inputs) {
            mapping.image = { node: id, field: 'image' };
        }
        const sizeScore = /latent|empty|img2video|imagetovideo|wan/i.test(type) ? 2 : 1;
        if (node.inputs && 'width' in node.inputs && !Array.isArray(node.inputs.width)) {
            if (!mapping.width || sizeScore >= (mapping.width.score || 0)) mapping.width = { node: id, field: 'width', score: sizeScore };
        }
        if (node.inputs && 'height' in node.inputs && !Array.isArray(node.inputs.height)) {
            if (!mapping.height || sizeScore >= (mapping.height.score || 0)) mapping.height = { node: id, field: 'height', score: sizeScore };
        }
        for (const field of ['length', 'num_frames', 'frame_count', 'video_frames']) {
            if (node.inputs && field in node.inputs && !Array.isArray(node.inputs[field])) {
                const frameScore = /latent|empty|video|wan|ltx/i.test(type) ? 2 : 1;
                if (!mapping.frames || frameScore >= (mapping.frames.score || 0)) mapping.frames = { node: id, field, score: frameScore };
            }
        }
        for (const field of ['fps', 'frame_rate']) {
            if (node.inputs && field in node.inputs && !Array.isArray(node.inputs[field])) {
                const fpsScore = /video|vhs|combine|conditioning/i.test(type) ? 2 : 1;
                const slot = { node: id, field, score: fpsScore };
                mapping.rates.push(slot);
                if (!mapping.fps || fpsScore >= (mapping.fps.score || 0)) mapping.fps = slot;
            }
        }
        if (NEGATIVE_TITLE.test(title) && textFields(node)[0] && !mapping.negative) {
            mapping.negative = { node: id, field: textFields(node).find((field) => /negative/.test(field)) || textFields(node)[0] };
        }
        if (POSITIVE_TITLE.test(title) && !NEGATIVE_TITLE.test(title) && textFields(node)[0] && !mapping.prompt) {
            mapping.prompt = { node: id, field: textFields(node).find((field) => /positive|^text$|^prompt$/.test(field)) || textFields(node)[0] };
        }
    }

    const unusedText = textNodes.filter((item) => item.id !== mapping.prompt?.node || item.field !== mapping.prompt?.field);
    if (!mapping.negative) {
        const negativeField = unusedText.find((item) => /negative/.test(item.field) || NEGATIVE_TITLE.test(item.title));
        const negativeText = unusedText.find((item) => /blurry|low quality|watermark|worst quality|deformed/.test(JSON.stringify(item.node.inputs || {}).toLowerCase()));
        const chosen = negativeField || negativeText;
        if (chosen) mapping.negative = { node: chosen.id, field: chosen.field };
    }
    if (!mapping.prompt) {
        const chosen = textNodes.find((item) => item.id !== mapping.negative?.node || item.field !== mapping.negative?.field) || textNodes[0];
        if (chosen) mapping.prompt = { node: chosen.id, field: chosen.field };
    }
    return mapping;
}

export function parseWorkflowJson(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Workflow is not valid JSON. ${error.message}`);
    }
    if (data && Array.isArray(data.nodes)) {
        throw new Error('This is a ComfyUI canvas file. Enable Dev Mode, then use Save (API Format) or Export (API), and import that file.');
    }
    if (data?.prompt && typeof data.prompt === 'object' && !Array.isArray(data.prompt)) {
        const innerHasNodes = Object.values(data.prompt).some((node) => node?.class_type);
        if (innerHasNodes) data = data.prompt;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Workflow JSON must be an object of node ids.');
    }
    const nodes = Object.values(data).filter((node) => node && node.class_type);
    if (!nodes.length) throw new Error('No nodes with class_type were found. Export the workflow in API format.');
    return data;
}

export function parseMappingOverride(text) {
    if (!String(text || '').trim()) return null;
    let data;
    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Node mapping is not valid JSON. ${error.message}`);
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Node mapping must be a JSON object.');
    return data;
}

function mergeMapping(detected, override) {
    if (!override) return detected;
    const mapping = { ...detected, seeds: [...detected.seeds], steps: [...detected.steps], rates: [...(detected.rates || [])] };
    for (const key of ['prompt', 'negative', 'width', 'height', 'frames', 'fps', 'image']) {
        if (override[key]) mapping[key] = override[key];
    }
    if (Array.isArray(override.seeds)) mapping.seeds = override.seeds;
    if (Array.isArray(override.steps)) mapping.steps = override.steps;
    if (override.seed) mapping.seeds = [override.seed];
    if (override.step) mapping.steps = [override.step];
    return mapping;
}

function writeField(workflow, slot, value, warnings, label) {
    if (!slot?.node) return;
    const node = workflow[slot.node];
    if (!node?.inputs || !(slot.field in node.inputs)) {
        warnings.push(`Could not set ${label}: node ${slot.node} has no input "${slot.field}".`);
        return;
    }
    node.inputs[slot.field] = value;
}

/**
 * @param {Record<string, any>} workflow
 * @param {object} scene
 * @param {object|null} override
 */
export function applySceneToWorkflow(workflow, scene, override = null) {
    const graph = structuredClone(workflow);
    const mapping = mergeMapping(detectMapping(graph), override);
    const warnings = [];
    if (!mapping.prompt) {
        throw new Error('No prompt input was found. Name a node title "Positive Prompt", or set a node mapping.');
    }
    writeField(graph, mapping.prompt, scene.prompt, warnings, 'prompt');
    if (mapping.negative && scene.negativePrompt) writeField(graph, mapping.negative, scene.negativePrompt, warnings, 'negative prompt');
    for (const slot of mapping.seeds) writeField(graph, slot, scene.seed, warnings, 'seed');
    for (const slot of mapping.steps) {
        if (scene.steps != null) writeField(graph, slot, scene.steps, warnings, 'steps');
    }
    if (scene.width != null) writeField(graph, mapping.width, scene.width, warnings, 'width');
    if (scene.height != null) writeField(graph, mapping.height, scene.height, warnings, 'height');
    if (scene.frames != null) writeField(graph, mapping.frames, scene.frames, warnings, 'frame count');
    if (scene.fps != null) {
        const rateSlots = mapping.rates?.length ? mapping.rates : [mapping.fps].filter(Boolean);
        for (const slot of rateSlots) writeField(graph, slot, scene.fps, warnings, 'fps');
    }
    if (scene.imageName && mapping.image) writeField(graph, mapping.image, scene.imageName, warnings, 'init image');
    if (scene.imageName && !mapping.image) warnings.push('An init image was provided, but the workflow has no LoadImage node.');
    return { workflow: graph, mapping, warnings };
}

/** Drop editor metadata before POST /prompt. */
export function toPromptGraph(workflow) {
    const prompt = {};
    for (const [id, node] of Object.entries(workflow)) {
        if (!node?.class_type || !node.inputs) continue;
        prompt[id] = { class_type: node.class_type, inputs: node.inputs };
    }
    return prompt;
}

export function findOutputFile(historyEntry) {
    const outputs = historyEntry?.outputs || {};
    const files = [];
    for (const output of Object.values(outputs)) {
        for (const key of ['videos', 'gifs', 'images']) {
            for (const file of output?.[key] || []) {
                if (file?.filename) files.push(file);
            }
        }
    }
    const video = files.find((file) => /\.(mp4|webm|mkv|mov|gif)$/i.test(file.filename));
    return video || null;
}
