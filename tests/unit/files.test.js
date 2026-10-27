import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { partPath, writeAtomically } from '../../src/files.js';

describe('partPath', () => {
  it('inserts the tag before the extension so FFmpeg still sees the format', () => {
    expect(partPath('/x/12-long.mp4')).toBe('/x/12-long.part.mp4');
    expect(partPath('/x/a.prepped.flac', 'normalized')).toBe('/x/a.prepped.normalized.flac');
  });
});

describe('writeAtomically', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-files-'));
  });

  it('renames the part file into place on success', async () => {
    const final = path.join(dir, 'out.mp4');
    await writeAtomically(final, async (part) => fs.writeFileSync(part, 'video'));
    expect(fs.readFileSync(final, 'utf8')).toBe('video');
    expect(fs.existsSync(partPath(final))).toBe(false);
  });

  it('removes the part file and rethrows on failure', async () => {
    const final = path.join(dir, 'out.mp4');
    await expect(
      writeAtomically(final, async (part) => {
        fs.writeFileSync(part, 'half');
        throw new Error('encode failed');
      }),
    ).rejects.toThrow('encode failed');
    expect(fs.existsSync(final)).toBe(false);
    expect(fs.existsSync(partPath(final))).toBe(false);
  });
});
