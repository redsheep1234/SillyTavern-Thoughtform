import assert from 'node:assert/strict';
import test from 'node:test';
import { assessSpend, dayStartIso, ledgerSlice, recordSpend } from '../lib/budget.js';
import { overCapMessage } from '../lib/simple.js';

test('a visit cap and a daily cap confirm before the next paid job', () => {
    const now = new Date('2026-10-22T15:00:00.000Z');
    const yesterday = new Date('2026-10-21T15:00:00.000Z').toISOString();
    let ledger = recordSpend([], { usd: 1, label: 'Yesterday', sessionId: 'old' });
    ledger[0].at = yesterday;
    ledger = recordSpend(ledger, { usd: 0.4, label: 'Earlier today', sessionId: 'other' });
    ledger[1].at = '2026-10-22T01:00:00.000Z';
    ledger = recordSpend(ledger, { usd: 0.2, label: 'This visit', sessionId: 'visit-1' });
    ledger[2].at = '2026-10-22T14:00:00.000Z';
    assert.equal(dayStartIso(now), '2026-10-22T00:00:00.000Z');
    assert.equal(ledgerSlice(ledger, { since: dayStartIso(now) }), 0.6);
    assert.equal(ledgerSlice(ledger, { sessionId: 'visit-1' }), 0.2);
    const visit = assessSpend({
        ledger,
        sessionId: 'visit-1',
        sessionCap: 0.3,
        dayCap: 5,
        cap: 10,
        estimateUsd: 0.2,
        known: true,
        now,
    });
    assert.equal(visit.blocked, true);
    assert.equal(visit.capKind, 'session');
    assert.match(overCapMessage({ projectedUsd: visit.projectedSession, capAud: 0.45, kind: 'session' }), /this visit/);
    const day = assessSpend({
        ledger,
        sessionId: 'visit-1',
        sessionCap: 5,
        dayCap: 0.7,
        cap: 10,
        estimateUsd: 0.2,
        known: true,
        now,
    });
    assert.equal(day.capKind, 'day');
    assert.match(overCapMessage({ projectedUsd: day.projectedDay, capAud: 1, kind: 'day' }), /today/);
    const film = assessSpend({ ledger: [{ usd: 3 }], cap: 3.3, estimateUsd: 0.5, known: true, now });
    assert.equal(film.blocked, true);
    assert.equal(film.capKind, 'film');
});
