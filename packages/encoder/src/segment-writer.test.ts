import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SegmentWriter } from './segment-writer.js';
import { parseEvents, reduceEvents, totalDurationMs } from './manifest.js';
import { DiskFullError, nodeDisk, type DiskIO } from './disk.js';

const createdAt = '2026-07-22T00:00:00.000Z';
const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'novarec-seg-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const frag = (n = 64): Uint8Array => new Uint8Array(n).fill(0xab);

describe('SegmentWriter', () => {
  it('N pause cycles yield N+1 segments, all sealed', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({
      dir,
      recordingId: 'r',
      createdAt,
      targetDurationMs: 100_000,
    });
    await writer.start(new Uint8Array([1, 2, 3]));

    const N = 3;
    for (let i = 0; i < N; i += 1) {
      await writer.writeFragment(frag(), 50);
      await writer.pause(i * 1000);
      await writer.resume(i * 1000);
    }
    await writer.writeFragment(frag(), 50);
    const state = await writer.stop(9999);

    expect(state.segments).toHaveLength(N + 1);
    expect(state.segments.every((s) => s.sealed)).toBe(true);
  });

  it('concatenated segment duration equals recorded wall-clock', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({ dir, recordingId: 'r', createdAt, targetDurationMs: 100 });
    let total = 0;
    for (let i = 0; i < 10; i += 1) {
      await writer.writeFragment(frag(), 30);
      total += 30;
    }
    const state = await writer.stop(1000);
    expect(totalDurationMs(state)).toBe(total);
  });

  it('auto-seals when a segment reaches the target duration', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({ dir, recordingId: 'r', createdAt, targetDurationMs: 100 });
    for (let i = 0; i < 9; i += 1) await writer.writeFragment(frag(), 30); // 270ms
    const state = await writer.stop(1000);
    expect(state.segments.length).toBeGreaterThanOrEqual(3);
  });

  it('writes sealed segment files whose sizes match the manifest', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({ dir, recordingId: 'r', createdAt, targetDurationMs: 100 });
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(64), 40);
    const state = await writer.stop(1000);
    for (const seg of state.segments.filter((s) => s.sealed)) {
      expect((await stat(join(dir, seg.path))).size).toBe(seg.bytes);
    }
  });

  it('stops gracefully on disk-full, preserving already-sealed segments', async () => {
    const dir = await tempDir();
    let appends = 0;
    const failing: DiskIO = {
      ...nodeDisk,
      async appendAndSync(path, data) {
        appends += 1;
        if (appends > 8) throw Object.assign(new Error('no space left'), { code: 'ENOSPC' });
        return nodeDisk.appendAndSync(path, data);
      },
    };

    const writer = new SegmentWriter({
      dir,
      recordingId: 'r',
      createdAt,
      targetDurationMs: 100,
      disk: failing,
    });
    await writer.start();

    let diskFull = false;
    try {
      for (let i = 0; i < 30; i += 1) await writer.writeFragment(frag(), 40);
    } catch (err) {
      diskFull = err instanceof DiskFullError;
    }
    expect(diskFull).toBe(true);

    // Graceful stop must never throw, even with a full disk.
    await expect(writer.stop(1000)).resolves.toBeDefined();

    // Whatever reached disk is still a clean, replayable manifest with sealed data.
    const state = reduceEvents(parseEvents(await readFile(join(dir, 'manifest.jsonl'), 'utf8')));
    expect(state.segments.some((s) => s.sealed)).toBe(true);
  });
});

describe('SegmentWriter under concurrency and manifest failures', () => {
  /** A disk whose manifest appends are slow, to widen any race window. */
  const slowManifestDisk: DiskIO = {
    ...nodeDisk,
    async appendAndSync(path, data) {
      if (path.endsWith('manifest.jsonl')) await new Promise((r) => setTimeout(r, 15));
      await nodeDisk.appendAndSync(path, data);
    },
  };

  it('a pause that overlaps a fragment write neither drops it nor seals a missing file', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({
      dir,
      recordingId: 'r',
      createdAt,
      targetDurationMs: 100_000,
      disk: slowManifestDisk,
    });
    await writer.start(new Uint8Array([1]));

    // Issued together, as the main process does with concurrent IPC calls.
    await Promise.all([writer.writeFragment(frag(64), 50), writer.pause(50)]);
    await writer.resume(50);
    await writer.writeFragment(frag(64), 50);
    const state = await writer.stop(200);

    expect(totalDurationMs(state)).toBe(100);
    for (const segment of state.segments.filter((s) => s.sealed)) {
      // Every sealed segment must exist on disk with the bytes it claims.
      expect((await stat(join(dir, segment.path))).size).toBe(segment.bytes);
    }
  });

  it('starting twice at once writes one start line', async () => {
    const dir = await tempDir();
    const writer = new SegmentWriter({ dir, recordingId: 'r', createdAt, disk: slowManifestDisk });
    await Promise.all([writer.start(new Uint8Array([1])), writer.start()]);
    const text = await readFile(join(dir, 'manifest.jsonl'), 'utf8');
    expect(parseEvents(text).filter((e) => e.type === 'start')).toHaveLength(1);
  });

  it('a failed segment-open line does not strand the fragments that follow', async () => {
    const dir = await tempDir();
    let failNextOpen = true;
    const flaky: DiskIO = {
      ...nodeDisk,
      async appendAndSync(path, data) {
        if (failNextOpen && new TextDecoder().decode(data).includes('"segment-open"')) {
          failNextOpen = false;
          throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        }
        await nodeDisk.appendAndSync(path, data);
      },
    };
    const writer = new SegmentWriter({
      dir,
      recordingId: 'r',
      createdAt,
      targetDurationMs: 100_000,
      disk: flaky,
    });
    await writer.start(new Uint8Array([1]));

    await expect(writer.writeFragment(frag(), 50)).rejects.toThrow('locked');
    await writer.writeFragment(frag(), 50);
    await writer.writeFragment(frag(), 50);
    await writer.stop(1000);

    // Read back what recovery and export will see.
    const state = reduceEvents(parseEvents(await readFile(join(dir, 'manifest.jsonl'), 'utf8')));
    expect(totalDurationMs(state)).toBe(100);
    expect(state.segments.every((s) => s.sealed)).toBe(true);
  });

  it('a failed seal line keeps the segment open so a later seal records it', async () => {
    const dir = await tempDir();
    let failNextSeal = true;
    const flaky: DiskIO = {
      ...nodeDisk,
      async appendAndSync(path, data) {
        if (failNextSeal && new TextDecoder().decode(data).includes('"segment-seal"')) {
          failNextSeal = false;
          throw Object.assign(new Error('locked'), { code: 'EBUSY' });
        }
        await nodeDisk.appendAndSync(path, data);
      },
    };
    const writer = new SegmentWriter({
      dir,
      recordingId: 'r',
      createdAt,
      targetDurationMs: 40,
      disk: flaky,
    });
    await writer.start(new Uint8Array([1]));

    // Reaches the target, so it tries to seal — and that seal line fails.
    await expect(writer.writeFragment(frag(), 50)).rejects.toThrow('locked');
    await writer.stop(1000);

    const state = reduceEvents(parseEvents(await readFile(join(dir, 'manifest.jsonl'), 'utf8')));
    expect(state.segments).toHaveLength(1);
    expect(state.segments[0]?.sealed).toBe(true);
    expect(totalDurationMs(state)).toBe(50);
  });
});
