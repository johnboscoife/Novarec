import { describe, it, expect } from 'vitest';
import {
  allConsented,
  normalizeMeetUrl,
  pendingConsent,
  recordConsent,
  type ConsentLedger,
} from './meet.js';

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

describe('normalizeMeetUrl', () => {
  it('accepts a full Google Meet URL and canonicalizes it', () => {
    expect(normalizeMeetUrl('https://meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(normalizeMeetUrl('http://meet.google.com/abc-defg-hij?authuser=0')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
  });

  it('accepts a bare code or host/code', () => {
    expect(normalizeMeetUrl('abc-defg-hij')).toBe('https://meet.google.com/abc-defg-hij');
    expect(normalizeMeetUrl('meet.google.com/abc-defg-hij')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
  });

  it('maps /new to the new-meeting URL', () => {
    expect(normalizeMeetUrl('https://meet.google.com/new')).toBe('https://meet.google.com/new');
  });

  it('rejects non-Meet hosts and junk (never opens a foreign link)', () => {
    expect(normalizeMeetUrl('https://evil.example.com/abc-defg-hij')).toBeNull();
    expect(normalizeMeetUrl('https://meet.google.com.evil.com/abc-defg-hij')).toBeNull();
    expect(normalizeMeetUrl('not a link')).toBeNull();
    expect(normalizeMeetUrl('')).toBeNull();
    expect(normalizeMeetUrl('javascript:alert(1)')).toBeNull();
  });
});
