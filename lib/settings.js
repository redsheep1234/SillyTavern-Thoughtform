import { MODULE_NAME, defaultSettings } from './constants.js';
import { flushSettings } from './keep.js';
import { GEMINI_IMAGE_ID } from './providers/image.js';

function fill(target, defaults) {
    for (const [key, value] of Object.entries(defaults)) {
        if (!Object.hasOwn(target, key) || target[key] == null) {
            target[key] = structuredClone(value);
        } else if (value && typeof value === 'object' && !Array.isArray(value) && typeof target[key] === 'object' && !Array.isArray(target[key])) {
            fill(target[key], value);
        }
    }
    return target;
}

/** @param {Record<string, any>} extensionSettings SillyTavern extension_settings bag. */
export function ensureSettings(extensionSettings) {
    if (!extensionSettings[MODULE_NAME] || typeof extensionSettings[MODULE_NAME] !== 'object') {
        extensionSettings[MODULE_NAME] = {};
    }
    return fill(extensionSettings[MODULE_NAME], defaultSettings);
}

/** Pick Gemini once an OpenRouter key exists and the user has not chosen a picture model. */
export function preferStillModel(settings) {
    if (!settings || settings.imageModelChosen === true) return false;
    const key = String(settings.openrouterKey || '').trim();
    const current = settings.imageModel || 'mock';
    if (!key || current !== 'mock') return false;
    settings.imageModel = GEMINI_IMAGE_ID;
    return true;
}

export function getSettings(context) {
    const bag = context?.extensionSettings;
    if (!bag) return structuredClone(defaultSettings);
    const settings = ensureSettings(bag);
    if (preferStillModel(settings)) saveSettings(context);
    return settings;
}

export function saveSettings(context) {
    try {
        const pending = flushSettings(context);
        if (pending?.catch) pending.catch((error) => console.error('[Thoughtform] could not save settings', error));
    } catch (error) {
        console.error('[Thoughtform] could not save settings', error);
    }
}
