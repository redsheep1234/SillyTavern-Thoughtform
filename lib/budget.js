/** Spending ledger and the confirmation gate. Amounts are estimates, not invoices. */

export function ledgerTotal(entries, projectId = '') {
    const rows = Array.isArray(entries) ? entries : [];
    return rows.reduce((sum, entry) => {
        if (projectId && entry.projectId !== projectId) return sum;
        const usd = Number(entry.usd);
        return sum + (Number.isFinite(usd) ? usd : 0);
    }, 0);
}

export function recordSpend(entries, { projectId, label, usd }) {
    const amount = Number(usd);
    if (!Number.isFinite(amount) || amount <= 0) return Array.isArray(entries) ? entries : [];
    const next = [...(Array.isArray(entries) ? entries : []), {
        at: new Date().toISOString(),
        projectId: projectId || '',
        label: String(label || 'Render').slice(0, 120),
        usd: Math.round(amount * 1000) / 1000,
    }];
    return next.slice(-50);
}

/**
 * @param {{ ledger?: array, projectId?: string, cap?: number, confirmAbove?: number, estimateUsd?: number|null, known?: boolean }} args
 */
export function assessSpend({ ledger = [], projectId = '', cap = 0, confirmAbove = 0.5, estimateUsd = 0, known = true } = {}) {
    const project = ledgerTotal(ledger, projectId);
    const overall = ledgerTotal(ledger);
    const estimate = estimateUsd == null || !known ? null : Number(estimateUsd);
    const projected = estimate == null ? null : project + estimate;
    const limit = Number(cap) || 0;
    const over = limit > 0 && projected != null && projected > limit + 1e-9;
    const needsConfirm = !known || (estimate != null && estimate >= Number(confirmAbove || 0) && estimate > 0);
    return {
        project: round(project),
        overall: round(overall),
        projected: projected == null ? null : round(projected),
        over,
        needsConfirm: Boolean(needsConfirm || over),
        blocked: over,
    };
}

function round(value) {
    return Math.round(value * 1000) / 1000;
}
