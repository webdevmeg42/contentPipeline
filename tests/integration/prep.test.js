import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { probe } from '../../src/ffmpeg/probe.js';
import { prepAudio } from '../../src/prep.js';
import { expectDuration, hasFfmpeg, makeFixtures, makeTempDir, measureLufs } from './helpers.js';

describe.skipIf(!hasFfmpeg)('prepAudio', () => {
  let dir;
  let fx;
  beforeAll(() => {
    dir = makeTempDir();
    fx = makeFixtures(dir);
  });

  it('normalizes loudness to the target without changing length', async () => {
    const output = path.join(dir, 'plain.flac');
    const result = await prepAudio({ input: fx.tone20, output, fadeInSec: 0, fadeOutSec: 0 });
    expect(result).toMatchObject({ output, looped: false });
    const info = await probe(output);
    expect(info.audioCodec).toBe('flac');
    expectDuration(info.duration, 20, 0.1);
    const lufs = await measureLufs(output);
    expect(lufs).toBeGreaterThan(-19);
    expect(lufs).toBeLessThan(-17);
  });

  it('trims both ends and applies default fades', async () => {
    const output = path.join(dir, 'trimmed.flac');
    const result = await prepAudio({ input: fx.tone20, output, trimStartSec: 2, trimEndSec: 3 });
    expectDuration(result.durationSec, 15, 0.01);
    expectDuration((await probe(output)).duration, 15, 0.1);
  });

  it('loops with crossfades to reach the target duration and cleans up temp files', async () => {
    const output = path.join(dir, 'looped.flac');
    const result = await prepAudio({ input: fx.tone20, output, durationSec: 45 });
    expect(result).toMatchObject({ output, durationSec: 45, looped: true });
    expectDuration((await probe(output)).duration, 45, 0.1);
    expect(fs.readdirSync(dir).filter((f) => /\.(normalized|part)\./.test(f))).toEqual([]);
  });

  it('rejects a missing input', async () => {
    await expect(prepAudio({ input: path.join(dir, 'nope.wav') })).rejects.toThrow(/Input not found/);
  });

  it('rejects a recording too short to loop before encoding anything', async () => {
    const output = path.join(dir, 'short.flac');
    await expect(prepAudio({ input: fx.tone20, output, trimEndSec: 12, durationSec: 60 })).rejects.toThrow(
      /too short to loop/,
    );
    expect(fs.existsSync(output)).toBe(false);
  });
});
