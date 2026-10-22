/** Spending ledger and the confirmation gate. Amounts are estimates, not invoices. */

export function ledgerTotal(entries, projectId = '') {
    const rows = Array.isArray(entries) ? entries : [];
    return rows.reduce((sum, entry) => {
        if (projectId && entry.projectId !== projectId) return sum;
        const usd = Number(entry.usd);
        return sum + (Number.isFinite(usd) ? usd : 0);
    }, 0);
}

/** UTC midnight, so a daily cap does not depend on the browser's timezone label. */
export function dayStartIso(now = new Date()) {
    const date = now instanceof Date ? now : new Date(now);
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())).toISOString();
}

export function ledgerSlice(entries, { since = '', sessionId = '' } = {}) {
    const rows = Array.isArray(entries) ? entries : [];
    const total = rows.reduce((sum, entry) => {
        if (since && String(entry?.at || '') < since) return sum;
        if (sessionId && entry?.sessionId !== sessionId) return sum;
        const usd = Number(entry?.usd);
        return sum + (Number.isFinite(usd) ? usd : 0);
    }, 0);
    return Math.round(total * 1000) / 1000;
}

export function recordSpend(entries, { projectId, label, usd, sessionId = '' }) {
    const amount = Number(usd);
    if (!Number.isFinite(amount) || amount <= 0) return Array.isArray(entries) ? entries : [];
    const next = [...(Array.isArray(entries) ? entries : []), {
        at: new Date().toISOString(),
        projectId: projectId || '',
        sessionId: sessionId || '',
        label: String(label || 'Render').slice(0, 120),
        usd: Math.round(amount * 1000) / 1000,
    }];
    return next.slice(-50);
}

/**
 * @param {{ ledger?: array, projectId?: string, cap?: number, confirmAbove?: number, estimateUsd?: number|null, known?: boolean }} args
 */
export function assessSpend({
    ledger = [],
    projectId = '',
    cap = 0,
    dayCap = 0,
    sessionCap = 0,
    sessionId = '',
    now = new Date(),
    confirmAbove = 0.5,
    estimateUsd = 0,
    known = true,
} = {}) {
    const project = ledgerTotal(ledger, projectId);
    const overall = ledgerTotal(ledger);
    const day = ledgerSlice(ledger, { since: dayStartIso(now) });
    const session = sessionId ? ledgerSlice(ledger, { sessionId }) : 0;
    const estimate = estimateUsd == null || !known ? null : Number(estimateUsd);
    const projected = estimate == null ? null : project + estimate;
    const projectedDay = estimate == null ? null : day + estimate;
    const projectedSession = estimate == null ? null : session + estimate;
    const limit = Number(cap) || 0;
    const dayLimit = Number(dayCap) || 0;
    const sessionLimit = Number(sessionCap) || 0;
    const overFilm = limit > 0 && projected != null && projected > limit + 1e-9;
    const overDay = dayLimit > 0 && projectedDay != null && projectedDay > dayLimit + 1e-9;
    const overSession = sessionLimit > 0 && projectedSession != null && projectedSession > sessionLimit + 1e-9;
    const over = overFilm || overDay || overSession;
    const capKind = overSession ? 'session' : overDay ? 'day' : overFilm ? 'film' : '';
    const needsConfirm = !known || (estimate != null && estimate >= Number(confirmAbove || 0) && estimate > 0);
    return {
        project: round(project),
        overall: round(overall),
        day: round(day),
        session: round(session),
        projected: projected == null ? null : round(projected),
        projectedDay: projectedDay == null ? null : round(projectedDay),
        projectedSession: projectedSession == null ? null : round(projectedSession),
        over,
        capKind,
        needsConfirm: Boolean(needsConfirm || over),
        blocked: over,
    };
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
