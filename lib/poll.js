import { abortError, sleep as defaultSleep } from './util.js';

/**
 * Read a job that was already submitted. Each tick is a status check, not a new paid request.
 * @param {object} options
 * @param {AbortSignal} [options.signal]
 * @param {number} [options.intervalMs]
 * @param {number} [options.timeoutMs]
 * @param {(info: {message?: string, progress?: number}) => void} [options.onProgress]
 * @param {() => Promise<{done?: boolean, failed?: boolean, message?: string, progress?: number, value?: any}>} options.tick
 * @param {typeof defaultSleep} [options.sleep]
 */
export async function pollUntil(options) {
    const intervalMs = options.intervalMs ?? 2000;
    const timeoutMs = options.timeoutMs ?? 15 * 60 * 1000;
    const sleep = options.sleep || defaultSleep;
    const started = Date.now();
    while (true) {
        if (options.signal?.aborted) throw abortError();
        const result = await options.tick();
        if (result?.message || result?.progress != null) {
            options.onProgress?.({ message: result.message || '', progress: result.progress });
        }
        if (result?.done) return result.value;
        if (result?.failed) throw new Error(result.message || 'The provider reported a failure.');
        if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for the video. You can try again, or cancel a job that is still running at the provider.');
        await sleep(intervalMs, options.signal);
    }
}
