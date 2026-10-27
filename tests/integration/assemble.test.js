import fs from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assembleItem } from '../../src/assemble.js';
import { getItem, insertItem, openDb } from '../../src/db.js';
import { probe } from '../../src/ffmpeg/probe.js';
import { expectDuration, hasFfmpeg, makeFixtures, makeTempDir } from './helpers.js';

describe.skipIf(!hasFfmpeg)('assembleItem', () => {
  let dir;
  let fx;
  let db;
  const fast = { segmentSec: 5 }; // keeps encodes to seconds; still exercises the clip crossfade (5 > 2 × 2s)

  beforeAll(() => {
    dir = makeTempDir();
    fx = makeFixtures(dir);
    process.env.FCS_OUTPUT_DIR = path.join(dir, 'videos');
  });
  afterAll(() => {
    delete process.env.FCS_OUTPUT_DIR;
  });
  beforeEach(() => {
    db = openDb(':memory:');
  });
  afterEach(() => db.close());

  const queue = (overrides = {}) =>
    insertItem(
      db,
      {
        title: 'Test',
        audioPath: fx.tone75,
        visualPath: fx.still,
        shortStartSec: 5,
        scheduledAt: '2026-10-29T00:00:00.000Z',
        ...overrides,
      },
      ['youtube', 'instagram'],
    );

  async function expectVideo(file, { width, height, duration }) {
    const info = await probe(file);
    expect(info).toMatchObject({ width, height, videoCodec: 'h264', audioCodec: 'aac' });
    expectDuration(info.duration, duration, 0.2);
  }

  it('builds a 16:9 long video and a 9:16 short from a photo', async () => {
    const id = queue();
    const result = await assembleItem(db, id, fast);
    await expectVideo(result.longVideoPath, { width: 1920, height: 1080, duration: 75 });
    await expectVideo(result.shortVideoPath, { width: 1080, height: 1920, duration: 60 });
    expect(result.warnings).toEqual([]);
    expect(getItem(db, id)).toMatchObject({
      status: 'assembled',
      long_video_path: result.longVideoPath,
      short_video_path: result.shortVideoPath,
      error: null,
    });
    expect(fs.readdirSync(process.env.FCS_OUTPUT_DIR).filter((f) => f.includes('.part.'))).toEqual([]);
  });

  it('loops a video clip and warns that it is below 1080p', async () => {
    const result = await assembleItem(db, queue({ visualPath: fx.clip }), fast);
    await expectVideo(result.longVideoPath, { width: 1920, height: 1080, duration: 75 });
    await expectVideo(result.shortVideoPath, { width: 1080, height: 1920, duration: 60 });
    expect(result.warnings).toEqual(['Visual is 1280x720; below 1920x1080 it will look soft']);
  });

  it('renders slow zoom and uses the vertical override for the short', async () => {
    const result = await assembleItem(db, queue({ motion: 'slow-zoom', visualVerticalPath: fx.clip }), fast);
    await expectVideo(result.longVideoPath, { width: 1920, height: 1080, duration: 75 });
    await expectVideo(result.shortVideoPath, { width: 1080, height: 1920, duration: 60 });
  });

  it('marks the item failed when the short runs past the end of the audio', async () => {
    const id = queue({ shortStartSec: 30 });
    await expect(assembleItem(db, id, fast)).rejects.toThrow(/runs past the end of the audio/);
    expect(getItem(db, id)).toMatchObject({ status: 'assembly_failed', error: expect.stringMatching(/runs past/) });
  });

  it('marks the item failed when an input file has gone missing', async () => {
    const id = queue({ visualPath: path.join(dir, 'deleted.jpg') });
    await expect(assembleItem(db, id, fast)).rejects.toThrow(/Visual not found/);
    expect(getItem(db, id).status).toBe('assembly_failed');
  });

  it('refuses to assemble an unknown id', async () => {
    await expect(assembleItem(db, 999, fast)).rejects.toThrow(/No queue item with id 999/);
  });
});
