import { afterEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SegmentWriter } from './segment-writer.js';
import { finalizeTrack, recoverRecording, scanForOrphans } from './recovery.js';
import { nodeDisk, type DiskIO } from './disk.js';

const here = dirname(fileURLToPath(import.meta.url));
const createdAt = '2026-07-22T00:00:00.000Z';
const dirs: string[] = [];

async function tempVault(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'novarec-rec-'));
  dirs.push(dir);
  return dir;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const frag = (n = 64): Uint8Array => new Uint8Array(n).fill(0xab);

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('crash recovery', () => {
  it('reconstructs a playable file from sealed segments after a crash', async () => {
    const vault = await tempVault();
    const dir = join(vault, 'rec1');
    const writer = new SegmentWriter({
      dir,
      recordingId: 'rec1',
      createdAt,
      targetDurationMs: 100,
    });
    await writer.start(new Uint8Array([9, 9, 9, 9])); // 4-byte init
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(50), 40); // seals 2 segments
    // Simulate a crash: no stop() is ever called.

    const sealed = writer.state.segments.filter((s) => s.sealed);
    const sealedBytes = sealed.reduce((sum, s) => sum + s.bytes, 0);

    const orphans = await scanForOrphans(vault);
    expect(orphans).toHaveLength(1);
    const [orphan] = orphans;
    if (!orphan) throw new Error('expected one orphan');
    expect(orphan.sealedSegmentCount).toBe(sealed.length);

    const result = await recoverRecording(orphan.dir);
    expect(result.segmentCount).toBe(sealed.length);
    const output = await readFile(result.outputPath);
    expect(output.length).toBe(4 + sealedBytes); // init + sealed segments only

    // Once recovered, it is no longer flagged as an orphan.
    expect(await scanForOrphans(vault)).toHaveLength(0);
  });

  it('labels a WebM-fallback recording .webm, not .mp4', async () => {
    const vault = await tempVault();
    const dir = join(vault, 'webm');
    const writer = new SegmentWriter({
      dir,
      recordingId: 'webm',
      createdAt,
      targetDurationMs: 100,
    });
    // EBML magic (0x1A45DFA3) — what MediaRecorder writes when it falls back to
    // WebM on a host that can't record MP4, despite the .mp4 segment names.
    await writer.start(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00]));
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(50), 40);

    const [orphan] = await scanForOrphans(vault);
    if (!orphan) throw new Error('expected one orphan');
    const result = await recoverRecording(orphan.dir);
    expect(result.outputPath.endsWith('.webm')).toBe(true);
  });

  it('drops the torn, unsealed trailing segment', async () => {
    const vault = await tempVault();
    const dir = join(vault, 'rec2');
    const writer = new SegmentWriter({
      dir,
      recordingId: 'rec2',
      createdAt,
      targetDurationMs: 100,
    });
    await writer.start(new Uint8Array([1, 1]));
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(50), 40); // 2 sealed segments
    await writer.writeFragment(frag(50), 40); // opens a 3rd, unsealed segment
    // crash — no stop

    const sealed = writer.state.segments.filter((s) => s.sealed);
    expect(writer.state.segments.length).toBe(sealed.length + 1); // one unsealed

    const [orphan] = await scanForOrphans(vault);
    if (!orphan) throw new Error('expected one orphan');
    const result = await recoverRecording(orphan.dir);
    expect(result.segmentCount).toBe(sealed.length);
    const output = await readFile(result.outputPath);
    expect(output.length).toBe(2 + sealed.reduce((s, seg) => s + seg.bytes, 0));
  });

  it('tolerates a torn final manifest line during recovery', async () => {
    const vault = await tempVault();
    const dir = join(vault, 'rec3');
    const writer = new SegmentWriter({
      dir,
      recordingId: 'rec3',
      createdAt,
      targetDurationMs: 100,
    });
    await writer.start(new Uint8Array([7]));
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(), 40);
    // Simulate a crash mid-manifest-append: append a half-written line.
    await appendFile(join(dir, 'manifest.jsonl'), '{"type":"segment-open","index":9,"pa');

    const [orphan] = await scanForOrphans(vault);
    if (!orphan) throw new Error('expected one orphan');
    const result = await recoverRecording(orphan.dir);
    expect(result.segmentCount).toBeGreaterThanOrEqual(1);
  });

  it('finalizes a cleanly-stopped track into one playable file', async () => {
    const vault = await tempVault();
    const dir = join(vault, 'final');
    const writer = new SegmentWriter({
      dir,
      recordingId: 'final',
      createdAt,
      targetDurationMs: 100,
    });
    await writer.start(new Uint8Array([1, 2]));
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(50), 40);
    await writer.stop(1000);

    const result = await finalizeTrack(dir);
    if (!result) throw new Error('expected a finalized track');
    const sealedBytes = writer.state.segments
      .filter((s) => s.sealed)
      .reduce((sum, s) => sum + s.bytes, 0);
    expect((await readFile(result.path)).length).toBe(2 + sealedBytes);
  });

  it('recovers data from a hard-killed process', { timeout: 20_000 }, async () => {
    const vault = await tempVault();
    const dir = join(vault, 'killed');
    const subject = join(here, '__fixtures__', 'crash-subject.mjs');

    const child = spawn(process.execPath, [subject, dir], { stdio: 'ignore' });
    try {
      // Deterministic under load: wait until the subject has actually sealed a
      // segment before killing it, instead of racing a fixed timer.
      const deadline = Date.now() + 15_000;
      for (;;) {
        const [candidate] = await scanForOrphans(vault);
        if (candidate && candidate.sealedSegmentCount >= 1) break;
        if (Date.now() > deadline) throw new Error('subject never sealed a segment');
        await sleep(25);
      }
    } finally {
      child.kill('SIGKILL');
    }
    await sleep(80); // let the OS release file handles

    const [orphan] = await scanForOrphans(vault);
    if (!orphan) throw new Error('expected an orphan after the kill');
    expect(orphan.sealedSegmentCount).toBeGreaterThanOrEqual(1);

    const result = await recoverRecording(orphan.dir);
    expect(result.segmentCount).toBeGreaterThanOrEqual(1);
    const output = await readFile(result.outputPath);
    expect(output.length).toBeGreaterThan(4); // init + at least one 128-byte segment
  });
});

