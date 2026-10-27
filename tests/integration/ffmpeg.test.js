import { beforeAll, describe, expect, it } from 'vitest';
import { probe } from '../../src/ffmpeg/probe.js';
import { FfmpegError, runFfmpeg } from '../../src/ffmpeg/run.js';
import { expectDuration, hasFfmpeg, makeFixtures, makeTempDir } from './helpers.js';

describe.skipIf(!hasFfmpeg)('ffmpeg runner and probe', () => {
  let fx;
  beforeAll(() => {
    fx = makeFixtures(makeTempDir());
  });

  it('probes audio', async () => {
    const info = await probe(fx.tone20);
    expect(info).toMatchObject({ hasAudio: true, hasVideo: false, isImage: false });
    expectDuration(info.duration, 20, 0.05);
  });

  it('probes a still image', async () => {
    expect(await probe(fx.still)).toMatchObject({ isImage: true, hasVideo: true, width: 1920, height: 1080 });
  });

  it('probes a video clip', async () => {
    const info = await probe(fx.clip);
    expect(info).toMatchObject({ isImage: false, hasVideo: true, width: 1280, height: 720, videoCodec: 'h264' });
    expectDuration(info.duration, 6, 0.1);
  });

  it('reports progress while encoding', async () => {
    const seen = [];
    await runFfmpeg(['-i', fx.tone20, '-f', 'null', '-'], { totalSec: 20, onProgress: (p) => seen.push(p) });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeGreaterThanOrEqual(90);
    expect(Math.max(...seen)).toBeLessThanOrEqual(100);
  });

  it('throws FfmpegError with the command on failure', async () => {
    const err = await runFfmpeg(['-i', '/nope/missing.wav', '-f', 'null', '-']).catch((e) => e);
    expect(err).toBeInstanceOf(FfmpegError);
    expect(err.command).toContain('/nope/missing.wav');
    expect(err.stderrTail).toMatch(/No such file/);
  });
});
