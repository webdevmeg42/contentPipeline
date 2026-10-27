import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_SHORT_START_SEC, dbPath } from './config.js';

// Append-only: never edit a shipped migration, add a new entry instead.
const MIGRATIONS = [
  `
  CREATE TABLE queue (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    title                TEXT NOT NULL,
    description          TEXT,
    audio_path           TEXT NOT NULL,
    visual_path          TEXT NOT NULL,
    visual_vertical_path TEXT,
    motion               TEXT NOT NULL DEFAULT 'static',
    short_start_sec      INTEGER NOT NULL DEFAULT ${DEFAULT_SHORT_START_SEC},
    long_video_path      TEXT,
    short_video_path     TEXT,
    scheduled_at         TEXT NOT NULL,
    status               TEXT NOT NULL DEFAULT 'pending',
    error                TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX idx_queue_status_scheduled ON queue (status, scheduled_at);

  CREATE TABLE post_targets (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id         INTEGER NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
    platform         TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending',
    platform_post_id TEXT,
    attempts         INTEGER NOT NULL DEFAULT 0,
    last_error       TEXT,
    posted_at        TEXT,
    UNIQUE (queue_id, platform)
  );

  CREATE TABLE post_log (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id         INTEGER REFERENCES queue(id),
    platform         TEXT NOT NULL,
    status           TEXT NOT NULL,
    platform_post_id TEXT,
    error            TEXT,
    posted_at        TEXT DEFAULT (datetime('now'))
  );
  `,
];

export function openDb(file = dbPath()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

export function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

export function insertItem(db, item, platforms) {
  const insertQueue = db.prepare(`
    INSERT INTO queue (title, description, audio_path, visual_path, visual_vertical_path, motion, short_start_sec, scheduled_at)
    VALUES (@title, @description, @audioPath, @visualPath, @visualVerticalPath, @motion, @shortStartSec, @scheduledAt)
  `);
  const insertTarget = db.prepare('INSERT INTO post_targets (queue_id, platform) VALUES (?, ?)');
  return db.transaction(() => {
    const id = Number(
      insertQueue.run({
        title: item.title,
        description: item.description ?? null,
        audioPath: item.audioPath,
        visualPath: item.visualPath,
        visualVerticalPath: item.visualVerticalPath ?? null,
        motion: item.motion ?? 'static',
        shortStartSec: item.shortStartSec ?? DEFAULT_SHORT_START_SEC,
        scheduledAt: item.scheduledAt,
      }).lastInsertRowid,
    );
    for (const platform of platforms) insertTarget.run(id, platform);
    return id;
  })();
}

export const getItem = (db, id) => db.prepare('SELECT * FROM queue WHERE id = ?').get(id);

export const getTargets = (db, queueId) =>
  db.prepare('SELECT * FROM post_targets WHERE queue_id = ? ORDER BY id').all(queueId);

export function listItems(db, { status } = {}) {
  return status
    ? db.prepare('SELECT * FROM queue WHERE status = ? ORDER BY scheduled_at, id').all(status)
    : db.prepare('SELECT * FROM queue ORDER BY scheduled_at, id').all();
}

// Returns false if the item is already assembling (or doesn't exist).
export function claimForAssembly(db, id) {
  return (
    db.prepare(`UPDATE queue SET status = 'assembling', error = NULL WHERE id = ? AND status != 'assembling'`).run(id)
      .changes === 1
  );
}

export function markAssembled(db, id, { longVideoPath, shortVideoPath }) {
  db.prepare(
    `UPDATE queue SET status = 'assembled', long_video_path = ?, short_video_path = ?, error = NULL WHERE id = ?`,
  ).run(longVideoPath, shortVideoPath, id);
}

export function markAssemblyFailed(db, id, message) {
  db.prepare(`UPDATE queue SET status = 'assembly_failed', error = ? WHERE id = ?`).run(message, id);
}

// Single-user CLI: anything still 'assembling' at startup was interrupted.
export function resetStuckAssemblies(db) {
  return db.prepare(`UPDATE queue SET status = 'pending' WHERE status = 'assembling'`).run().changes;
}