describe('crash recovery after a torn manifest line', () => {
  async function tornRecording(vault: string, name: string): Promise<string> {
    const dir = join(vault, name);
    const writer = new SegmentWriter({ dir, recordingId: name, createdAt, targetDurationMs: 100 });
    await writer.start(new Uint8Array([7]));
    for (let i = 0; i < 6; i += 1) await writer.writeFragment(frag(), 40);
    await appendFile(join(dir, 'manifest.jsonl'), '{"type":"segment-open","index":9,"pa');
    return dir;
  }

  it('is recovered once, not offered again on every launch', async () => {
    const vault = await tempVault();
    await tornRecording(vault, 'torn');

    const [orphan] = await scanForOrphans(vault);
    if (!orphan) throw new Error('expected one orphan');
    await recoverRecording(orphan.dir);

    expect(await scanForOrphans(vault)).toEqual([]);
  });

  it('reads a stop that an older build fused onto the torn line', async () => {
    const vault = await tempVault();
    const dir = await tornRecording(vault, 'fused');
    // What recovery wrote before the fix: the stop with no newline before it.
    await appendFile(
      join(dir, 'manifest.jsonl'),
      '{"type":"stop","atMs":240,"status":"recovered"}\n',
    );

    expect(await scanForOrphans(vault)).toEqual([]);
  });

  it('one unreadable manifest does not hide the other orphans', async () => {
    const vault = await tempVault();
    await tornRecording(vault, 'locked');
    await tornRecording(vault, 'readable');
    const lockedDisk: DiskIO = {
      ...nodeDisk,
      async readText(path) {
        if (path.includes('locked')) throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        return nodeDisk.readText(path);
      },
    };

    const orphans = await scanForOrphans(vault, lockedDisk);
    expect(orphans.map((o) => o.recordingId)).toEqual(['readable']);
  });
});
