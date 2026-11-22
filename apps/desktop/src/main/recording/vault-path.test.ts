import { describe, expect, it } from 'vitest';
import { join, resolve } from 'node:path';
import { isStrictlyInside } from './vault-path.js';

const vault = resolve('/data/NovaRec/recordings');
const custom = resolve('/videos');

describe('isStrictlyInside', () => {
  it('accepts a recording folder and anything within it', () => {
    expect(isStrictlyInside(join(vault, 'abc'), [vault])).toBe(true);
    expect(isStrictlyInside(join(vault, 'abc', 'screen'), [vault])).toBe(true);
  });

  it('refuses the vault root itself, so a delete can never wipe every recording', () => {
    expect(isStrictlyInside(vault, [vault])).toBe(false);
    expect(isStrictlyInside(`${vault}/`, [vault])).toBe(false);
    expect(isStrictlyInside(join(vault, 'abc', '..'), [vault])).toBe(false);
  });

  it('refuses siblings, parents and traversal out of the vault', () => {
    expect(isStrictlyInside(`${vault}-backup`, [vault])).toBe(false);
    expect(isStrictlyInside(resolve(vault, '..'), [vault])).toBe(false);
    expect(isStrictlyInside(join(vault, '..', 'other'), [vault])).toBe(false);
  });

  it('accepts recordings in any known vault, so changing storage keeps old ones usable', () => {
    expect(isStrictlyInside(join(vault, 'old'), [custom, vault])).toBe(true);
    expect(isStrictlyInside(join(custom, 'new'), [custom, vault])).toBe(true);
    expect(isStrictlyInside(custom, [custom, vault])).toBe(false);
  });
});
