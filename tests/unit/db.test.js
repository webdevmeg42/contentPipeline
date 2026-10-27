import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimForAssembly,
  getItem,
  getTargets,
  insertItem,
  listItems,
  markAssembled,
  markAssemblyFailed,
  migrate,
  openDb,
  resetStuckAssemblies,
} from '../../src/db.js';

const item = (overrides = {}) => ({
  title: 'Summer Night Frogs',
  audioPath: '/audio/frogs.flac',
  visualPath: '/visuals/pond.jpg',
  scheduledAt: '2026-10-29T00:00:00.000Z',
  ...overrides,
});

let db;
beforeEach(() => {
  db = openDb(':memory:');
});
afterEach(() => db.close());

describe('migrations', () => {
  it('migrates an empty database to the latest version and is idempotent', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    expect(tables).toEqual(expect.arrayContaining(['queue', 'post_targets', 'post_log']));
    migrate(db);
    expect(db.pragma('user_version', { simple: true })).toBe(1);
  });
});

describe('insertItem', () => {
  it('stores the item with defaults and one target per platform', () => {
    const id = insertItem(db, item(), ['youtube', 'instagram']);
    expect(getItem(db, id)).toMatchObject({
      id,
      title: 'Summer Night Frogs',
      description: null,
      audio_path: '/audio/frogs.flac',
      visual_path: '/visuals/pond.jpg',
      visual_vertical_path: null,
      motion: 'static',
      short_start_sec: 30,
      status: 'pending',
      long_video_path: null,
      short_video_path: null,
      error: null,
    });
    expect(getTargets(db, id).map((t) => [t.platform, t.status, t.attempts])).toEqual([
      ['youtube', 'pending', 0],
      ['instagram', 'pending', 0],
    ]);
  });

  it('keeps optional fields when given', () => {
    const id = insertItem(
      db,
      item({ description: 'Rain frogs', visualVerticalPath: '/v/tall.jpg', motion: 'slow-zoom', shortStartSec: 5020 }),
      ['tiktok'],
    );
    expect(getItem(db, id)).toMatchObject({
      description: 'Rain frogs',
      visual_vertical_path: '/v/tall.jpg',
      motion: 'slow-zoom',
      short_start_sec: 5020,
    });
  });

  it('rolls back the whole insert when a target fails', () => {
    expect(() => insertItem(db, item(), ['youtube', 'youtube'])).toThrow(/UNIQUE/);
    expect(listItems(db)).toHaveLength(0);
  });

  it('deletes targets when the item is deleted', () => {
    const id = insertItem(db, item(), ['youtube']);
    db.prepare('DELETE FROM queue WHERE id = ?').run(id);
    expect(getTargets(db, id)).toEqual([]);
  });
});

describe('listItems', () => {
  it('orders by schedule and filters by status', () => {
    const late = insertItem(db, item({ scheduledAt: '2026-11-02T00:00:00.000Z' }), ['youtube']);
    const early = insertItem(db, item({ scheduledAt: '2026-11-01T00:00:00.000Z' }), ['youtube']);
    markAssemblyFailed(db, late, 'boom');
    expect(listItems(db).map((r) => r.id)).toEqual([early, late]);
    expect(listItems(db, { status: 'assembly_failed' }).map((r) => r.id)).toEqual([late]);
  });
});

describe('assembly state', () => {
  it('claims an item once', () => {
    const id = insertItem(db, item(), ['youtube']);
    expect(claimForAssembly(db, id)).toBe(true);
    expect(getItem(db, id).status).toBe('assembling');
    expect(claimForAssembly(db, id)).toBe(false);
  });

  it('records success and clears a previous error', () => {
    const id = insertItem(db, item(), ['youtube']);
    markAssemblyFailed(db, id, 'first try failed');
    claimForAssembly(db, id);
    markAssembled(db, id, { longVideoPath: '/out/1-long.mp4', shortVideoPath: '/out/1-short.mp4' });
    expect(getItem(db, id)).toMatchObject({
      status: 'assembled',
      long_video_path: '/out/1-long.mp4',
      short_video_path: '/out/1-short.mp4',
      error: null,
    });
  });

  it('records failure', () => {
    const id = insertItem(db, item(), ['youtube']);
    markAssemblyFailed(db, id, 'ffmpeg exploded');
    expect(getItem(db, id)).toMatchObject({ status: 'assembly_failed', error: 'ffmpeg exploded' });
  });

  it('resets items stuck in assembling', () => {
    const id = insertItem(db, item(), ['youtube']);
    claimForAssembly(db, id);
    expect(resetStuckAssemblies(db)).toBe(1);
    expect(getItem(db, id).status).toBe('pending');
  });
});
