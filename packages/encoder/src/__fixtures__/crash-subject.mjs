// Standalone recorder subject for the hard-kill recovery test. Writes fsync'd
// segments + append-only manifest lines forever; the test SIGKILLs it mid-run,
// then verifies the sealed segments are recoverable. Plain ESM so `node` runs
// it directly (no TS toolchain in the child process).
import { openSync, writeSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const manifest = join(dir, 'manifest.jsonl');

function appendSync(path, text) {
  const fd = openSync(path, 'a');
  writeSync(fd, text);
  fsyncSync(fd);
  closeSync(fd);
}

function writeSyncFile(path, buffer) {
  const fd = openSync(path, 'w');
  writeSync(fd, buffer);
  fsyncSync(fd);
  closeSync(fd);
}

writeSyncFile(join(dir, 'init.mp4'), Buffer.from([1, 2, 3, 4]));
appendSync(
  manifest,
  JSON.stringify({
    type: 'start',
    version: 1,
    recordingId: 'crash',
    createdAt: '2026-07-22T00:00:00.000Z',
    trackKind: 'video',
    initSegment: 'init.mp4',
  }) + '\n',
);

let index = 0;
setInterval(() => {
  const name = `seg-${String(index).padStart(6, '0')}.mp4`;
  appendSync(
    manifest,
    JSON.stringify({ type: 'segment-open', index, path: name, startMs: index * 100 }) + '\n',
  );
  writeSyncFile(join(dir, name), Buffer.alloc(128, 0xab));
  appendSync(
    manifest,
    JSON.stringify({ type: 'segment-seal', index, durationMs: 100, bytes: 128 }) + '\n',
  );
  index += 1;
}, 25);

// Signal readiness so the test can start its kill timer.
process.stdout.write('ready\n');
