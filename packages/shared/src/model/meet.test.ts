import { describe, it, expect } from 'vitest';
import { allConsented, pendingConsent, recordConsent, type ConsentLedger } from './meet.js';

describe('consent ledger', () => {
  const ids = ['host', 'a', 'b'];

  it('requires every participant to consent before recording', () => {
    let ledger: ConsentLedger = {};
    ledger = recordConsent(ledger, 'host', true, 1);
    ledger = recordConsent(ledger, 'a', true, 2);
    expect(allConsented(ledger, ids)).toBe(false); // b hasn't
    expect(pendingConsent(ledger, ids)).toEqual(['b']);

    ledger = recordConsent(ledger, 'b', true, 3);
    expect(allConsented(ledger, ids)).toBe(true);
    expect(pendingConsent(ledger, ids)).toEqual([]);
  });

  it('treats a withdrawal as no-consent (last write wins) and logs the time', () => {
    let ledger: ConsentLedger = {};
    ledger = recordConsent(ledger, 'a', true, 10);
    ledger = recordConsent(ledger, 'a', false, 20);
    expect(allConsented(ledger, ['a'])).toBe(false);
    expect(ledger['a']?.atMs).toBe(20);
  });

  it('never allows recording an empty room', () => {
    expect(allConsented({}, [])).toBe(false);
  });
});
