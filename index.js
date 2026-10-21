import { boot } from './lib/boot.js';

/** Named export used by SillyTavern's manifest hook. */
export function onActivate() {
    boot();
}

boot();
