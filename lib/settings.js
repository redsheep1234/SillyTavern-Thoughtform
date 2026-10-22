import { MODULE_NAME, defaultSettings } from './constants.js';

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

export function getSettings(context) {
    const bag = context?.extensionSettings;
    if (!bag) return structuredClone(defaultSettings);
    return ensureSettings(bag);
}

export function saveSettings(context) {
    try {
        context?.saveSettingsDebounced?.();
    } catch (error) {
        console.error('[Thoughtform] could not save settings', error);
    }
}
