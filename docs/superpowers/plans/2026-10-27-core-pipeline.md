# Core Pipeline (Sub-project A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A CLI that prepares long field recordings, queues content in SQLite, and assembles a 16:9 long video plus a 9:16 60-second short with FFmpeg.

**Architecture:** Pure argument-builder modules (`src/ffmpeg/*Args.js`) produce FFmpeg argument arrays and are unit-tested exhaustively; a single runner (`src/ffmpeg/run.js`) spawns FFmpeg/ffprobe; orchestrators (`src/prep.js`, `src/assemble.js`) wire probe → args → run → filesystem/DB and are integration-tested against real FFmpeg on generated fixtures. `src/db.js` owns SQLite and knows nothing about FFmpeg.

**Tech Stack:** Node.js 22 (ESM JavaScript), better-sqlite3, commander, Vitest, FFmpeg/ffprobe (Homebrew).

**Spec:** `docs/superpowers/specs/2026-10-27-core-pipeline-design.md`

---

## Conventions

- All paths are relative to the repo root (`contentPipeline/`).
- Commit after every task. End each commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` if an agent is committing.
- `npm test` = unit tests (fast, no FFmpeg). `npm run test:integration` = real FFmpeg + CLI tests.
- Before Task 5, verify `ffmpeg -version` and `ffprobe -version` work. If not, stop and ask the user — do not install anything.

## File map

| File | Responsibility |
|---|---|
| `package.json`, `vitest.config.js`, `.gitignore` | Project scaffold |
| `src/config.js` | Paths (env-overridable), constants, platform list + mapping, `parsePlatforms` |
| `src/time.js` | `parseDuration`, `formatDuration`, `localToUtcIso`, `toLocalDisplay` |
| `src/db.js` | Schema/migrations, queue + target queries, assembly state transitions |
| `src/files.js` | `partPath`, `writeAtomically` |
| `src/ffmpeg/run.js` | `runFfmpeg`, `runFfprobe`, `FfmpegError`, `FfmpegMissingError`, `formatCommand`, `progressPercent` |
| `src/ffmpeg/probe.js` | `probe`, `parseProbe` |
| `src/ffmpeg/prepArgs.js` | `buildMeasureArgs`, `parseLoudnorm`, `buildNormalizeArgs`, `loopCopies`, `buildLoopArgs` |
| `src/ffmpeg/videoArgs.js` | `buildSegmentArgs`, `buildMuxArgs`, `zoomExpr` |
| `src/prep.js` | `prepAudio`, `defaultPrepOutput` |
| `src/assemble.js` | `inspectInputs`, `assembleItem` |
| `src/index.js` | CLI: `prep`, `add`, `assemble`, `list`, `status` |
| `tests/unit/*.test.js` | Unit tests per module |
| `tests/integration/helpers.js` | FFmpeg detection, fixture generation, loudness + duration helpers |
| `tests/integration/*.test.js` | Real FFmpeg + CLI tests |

---

### Task 1: Scaffold and config

**Files:**
- Create: `package.json`, `vitest.config.js`, `.gitignore`, `src/config.js`
- Test: `tests/unit/config.test.js`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "florida-country-sounds",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "fcs": "node src/index.js",
    "test": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:all": "vitest run"
  }
}
```

- [ ] **Step 2: Install dependencies**

Run: `npm install better-sqlite3 commander && npm install --save-dev vitest`
Expected: installs without errors; `package.json` gains `dependencies` and `devDependencies`.

- [ ] **Step 3: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
.env
.DS_Store
db/
output/
assets/
```

- [ ] **Step 5: Write the failing test** — `tests/unit/config.test.js`

```js
import { describe, expect, it } from 'vitest';
import { PLATFORMS, PLATFORM_VIDEO, parsePlatforms } from '../../src/config.js';

describe('parsePlatforms', () => {
  it('splits, trims, lowercases and dedupes', () => {
    expect(parsePlatforms(' YouTube,instagram ,youtube')).toEqual(['youtube', 'instagram']);
  });

  it('rejects unknown platforms and names them', () => {
    expect(() => parsePlatforms('youtube,myspace')).toThrow(/Unknown platform\(s\): myspace/);
  });

  it('rejects an empty list', () => {
    expect(() => parsePlatforms(' , ')).toThrow(/At least one platform/);
  });
});

describe('PLATFORM_VIDEO', () => {
  it('maps each platform to the video it needs', () => {
    expect(PLATFORM_VIDEO.youtube).toBe('long');
    expect(PLATFORM_VIDEO.facebook).toBe('long');
    expect(PLATFORM_VIDEO.youtube_shorts).toBe('short');
    expect(PLATFORM_VIDEO.instagram).toBe('short');
    expect(PLATFORM_VIDEO.tiktok).toBe('short');
    expect(PLATFORM_VIDEO.bluesky).toBe('short');
    expect(PLATFORM_VIDEO.substack).toBeNull();
    expect(PLATFORMS).toHaveLength(7);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/config.js`.

- [ ] **Step 7: Implement `src/config.js`**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Functions, not constants, so tests can set env vars before use.
export const dbPath = () => process.env.FCS_DB_PATH ?? path.join(ROOT, 'db', 'queue.db');
export const audioDir = () => path.join(ROOT, 'assets', 'audio');
export const videosDir = () => process.env.FCS_OUTPUT_DIR ?? path.join(ROOT, 'output', 'videos');

export const TIMEZONE = 'America/New_York';

export const PLATFORM_VIDEO = {
  youtube: 'long',
  facebook: 'long',
  youtube_shorts: 'short',
  instagram: 'short',
  tiktok: 'short',
  bluesky: 'short',
  substack: null,
};
export const PLATFORMS = Object.keys(PLATFORM_VIDEO);

export const MOTIONS = ['static', 'slow-zoom'];
export const DEFAULT_SHORT_START_SEC = 30;

export const AUDIO = {
  sampleRate: 48000,
  highpassHz: 80,
  denoiseFilter: 'afftdn=nr=10:nf=-50',
  lufs: -18,
  truePeak: -1.5,
  lra: 11,
  loopCrossfadeSec: 5,
  fadeInSec: 3,
  fadeOutSec: 10,
};

export const VIDEO = {
  long: { width: 1920, height: 1080 },
  short: { width: 1080, height: 1920 },
  fps: 30,
  crf: 20,
  preset: 'slow',
  segmentSec: 60,
  zoomAmount: 0.08,
  clipCrossfadeSec: 2,
  shortSec: 60,
  shortFadeSec: 1,
  audioBitrate: '192k',
};

export function parsePlatforms(input) {
  const list = input.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (list.length === 0) throw new Error('At least one platform is required');
  const unknown = list.filter((p) => !PLATFORMS.includes(p));
  if (unknown.length) {
    throw new Error(`Unknown platform(s): ${unknown.join(', ')}. Valid: ${PLATFORMS.join(', ')}`);
  }
  return [...new Set(list)];
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore src/config.js tests/unit/config.test.js
git commit -m "chore: scaffold project with config and platform parsing"
```

---

### Task 2: Time parsing and timezone conversion

**Files:**
- Create: `src/time.js`
- Test: `tests/unit/time.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/time.test.js`

```js
import { describe, expect, it } from 'vitest';
import { formatDuration, localToUtcIso, parseDuration, toLocalDisplay } from '../../src/time.js';

describe('parseDuration', () => {
  it.each([
    ['90', 90],
    ['90s', 90],
    ['45m', 2700],
    ['2h', 7200],
    ['1.5h', 5400],
    ['1:30', 90],
    ['1:23:40', 5020],
    ['0:05', 5],
    [' 10s ', 10],
  ])('parses %j', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '1:2', '1:60', '1:60:00', '-5', '5x'])('rejects %j', (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });
});

describe('formatDuration', () => {
  it.each([
    [5020, '1:23:40'],
    [59.6, '0:01:00'],
    [0, '0:00:00'],
  ])('formats %d', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

describe('localToUtcIso', () => {
  it.each([
    ['2026-10-28T20:00', '2026-10-29T00:00:00.000Z'], // EDT, UTC-4
    ['2026-10-28 20:00:30', '2026-10-29T00:00:30.000Z'],
    ['2026-12-15T20:00', '2026-12-16T01:00:00.000Z'], // EST, UTC-5
    ['2026-10-31T12:00', '2026-10-31T16:00:00.000Z'], // day before DST ends
    ['2026-11-01T12:00', '2026-11-01T17:00:00.000Z'], // DST ended 2am that morning
  ])('converts Florida time %s', (input, expected) => {
    expect(localToUtcIso(input)).toBe(expected);
  });

  it.each(['2026-10-28', '2026-13-01T10:00', '2026-02-30T10:00', '2026-10-28T20:00Z', '2026-10-28T25:00'])(
    'rejects %j',
    (input) => {
      expect(() => localToUtcIso(input)).toThrow(/Invalid schedule/);
    },
  );
});

describe('toLocalDisplay', () => {
  it('shows a UTC timestamp in Florida time', () => {
    expect(toLocalDisplay('2026-10-29T00:00:00.000Z')).toBe('2026-10-28 20:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/time.test.js`
Expected: FAIL — cannot resolve `../../src/time.js`.

- [ ] **Step 3: Implement `src/time.js`**

```js
import { TIMEZONE } from './config.js';

export function parseDuration(input) {
  const text = String(input).trim();
  const invalid = () => new Error(`Invalid duration "${input}". Use e.g. 90, 90s, 45m, 2h, 1:30, 1:23:40`);

  const unit = /^(\d+(?:\.\d+)?)([smh]?)$/.exec(text);
  if (unit) return Number(unit[1]) * { '': 1, s: 1, m: 60, h: 3600 }[unit[2]];

  const clock = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:\.\d+)?)$/.exec(text);
  if (!clock) throw invalid();
  const [, hours, minutes, seconds] = clock;
  if (Number(seconds) >= 60 || (hours !== undefined && Number(minutes) >= 60)) throw invalid();
  return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

export function formatDuration(totalSec) {
  const t = Math.round(totalSec);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Milliseconds to add to a UTC instant to get wall-clock time in timeZone.
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const wallAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

export function localToUtcIso(input, timeZone = TIMEZONE) {
  const invalid = () => new Error(`Invalid schedule "${input}". Use YYYY-MM-DDTHH:MM in Florida local time`);
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(input).trim());
  if (!m) throw invalid();
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d || h > 23 || mi > 59 || s > 59) {
    throw invalid();
  }
  // Guess using the offset at the wall time, then correct with the offset at the guess (handles DST edges).
  let utc = wall - tzOffsetMs(new Date(wall), timeZone);
  utc = wall - tzOffsetMs(new Date(utc), timeZone);
  return new Date(utc).toISOString();
}

const displayFormat = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export const toLocalDisplay = (iso) => displayFormat.format(new Date(iso));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/time.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/time.js tests/unit/time.test.js
git commit -m "feat: add duration parsing and Florida-time scheduling"
```

---

### Task 3: SQLite queue

**Files:**
- Create: `src/db.js`
- Test: `tests/unit/db.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/db.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/db.test.js`
Expected: FAIL — cannot resolve `../../src/db.js`.

- [ ] **Step 3: Implement `src/db.js`**

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/db.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db.js tests/unit/db.test.js
git commit -m "feat: add SQLite queue with per-platform targets"
```

---

### Task 4: Atomic file writes

**Files:**
- Create: `src/files.js`
- Test: `tests/unit/files.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/files.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/files.test.js`
Expected: FAIL — cannot resolve `../../src/files.js`.

- [ ] **Step 3: Implement `src/files.js`**

```js
import fs from 'node:fs';
import path from 'node:path';

export function partPath(file, tag = 'part') {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${tag}${ext}`;
}

// Calls write(partPath) and renames to finalPath only if it succeeds,
// so an interrupted encode never leaves a complete-looking file behind.
export async function writeAtomically(finalPath, write) {
  const part = partPath(finalPath);
  try {
    await write(part);
    fs.renameSync(part, finalPath);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/files.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/files.js tests/unit/files.test.js
git commit -m "feat: add atomic write helper for encode outputs"
```

---

### Task 5: FFmpeg runner and probe

**Files:**
- Create: `src/ffmpeg/run.js`, `src/ffmpeg/probe.js`, `tests/integration/helpers.js`
- Test: `tests/unit/run.test.js`, `tests/unit/probe.test.js`, `tests/integration/ffmpeg.test.js`

- [ ] **Step 0: Verify FFmpeg is available**

Run: `ffmpeg -hide_banner -version | head -1 && ffprobe -hide_banner -version | head -1`
Expected: two version lines. If either command is not found, stop and ask the user.

- [ ] **Step 1: Write the failing unit tests**

`tests/unit/run.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { FfmpegError, formatCommand, progressPercent } from '../../src/ffmpeg/run.js';

describe('formatCommand', () => {
  it('leaves safe args bare and single-quotes the rest', () => {
    expect(
      formatCommand('ffmpeg', ['-i', 'my file.wav', '-af', 'loudnorm=I=-18:print_format=json', '-vf', "zoompan=z='1+0.1'"]),
    ).toBe(`ffmpeg -i 'my file.wav' -af loudnorm=I=-18:print_format=json -vf 'zoompan=z='\\''1+0.1'\\'''`);
  });
});

describe('progressPercent', () => {
  it.each([
    ['out_time_us=30000000', 60, 50],
    ['out_time_us=90000000', 60, 100],
    ['frame=10', 60, null],
    ['out_time_us=N/A', 60, null],
    ['out_time_us=1000000', 0, null],
    ['out_time_us=1000000', undefined, null],
  ])('%s of %ss → %s', (line, total, expected) => {
    expect(progressPercent(line, total)).toBe(expected);
  });
});

describe('FfmpegError', () => {
  it('keeps the last 20 lines of stderr and the command', () => {
    const stderr = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const err = new FfmpegError({ bin: 'ffmpeg', exitCode: 1, stderr, command: 'ffmpeg -i x' });
    expect(err.message).toBe('ffmpeg failed with exit code 1');
    expect(err.command).toBe('ffmpeg -i x');
    const tail = err.stderrTail.split('\n');
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe('line 11');
    expect(tail.at(-1)).toBe('line 30');
  });
});
```

`tests/unit/probe.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { parseProbe } from '../../src/ffmpeg/probe.js';

describe('parseProbe', () => {
  it('reads an audio file', () => {
    expect(
      parseProbe({
        streams: [{ codec_type: 'audio', codec_name: 'pcm_s16le' }],
        format: { format_name: 'wav', duration: '20.000000' },
      }),
    ).toEqual({
      duration: 20,
      width: 0,
      height: 0,
      hasVideo: false,
      hasAudio: true,
      isImage: false,
      videoCodec: null,
      audioCodec: 'pcm_s16le',
    });
  });

  it('flags still images', () => {
    expect(
      parseProbe({
        streams: [{ codec_type: 'video', codec_name: 'png', width: 1920, height: 1080 }],
        format: { format_name: 'png_pipe' },
      }),
    ).toMatchObject({ duration: 0, width: 1920, height: 1080, hasVideo: true, isImage: true, videoCodec: 'png' });
  });

  it('treats image2 (jpeg) as an image and mp4 as video', () => {
    const jpg = { streams: [{ codec_type: 'video', codec_name: 'mjpeg', width: 4032, height: 3024 }], format: { format_name: 'image2' } };
    const mp4 = {
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
      format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '6.016000' },
    };
    expect(parseProbe(jpg).isImage).toBe(true);
    expect(parseProbe(mp4)).toMatchObject({ isImage: false, hasVideo: true, hasAudio: true, duration: 6.016 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/run.test.js tests/unit/probe.test.js`
Expected: FAIL — cannot resolve `src/ffmpeg/run.js` / `src/ffmpeg/probe.js`.

- [ ] **Step 3: Implement `src/ffmpeg/run.js`**

```js
import { spawn } from 'node:child_process';

const STDERR_TAIL_LINES = 20;

export class FfmpegMissingError extends Error {
  constructor(bin) {
    super(`${bin} not found. Install FFmpeg with: brew install ffmpeg`);
    this.name = 'FfmpegMissingError';
  }
}

export class FfmpegError extends Error {
  constructor({ bin, exitCode, stderr, command }) {
    super(`${bin} failed with exit code ${exitCode}`);
    this.name = 'FfmpegError';
    this.exitCode = exitCode;
    this.command = command;
    this.stderrTail = stderr.trimEnd().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
  }
}

export function formatCommand(bin, args) {
  return [bin, ...args]
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
    .join(' ');
}

export function progressPercent(line, totalSec) {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match || !(totalSec > 0)) return null;
  return Math.min(100, (Number(match[1]) / 1e6 / totalSec) * 100);
}

function spawnCollect(bin, args, onStdoutLine) {
  const command = formatCommand(bin, args);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (!onStdoutLine) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(onStdoutLine);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => reject(err.code === 'ENOENT' ? new FfmpegMissingError(bin) : err));
    child.on('close', (exitCode) => {
      if (exitCode === 0) resolve({ stdout, stderr, command });
      else reject(new FfmpegError({ bin, exitCode, stderr, command }));
    });
  });
}

export function runFfmpeg(args, { totalSec, onProgress } = {}) {
  const fullArgs = ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', ...args];
  return spawnCollect('ffmpeg', fullArgs, (line) => {
    const pct = progressPercent(line, totalSec);
    if (pct !== null) onProgress?.(pct);
  });
}

export const runFfprobe = (args) => spawnCollect('ffprobe', args);
```

- [ ] **Step 4: Implement `src/ffmpeg/probe.js`**

```js
import { runFfprobe } from './run.js';

export async function probe(file) {
  const { stdout } = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return parseProbe(JSON.parse(stdout));
}

export function parseProbe(info) {
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(info.format.duration) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    // Still images are demuxed by image2 (jpeg/tiff) or a *_pipe demuxer (png, webp).
    isImage: /^image2$|_pipe$/.test(info.format.format_name),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}
```

- [ ] **Step 5: Run unit tests to verify they pass**

Run: `npm test`
Expected: PASS (all unit tests so far).

- [ ] **Step 6: Create integration helpers** — `tests/integration/helpers.js`

```js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { parseLoudnorm } from '../../src/ffmpeg/prepArgs.js';
import { runFfmpeg } from '../../src/ffmpeg/run.js';

export const hasFfmpeg =
  spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0;

if (!hasFfmpeg) {
  console.warn('FFmpeg not found — skipping FFmpeg integration tests. Install with: brew install ffmpeg');
}

export const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-test-'));

function ffmpeg(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (result.status !== 0) throw new Error(`Fixture generation failed: ${result.stderr}`);
}

// Generated at test time so no binary fixtures are committed.
export function makeFixtures(dir) {
  const f = {
    tone20: path.join(dir, 'tone20.wav'),
    tone75: path.join(dir, 'tone75.wav'),
    still: path.join(dir, 'still.png'),
    clip: path.join(dir, 'clip.mp4'),
  };
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20:sample_rate=48000', '-ac', '2', f.tone20]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=330:duration=75:sample_rate=48000', '-ac', '2', f.tone75]);
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x3d6b4f:s=1920x1080', '-frames:v', '1', f.still]);
  ffmpeg(['-f', 'lavfi', '-i', 'testsrc=duration=6:size=1280x720:rate=30', '-pix_fmt', 'yuv420p', f.clip]);
  return f;
}

export async function measureLufs(file) {
  const { stderr } = await runFfmpeg(['-i', file, '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  return Number(parseLoudnorm(stderr).input_i);
}

export function expectDuration(actual, expected, tolerance) {
  expect(Math.abs(actual - expected), `duration ${actual} vs ${expected}`).toBeLessThan(tolerance);
}
```

Note: `helpers.js` imports `parseLoudnorm` from `src/ffmpeg/prepArgs.js`, which is created in Task 6. The integration test below doesn't use `measureLufs`, but the import must resolve, so create a stub now:

`src/ffmpeg/prepArgs.js` (temporary — fully replaced in Task 6):

```js
export function parseLoudnorm() {
  throw new Error('not implemented');
}
```

- [ ] **Step 7: Write the integration test** — `tests/integration/ffmpeg.test.js`

```js
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
```

- [ ] **Step 8: Run integration test to verify it passes**

Run: `npx vitest run tests/integration/ffmpeg.test.js`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add src/ffmpeg/run.js src/ffmpeg/probe.js src/ffmpeg/prepArgs.js tests/unit/run.test.js tests/unit/probe.test.js tests/integration/helpers.js tests/integration/ffmpeg.test.js
git commit -m "feat: add ffmpeg runner with progress and typed errors, plus ffprobe wrapper"
```

---

### Task 6: Audio prep argument builders

**Files:**
- Modify: `src/ffmpeg/prepArgs.js` (replace the stub entirely)
- Test: `tests/unit/prepArgs.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/prepArgs.test.js`

```js
import { describe, expect, it } from 'vitest';
import { buildLoopArgs, buildMeasureArgs, buildNormalizeArgs, loopCopies, parseLoudnorm } from '../../src/ffmpeg/prepArgs.js';

const FLAC_OUT = ['-ar', '48000', '-ac', '2', '-c:a', 'flac', '-sample_fmt', 's16'];

const measured = {
  input_i: '-21.03',
  input_tp: '-14.50',
  input_lra: '0.00',
  input_thresh: '-31.03',
  target_offset: '0.01',
};

const LOUDNORM_STDERR = `
[Parsed_loudnorm_3 @ 0x600001234] 
{
	"input_i" : "-21.03",
	"input_tp" : "-14.50",
	"input_lra" : "0.00",
	"input_thresh" : "-31.03",
	"output_i" : "-18.01",
	"output_tp" : "-11.48",
	"output_lra" : "0.00",
	"output_thresh" : "-28.01",
	"normalization_type" : "dynamic",
	"target_offset" : "0.01"
}
[out#0/null @ 0x600001] video:0KiB audio:3750KiB
`;

describe('buildMeasureArgs', () => {
  it('trims, high-passes and measures loudness', () => {
    expect(buildMeasureArgs({ input: 'in.wav', startSec: 10, endSec: 110, denoise: false, lufs: -18 })).toEqual([
      '-i',
      'in.wav',
      '-af',
      'atrim=start=10:end=110,asetpts=PTS-STARTPTS,highpass=f=80,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ]);
  });

  it('adds gentle denoise after the high-pass when asked', () => {
    const af = buildMeasureArgs({ input: 'in.wav', startSec: 0, endSec: 20, denoise: true, lufs: -18 })[3];
    expect(af).toContain('highpass=f=80,afftdn=nr=10:nf=-50,loudnorm=');
  });
});

describe('parseLoudnorm', () => {
  it('extracts the measurement JSON from stderr', () => {
    expect(parseLoudnorm(LOUDNORM_STDERR)).toMatchObject(measured);
  });

  it('rejects silent audio', () => {
    expect(() => parseLoudnorm(LOUDNORM_STDERR.replace('"-21.03"', '"-inf"'))).toThrow(/silent/);
  });

  it('rejects output with no measurement', () => {
    expect(() => parseLoudnorm('nothing here')).toThrow(/loudnorm measurement/);
  });
});

describe('buildNormalizeArgs', () => {
  it('applies the measured values in linear mode, then fades', () => {
    expect(
      buildNormalizeArgs({
        input: 'in.wav',
        output: 'out.flac',
        startSec: 0,
        endSec: 20,
        denoise: false,
        lufs: -18,
        measured,
        fadeInSec: 3,
        fadeOutSec: 10,
      }),
    ).toEqual([
      '-i',
      'in.wav',
      '-af',
      'atrim=start=0:end=20,asetpts=PTS-STARTPTS,highpass=f=80,' +
        'loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=-21.03:measured_TP=-14.50:measured_LRA=0.00:measured_thresh=-31.03:offset=0.01:linear=true,' +
        'aresample=48000,afade=t=in:d=3,afade=t=out:st=10:d=10',
      ...FLAC_OUT,
      'out.flac',
    ]);
  });

  it('omits fades when they are zero', () => {
    const af = buildNormalizeArgs({ input: 'in.wav', output: 'o.flac', startSec: 0, endSec: 20, denoise: false, lufs: -18, measured })[3];
    expect(af.endsWith('aresample=48000')).toBe(true);
  });
});

describe('loopCopies', () => {
  it.each([
    [20, 45, 5, 3],
    [2700, 7200, 5, 3],
    [20, 20, 5, 1],
  ])('source %ss → target %ss with %ss crossfade needs %i copies', (source, target, xf, expected) => {
    expect(loopCopies(source, target, xf)).toBe(expected);
  });

  it.each([8, 10])('rejects a %ss source as too short for a 5s crossfade', (source) => {
    expect(() => loopCopies(source, 60, 5)).toThrow(/too short to loop/);
  });
});

describe('buildLoopArgs', () => {
  it('chains crossfades across copies, trims to length, then fades', () => {
    expect(
      buildLoopArgs({ input: 'n.flac', output: 'o.flac', copies: 3, crossfadeSec: 5, durationSec: 45, fadeInSec: 3, fadeOutSec: 10 }),
    ).toEqual([
      '-i',
      'n.flac',
      '-i',
      'n.flac',
      '-i',
      'n.flac',
      '-filter_complex',
      '[0:a][1:a]acrossfade=d=5[x1];[x1][2:a]acrossfade=d=5[x2];[x2]atrim=end=45,afade=t=in:d=3,afade=t=out:st=35:d=10[out]',
      '-map',
      '[out]',
      ...FLAC_OUT,
      'o.flac',
    ]);
  });

  it('handles a single copy', () => {
    const args = buildLoopArgs({ input: 'n.flac', output: 'o.flac', copies: 1, crossfadeSec: 5, durationSec: 45 });
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:a]atrim=end=45[out]');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/prepArgs.test.js`
Expected: FAIL — `buildMeasureArgs` is not exported.

- [ ] **Step 3: Replace `src/ffmpeg/prepArgs.js`**

```js
import { AUDIO } from '../config.js';

const loudnormTarget = (lufs) => `loudnorm=I=${lufs}:TP=${AUDIO.truePeak}:LRA=${AUDIO.lra}`;

const flacOut = (output) => ['-ar', String(AUDIO.sampleRate), '-ac', '2', '-c:a', 'flac', '-sample_fmt', 's16', output];

function cleanChain({ startSec, endSec, denoise }) {
  return [
    `atrim=start=${startSec}:end=${endSec}`,
    'asetpts=PTS-STARTPTS',
    `highpass=f=${AUDIO.highpassHz}`,
    ...(denoise ? [AUDIO.denoiseFilter] : []),
  ];
}

function fades({ durationSec, fadeInSec = 0, fadeOutSec = 0 }) {
  return [
    ...(fadeInSec > 0 ? [`afade=t=in:d=${fadeInSec}`] : []),
    ...(fadeOutSec > 0 ? [`afade=t=out:st=${durationSec - fadeOutSec}:d=${fadeOutSec}`] : []),
  ];
}

// Pass 1: measure loudness of the trimmed, cleaned audio. Output goes to stderr as JSON.
export function buildMeasureArgs({ input, startSec, endSec, denoise, lufs }) {
  const filters = [...cleanChain({ startSec, endSec, denoise }), `${loudnormTarget(lufs)}:print_format=json`];
  return ['-i', input, '-af', filters.join(','), '-f', 'null', '-'];
}

export function parseLoudnorm(stderr) {
  const blocks = stderr.match(/\{[^{}]*"input_i"[^{}]*\}/g);
  if (!blocks) throw new Error('Could not find loudnorm measurement in FFmpeg output');
  const measured = JSON.parse(blocks.at(-1));
  if (!Number.isFinite(Number(measured.input_i))) {
    throw new Error('Audio appears to be silent; cannot normalize loudness');
  }
  return measured;
}

// Pass 2: apply the measured correction (linear mode avoids volume pumping).
export function buildNormalizeArgs({ input, output, startSec, endSec, denoise, lufs, measured, fadeInSec = 0, fadeOutSec = 0 }) {
  const apply =
    `${loudnormTarget(lufs)}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}` +
    `:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}` +
    `:offset=${measured.target_offset}:linear=true`;
  const filters = [
    ...cleanChain({ startSec, endSec, denoise }),
    apply,
    `aresample=${AUDIO.sampleRate}`, // loudnorm upsamples to 192 kHz internally
    ...fades({ durationSec: endSec - startSec, fadeInSec, fadeOutSec }),
  ];
  return ['-i', input, '-af', filters.join(','), ...flacOut(output)];
}

export function loopCopies(sourceSec, targetSec, crossfadeSec) {
  if (sourceSec <= crossfadeSec * 2) {
    throw new Error(`Recording (${sourceSec}s after trimming) is too short to loop with a ${crossfadeSec}s crossfade`);
  }
  return Math.max(1, Math.ceil((targetSec - crossfadeSec) / (sourceSec - crossfadeSec)));
}

// The file is passed as N separate inputs (not asplit) so FFmpeg reads each copy
// from disk as needed instead of buffering the whole recording in memory.
export function buildLoopArgs({ input, output, copies, crossfadeSec, durationSec, fadeInSec = 0, fadeOutSec = 0 }) {
  const inputs = Array.from({ length: copies }, () => ['-i', input]).flat();
  const steps = [];
  let prev = '[0:a]';
  for (let i = 1; i < copies; i++) {
    const out = `[x${i}]`;
    steps.push(`${prev}[${i}:a]acrossfade=d=${crossfadeSec}${out}`);
    prev = out;
  }
  const tail = [`atrim=end=${durationSec}`, ...fades({ durationSec, fadeInSec, fadeOutSec })].join(',');
  steps.push(`${prev}${tail}[out]`);
  return [...inputs, '-filter_complex', steps.join(';'), '-map', '[out]', ...flacOut(output)];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/prepArgs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ffmpeg/prepArgs.js tests/unit/prepArgs.test.js
git commit -m "feat: add audio prep ffmpeg argument builders"
```

---

### Task 7: `prepAudio` orchestrator

**Files:**
- Create: `src/prep.js`
- Test: `tests/integration/prep.test.js`

- [ ] **Step 1: Write the failing test** — `tests/integration/prep.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/prep.test.js`
Expected: FAIL — cannot resolve `../../src/prep.js`.

- [ ] **Step 3: Implement `src/prep.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO, audioDir } from './config.js';
import { partPath, writeAtomically } from './files.js';
import { buildLoopArgs, buildMeasureArgs, buildNormalizeArgs, loopCopies, parseLoudnorm } from './ffmpeg/prepArgs.js';
import { probe } from './ffmpeg/probe.js';
import { runFfmpeg } from './ffmpeg/run.js';

export function defaultPrepOutput(input) {
  return path.join(audioDir(), `${path.basename(input, path.extname(input))}.prepped.flac`);
}

export async function prepAudio({
  input,
  output = defaultPrepOutput(input),
  trimStartSec = 0,
  trimEndSec = 0,
  durationSec,
  denoise = false,
  lufs = AUDIO.lufs,
  fadeInSec = AUDIO.fadeInSec,
  fadeOutSec = AUDIO.fadeOutSec,
  onProgress,
}) {
  if (!fs.existsSync(input)) throw new Error(`Input not found: ${input}`);
  const info = await probe(input);
  if (!info.hasAudio) throw new Error(`No audio stream in ${input}`);

  const startSec = trimStartSec;
  let endSec = info.duration - trimEndSec;
  if (durationSec !== undefined) endSec = Math.min(endSec, startSec + durationSec);
  const sourceSec = endSec - startSec;
  if (sourceSec <= 0) throw new Error(`Nothing left after trimming: ${input} is ${info.duration}s long`);

  const finalSec = durationSec ?? sourceSec;
  const looped = finalSec > sourceSec;
  const copies = looped ? loopCopies(sourceSec, finalSec, AUDIO.loopCrossfadeSec) : 1;

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const range = { input, startSec, endSec, denoise, lufs };
  const stage = (name) => (pct) => onProgress?.(name, pct);

  const { stderr } = await runFfmpeg(buildMeasureArgs(range), { totalSec: sourceSec, onProgress: stage('measure') });
  const measured = parseLoudnorm(stderr);

  if (!looped) {
    await writeAtomically(output, (part) =>
      runFfmpeg(buildNormalizeArgs({ ...range, output: part, measured, fadeInSec, fadeOutSec }), {
        totalSec: sourceSec,
        onProgress: stage('normalize'),
      }),
    );
    return { output, durationSec: finalSec, looped };
  }

  // Normalize once (no fades), then loop the normalized file so every copy matches.
  const normalized = partPath(output, 'normalized');
  try {
    await runFfmpeg(buildNormalizeArgs({ ...range, output: normalized, measured }), {
      totalSec: sourceSec,
      onProgress: stage('normalize'),
    });
    await writeAtomically(output, (part) =>
      runFfmpeg(
        buildLoopArgs({
          input: normalized,
          output: part,
          copies,
          crossfadeSec: AUDIO.loopCrossfadeSec,
          durationSec: finalSec,
          fadeInSec,
          fadeOutSec,
        }),
        { totalSec: finalSec, onProgress: stage('loop') },
      ),
    );
  } finally {
    fs.rmSync(normalized, { force: true });
  }
  return { output, durationSec: finalSec, looped };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/prep.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/prep.js tests/integration/prep.test.js
git commit -m "feat: add audio prep with two-pass loudness normalization and crossfade looping"
```

---

### Task 8: Video argument builders

**Files:**
- Create: `src/ffmpeg/videoArgs.js`
- Test: `tests/unit/videoArgs.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/videoArgs.test.js`

```js
import { describe, expect, it } from 'vitest';
import { buildMuxArgs, buildSegmentArgs } from '../../src/ffmpeg/videoArgs.js';

const ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-an'];
const cover = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

describe('buildSegmentArgs — photos', () => {
  const photo = { visual: 'p.jpg', isImage: true, width: 1920, height: 1080, segmentSec: 60, output: 's.mp4' };

  it('renders a static still, cropped to fill the frame', () => {
    expect(buildSegmentArgs({ ...photo, motion: 'static' })).toEqual([
      '-loop', '1', '-framerate', '30', '-t', '60', '-i', 'p.jpg',
      '-vf', cover(1920, 1080),
      ...ENCODE,
      's.mp4',
    ]);
  });

  it('renders a slow zoom that returns to its start frame', () => {
    const args = buildSegmentArgs({ ...photo, motion: 'slow-zoom' });
    expect(args[args.indexOf('-vf') + 1]).toBe(
      `${cover(3840, 2160)},zoompan=z='1+0.08*(1-cos(2*PI*on/1800))/2'` +
        `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=30,setsar=1`,
    );
  });
});

describe('buildSegmentArgs — video clips', () => {
  const clip = { visual: 'c.mp4', isImage: false, motion: 'static', width: 1080, height: 1920, segmentSec: 60, output: 's.mp4' };
  const graphOf = (args) => args[args.indexOf('-filter_complex') + 1];

  it('crossfades the tail into the head so the loop point is invisible', () => {
    const args = buildSegmentArgs({ ...clip, clipDurationSec: 6 });
    expect(args.slice(0, 3)).toEqual(['-i', 'c.mp4', '-filter_complex']);
    expect(graphOf(args)).toBe(
      [
        `[0:v]${cover(1080, 1920)},fps=30,trim=end=6,setpts=PTS-STARTPTS,split[m][h]`,
        '[m]trim=start=2,setpts=PTS-STARTPTS[main]',
        '[h]trim=end=2,setpts=PTS-STARTPTS[head]',
        '[main][head]xfade=transition=fade:duration=2:offset=2[v]',
      ].join(';'),
    );
    expect(args.slice(-ENCODE.length - 3)).toEqual(['-map', '[v]', ...ENCODE, 's.mp4']);
  });

  it('caps long clips at the segment length', () => {
    expect(graphOf(buildSegmentArgs({ ...clip, clipDurationSec: 120 }))).toContain('trim=end=60,');
    expect(graphOf(buildSegmentArgs({ ...clip, clipDurationSec: 120 }))).toContain('offset=56[v]');
  });

  it('skips the crossfade for clips too short to fade', () => {
    expect(graphOf(buildSegmentArgs({ ...clip, clipDurationSec: 3 }))).toBe(
      `[0:v]${cover(1080, 1920)},fps=30,trim=end=3,setpts=PTS-STARTPTS[v]`,
    );
  });
});

describe('buildMuxArgs', () => {
  it('loops the segment without re-encoding under the full audio', () => {
    expect(buildMuxArgs({ segment: 's.mp4', audio: 'a.flac', output: 'o.mp4', durationSec: 7200 })).toEqual([
      '-stream_loop', '-1', '-i', 's.mp4',
      '-i', 'a.flac',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', '7200',
      '-movflags', '+faststart',
      'o.mp4',
    ]);
  });

  it('seeks into the audio and fades for the short', () => {
    expect(
      buildMuxArgs({ segment: 's.mp4', audio: 'a.flac', output: 'o.mp4', durationSec: 60, audioStartSec: 5020, fadeSec: 1 }),
    ).toEqual([
      '-stream_loop', '-1', '-i', 's.mp4',
      '-ss', '5020', '-i', 'a.flac',
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'copy',
      '-af', 'afade=t=in:d=1,afade=t=out:st=59:d=1',
      '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
      '-t', '60',
      '-movflags', '+faststart',
      'o.mp4',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/videoArgs.test.js`
Expected: FAIL — cannot resolve `../../src/ffmpeg/videoArgs.js`.

- [ ] **Step 3: Implement `src/ffmpeg/videoArgs.js`**

```js
import { AUDIO, VIDEO } from '../config.js';

const encodeArgs = () => [
  '-c:v', 'libx264',
  '-preset', VIDEO.preset,
  '-crf', String(VIDEO.crf),
  '-pix_fmt', 'yuv420p',
  '-r', String(VIDEO.fps),
  '-an',
];

// Scale up until the frame is covered, then center-crop: no letterboxing.
const cover = (w, h) => `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1`;

// Zoom 1 → 1+zoomAmount → 1 over the segment, so the last frame flows into the first.
export const zoomExpr = (frames) => `1+${VIDEO.zoomAmount}*(1-cos(2*PI*on/${frames}))/2`;

// A short, seamlessly loopable visual that buildMuxArgs repeats for the full length.
export function buildSegmentArgs({ visual, isImage, clipDurationSec, motion, width, height, segmentSec = VIDEO.segmentSec, output }) {
  if (isImage) {
    const frames = segmentSec * VIDEO.fps;
    // slow-zoom works on a 2x canvas so zoompan's integer pixel steps don't jitter.
    const vf =
      motion === 'slow-zoom'
        ? `${cover(width * 2, height * 2)},zoompan=z='${zoomExpr(frames)}'` +
          `:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${VIDEO.fps},setsar=1`
        : cover(width, height);
    return ['-loop', '1', '-framerate', String(VIDEO.fps), '-t', String(segmentSec), '-i', visual, '-vf', vf, ...encodeArgs(), output];
  }

  const lengthSec = Math.min(clipDurationSec, segmentSec);
  const xf = VIDEO.clipCrossfadeSec;
  const base = `[0:v]${cover(width, height)},fps=${VIDEO.fps},trim=end=${lengthSec},setpts=PTS-STARTPTS`;
  if (lengthSec <= xf * 2) {
    return ['-i', visual, '-filter_complex', `${base}[v]`, '-map', '[v]', ...encodeArgs(), output];
  }
  // Output = clip[xf..end] crossfaded into clip[0..xf]. Its last frame is clip time xf,
  // which is exactly where its first frame starts, so looping is seamless.
  const graph = [
    `${base},split[m][h]`,
    `[m]trim=start=${xf},setpts=PTS-STARTPTS[main]`,
    `[h]trim=end=${xf},setpts=PTS-STARTPTS[head]`,
    `[main][head]xfade=transition=fade:duration=${xf}:offset=${lengthSec - 2 * xf}[v]`,
  ].join(';');
  return ['-i', visual, '-filter_complex', graph, '-map', '[v]', ...encodeArgs(), output];
}

// Loops the segment with stream copy (fast even for 3 hours) and cuts to an exact length.
export function buildMuxArgs({ segment, audio, output, durationSec, audioStartSec = 0, fadeSec = 0 }) {
  return [
    '-stream_loop', '-1', '-i', segment,
    ...(audioStartSec > 0 ? ['-ss', String(audioStartSec)] : []),
    '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0',
    '-c:v', 'copy',
    ...(fadeSec > 0 ? ['-af', `afade=t=in:d=${fadeSec},afade=t=out:st=${durationSec - fadeSec}:d=${fadeSec}`] : []),
    '-c:a', 'aac', '-b:a', VIDEO.audioBitrate, '-ar', String(AUDIO.sampleRate),
    '-t', String(durationSec),
    '-movflags', '+faststart',
    output,
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/videoArgs.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ffmpeg/videoArgs.js tests/unit/videoArgs.test.js
git commit -m "feat: add video segment and mux argument builders"
```

---

### Task 9: Input inspection

**Files:**
- Create: `src/assemble.js` (inspection only; `assembleItem` added in Task 10)
- Test: `tests/unit/assemble.test.js`

- [ ] **Step 1: Write the failing test** — `tests/unit/assemble.test.js`

```js
import { describe, expect, it } from 'vitest';
import { inspectInputs } from '../../src/assemble.js';

const audio = { duration: 7200, hasAudio: true, hasVideo: false };
const visual = { hasVideo: true, width: 4032, height: 3024 };
const ok = { audio, visual, visualVertical: null, shortStartSec: 30 };

describe('inspectInputs', () => {
  it('passes good inputs', () => {
    expect(inspectInputs(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('allows a short that ends exactly at the end of the audio', () => {
    expect(inspectInputs({ ...ok, shortStartSec: 7140 }).errors).toEqual([]);
  });

  it.each([
    [{ audio: { ...audio, hasAudio: false } }, /no audio stream/],
    [{ visual: { ...visual, hasVideo: false } }, /Visual file is not an image or video/],
    [{ visualVertical: { hasVideo: false, width: 0, height: 0 } }, /Vertical visual file is not an image or video/],
    [{ shortStartSec: 7150 }, /runs past the end of the audio \(2:00:00\)/],
  ])('reports errors (%#)', (overrides, message) => {
    expect(inspectInputs({ ...ok, ...overrides }).errors.join('\n')).toMatch(message);
  });

  it('warns about low-resolution visuals', () => {
    const { errors, warnings } = inspectInputs({
      ...ok,
      visual: { hasVideo: true, width: 1280, height: 720 },
      visualVertical: { hasVideo: true, width: 720, height: 1280 },
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'Visual is 1280x720; below 1920x1080 it will look soft',
      'Vertical visual is 720x1280; below 1080x1920 it will look soft',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/assemble.test.js`
Expected: FAIL — cannot resolve `../../src/assemble.js`.

- [ ] **Step 3: Implement `src/assemble.js` (inspection only)**

```js
import { VIDEO } from './config.js';
import { formatDuration } from './time.js';

// Pure checks on probe results; errors block assembly, warnings are printed.
export function inspectInputs({ audio, visual, visualVertical, shortStartSec }) {
  const errors = [];
  const warnings = [];
  const { long, short } = VIDEO;

  if (!audio.hasAudio) errors.push('Audio file has no audio stream');
  if (!visual.hasVideo) errors.push('Visual file is not an image or video');
  if (visualVertical && !visualVertical.hasVideo) errors.push('Vertical visual file is not an image or video');
  if (shortStartSec + VIDEO.shortSec > audio.duration) {
    errors.push(
      `Short (${formatDuration(shortStartSec)} + ${VIDEO.shortSec}s) runs past the end of the audio (${formatDuration(audio.duration)})`,
    );
  }

  if (visual.hasVideo && (visual.width < long.width || visual.height < long.height)) {
    warnings.push(`Visual is ${visual.width}x${visual.height}; below ${long.width}x${long.height} it will look soft`);
  }
  if (visualVertical?.hasVideo && (visualVertical.width < short.width || visualVertical.height < short.height)) {
    warnings.push(
      `Vertical visual is ${visualVertical.width}x${visualVertical.height}; below ${short.width}x${short.height} it will look soft`,
    );
  }
  return { errors, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/assemble.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/assemble.js tests/unit/assemble.test.js
git commit -m "feat: add pre-flight input inspection for assembly"
```

---

### Task 10: `assembleItem` orchestrator

**Files:**
- Modify: `src/assemble.js` (replace the import block at the top; append `assembleItem` and `renderVideo`)
- Test: `tests/integration/assemble.test.js`

- [ ] **Step 1: Write the failing test** — `tests/integration/assemble.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/assemble.test.js`
Expected: FAIL — `assembleItem` is not exported.

- [ ] **Step 3: Replace the import block at the top of `src/assemble.js`**

Replace:

```js
import { VIDEO } from './config.js';
import { formatDuration } from './time.js';
```

with:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VIDEO, videosDir } from './config.js';
import { claimForAssembly, getItem, markAssembled, markAssemblyFailed } from './db.js';
import { writeAtomically } from './files.js';
import { probe } from './ffmpeg/probe.js';
import { runFfmpeg } from './ffmpeg/run.js';
import { buildMuxArgs, buildSegmentArgs } from './ffmpeg/videoArgs.js';
import { formatDuration } from './time.js';
```

- [ ] **Step 4: Append to the end of `src/assemble.js`**

```js
async function probeExisting(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} not found: ${file}`);
  return probe(file);
}

async function renderVideo({ visualPath, visualInfo, motion, size, segmentSec, segment, mux, output, onProgress }) {
  await runFfmpeg(
    buildSegmentArgs({
      visual: visualPath,
      isImage: visualInfo.isImage,
      clipDurationSec: visualInfo.duration,
      motion,
      width: size.width,
      height: size.height,
      segmentSec,
      output: segment,
    }),
  );
  await writeAtomically(output, (part) =>
    runFfmpeg(buildMuxArgs({ segment, output: part, ...mux }), { totalSec: mux.durationSec, onProgress }),
  );
}

export async function assembleItem(db, id, { onProgress, segmentSec = VIDEO.segmentSec } = {}) {
  const item = getItem(db, id);
  if (!item) throw new Error(`No queue item with id ${id}`);
  if (!claimForAssembly(db, id)) throw new Error(`Item ${id} is already assembling`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-assemble-'));
  try {
    const audio = await probeExisting(item.audio_path, 'Audio');
    const visual = await probeExisting(item.visual_path, 'Visual');
    const visualVertical = item.visual_vertical_path
      ? await probeExisting(item.visual_vertical_path, 'Vertical visual')
      : null;
    const { errors, warnings } = inspectInputs({ audio, visual, visualVertical, shortStartSec: item.short_start_sec });
    if (errors.length) throw new Error(errors.join('; '));

    fs.mkdirSync(videosDir(), { recursive: true });
    const longVideoPath = path.join(videosDir(), `${id}-long.mp4`);
    const shortVideoPath = path.join(videosDir(), `${id}-short.mp4`);

    await renderVideo({
      visualPath: item.visual_path,
      visualInfo: visual,
      motion: item.motion,
      size: VIDEO.long,
      segmentSec,
      segment: path.join(tmp, 'long-segment.mp4'),
      mux: { audio: item.audio_path, durationSec: audio.duration },
      output: longVideoPath,
      onProgress: (pct) => onProgress?.('long', pct),
    });

    await renderVideo({
      visualPath: item.visual_vertical_path ?? item.visual_path,
      visualInfo: visualVertical ?? visual,
      motion: item.motion,
      size: VIDEO.short,
      segmentSec,
      segment: path.join(tmp, 'short-segment.mp4'),
      mux: {
        audio: item.audio_path,
        durationSec: VIDEO.shortSec,
        audioStartSec: item.short_start_sec,
        fadeSec: VIDEO.shortFadeSec,
      },
      output: shortVideoPath,
      onProgress: (pct) => onProgress?.('short', pct),
    });

    markAssembled(db, id, { longVideoPath, shortVideoPath });
    return { longVideoPath, shortVideoPath, warnings };
  } catch (err) {
    markAssemblyFailed(db, id, err.message);
    throw err;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/integration/assemble.test.js tests/unit/assemble.test.js`
Expected: PASS (6 integration + unit inspection tests).

- [ ] **Step 6: Commit**

```bash
git add src/assemble.js tests/integration/assemble.test.js
git commit -m "feat: assemble long and short videos from queued items"
```

---

### Task 11: CLI

**Files:**
- Create: `src/index.js`
- Test: `tests/integration/cli.test.js`

- [ ] **Step 1: Write the failing test** — `tests/integration/cli.test.js`

These tests use `--no-assemble` and empty placeholder files, so they don't need FFmpeg.

```js
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir } from './helpers.js';

const CLI = fileURLToPath(new URL('../../src/index.js', import.meta.url));

describe('CLI', () => {
  let env;
  let audio;
  let visual;

  beforeAll(() => {
    const dir = makeTempDir();
    audio = path.join(dir, 'frogs.flac');
    visual = path.join(dir, 'pond.jpg');
    fs.writeFileSync(audio, '');
    fs.writeFileSync(visual, '');
    env = { ...process.env, FCS_DB_PATH: path.join(dir, 'queue.db'), FCS_OUTPUT_DIR: path.join(dir, 'videos') };
  });

  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  const addArgs = (platforms) => [
    'add',
    '--title', 'Summer Night Frogs',
    '--audio', audio,
    '--visual', visual,
    '--platforms', platforms,
    '--schedule', '2026-10-28T20:00',
    '--short-start', '1:00',
    '--no-assemble',
  ];

  it('queues, lists and shows an item', () => {
    const add = cli(...addArgs('youtube,instagram'));
    expect(add.status, add.stderr).toBe(0);
    expect(add.stdout).toContain('Queued #1 "Summer Night Frogs" for 2026-10-28 20:00 → youtube, instagram');

    const list = cli('list');
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/#1\s+pending\s+2026-10-28 20:00\s+Summer Night Frogs\s+\[youtube,instagram\]/);

    const status = cli('status', '1');
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain('short from: 0:01:00');
    expect(status.stdout).toMatch(/instagram\s+pending/);
  });

  it('rejects bad input without writing to the queue', () => {
    const bad = cli(...addArgs('youtube,myspace'));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Unknown platform\(s\): myspace/);
    expect(cli('list').stdout).not.toMatch(/#2/);
  });

  it('rejects a missing file', () => {
    const args = addArgs('youtube');
    args[args.indexOf('--audio') + 1] = '/nope/missing.flac';
    const bad = cli(...args);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Audio not found: \/nope\/missing.flac/);
  });

  it('reports an unknown item', () => {
    const res = cli('status', '99');
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/No queue item with id 99/);
  });

  it('filters the list by status', () => {
    expect(cli('list', '--status', 'assembled').stdout).toContain('No items');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/integration/cli.test.js`
Expected: FAIL — `add.status` is 1 with "Cannot find module .../src/index.js".

- [ ] **Step 3: Implement `src/index.js`**

```js
#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { assembleItem } from './assemble.js';
import { AUDIO, DEFAULT_SHORT_START_SEC, MOTIONS, PLATFORMS, parsePlatforms } from './config.js';
import { getItem, getTargets, insertItem, listItems, openDb, resetStuckAssemblies } from './db.js';
import { FfmpegError } from './ffmpeg/run.js';
import { prepAudio } from './prep.js';
import { formatDuration, localToUtcIso, parseDuration, toLocalDisplay } from './time.js';

const interactive = process.stderr.isTTY;

function showProgress(stage, pct) {
  if (interactive) process.stderr.write(`\r  ${stage.padEnd(10)} ${pct.toFixed(0).padStart(3)}%`);
}

function endProgress() {
  if (interactive) process.stderr.write('\n');
}

function openQueue() {
  const db = openDb();
  const reset = resetStuckAssemblies(db);
  if (reset) console.log(`Reset ${reset} interrupted assembly item(s) to pending`);
  return db;
}

function action(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      endProgress();
      console.error(`Error: ${err.message}`);
      if (err instanceof FfmpegError) {
        console.error(`\nCommand:\n  ${err.command}\n\nFFmpeg output (last lines):\n${err.stderrTail}`);
      }
      process.exitCode = 1;
    }
  };
}

function requireFile(file, label) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`${label} not found: ${file}`);
  return abs;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new InvalidArgumentError('must be a positive integer');
  return id;
}

async function runAssembly(db, id) {
  console.log(`Assembling #${id}…`);
  const result = await assembleItem(db, id, { onProgress: showProgress });
  endProgress();
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  console.log(`  long:  ${result.longVideoPath}\n  short: ${result.shortVideoPath}`);
}

const program = new Command().name('fcs').description('Florida Country Sounds content pipeline');

program
  .command('prep')
  .description('clean, normalize and optionally loop an edited recording')
  .argument('<input>', 'edited recording (wav, flac, mp3, m4a)')
  .option('--trim-start <duration>', 'cut from the start', '0')
  .option('--trim-end <duration>', 'cut from the end', '0')
  .option('--duration <duration>', 'final length; loops with crossfades if longer than the recording')
  .option('--denoise', 'apply gentle hiss reduction')
  .option('--lufs <number>', 'target loudness, e.g. --lufs=-16', String(AUDIO.lufs))
  .option('--out <path>', 'output file (default: assets/audio/<name>.prepped.flac)')
  .action(
    action(async (input, opts) => {
      const lufs = Number(opts.lufs);
      if (!(lufs < 0)) throw new Error('--lufs must be a negative number, e.g. --lufs=-18');
      const result = await prepAudio({
        input: requireFile(input, 'Input'),
        output: opts.out ? path.resolve(opts.out) : undefined,
        trimStartSec: parseDuration(opts.trimStart),
        trimEndSec: parseDuration(opts.trimEnd),
        durationSec: opts.duration ? parseDuration(opts.duration) : undefined,
        denoise: Boolean(opts.denoise),
        lufs,
        onProgress: showProgress,
      });
      endProgress();
      console.log(`Prepped ${formatDuration(result.durationSec)}${result.looped ? ' (looped)' : ''} → ${result.output}`);
    }),
  );

program
  .command('add')
  .description('queue an item and assemble its videos')
  .requiredOption('--title <title>', 'video title')
  .requiredOption('--audio <path>', 'prepped audio file')
  .requiredOption('--visual <path>', 'photo or video clip')
  .requiredOption('--platforms <list>', `comma-separated: ${PLATFORMS.join(',')}`)
  .requiredOption('--schedule <datetime>', 'Florida local time, e.g. 2026-10-28T20:00')
  .option('--visual-vertical <path>', 'separate photo or clip for the 9:16 short')
  .option('--motion <motion>', MOTIONS.join(' | '), 'static')
  .option('--short-start <time>', 'where the 60s short starts in the audio', String(DEFAULT_SHORT_START_SEC))
  .option('--description <text>', 'video description')
  .option('--no-assemble', 'queue only; run `assemble <id>` later')
  .action(
    action(async (opts) => {
      if (!MOTIONS.includes(opts.motion)) throw new Error(`--motion must be one of: ${MOTIONS.join(', ')}`);
      const item = {
        title: opts.title,
        description: opts.description,
        audioPath: requireFile(opts.audio, 'Audio'),
        visualPath: requireFile(opts.visual, 'Visual'),
        visualVerticalPath: opts.visualVertical ? requireFile(opts.visualVertical, 'Vertical visual') : undefined,
        motion: opts.motion,
        shortStartSec: Math.floor(parseDuration(opts.shortStart)),
        scheduledAt: localToUtcIso(opts.schedule),
      };
      const platforms = parsePlatforms(opts.platforms);

      const db = openQueue();
      const id = insertItem(db, item, platforms);
      console.log(`Queued #${id} "${item.title}" for ${toLocalDisplay(item.scheduledAt)} → ${platforms.join(', ')}`);
      if (opts.assemble) await runAssembly(db, id);
    }),
  );

program
  .command('assemble')
  .description('(re)build the long and short videos for an item')
  .argument('<id>', 'queue item id', parseId)
  .action(action(async (id) => runAssembly(openQueue(), id)));

program
  .command('list')
  .description('show queued items')
  .option('--status <status>', 'pending | assembling | assembled | assembly_failed')
  .action(
    action(async (opts) => {
      const db = openQueue();
      const items = listItems(db, { status: opts.status });
      if (items.length === 0) {
        console.log('No items');
        return;
      }
      for (const item of items) {
        const platforms = getTargets(db, item.id).map((t) => t.platform).join(',');
        console.log(
          `#${String(item.id).padEnd(4)} ${item.status.padEnd(16)} ${toLocalDisplay(item.scheduled_at)}  ${item.title}  [${platforms}]`,
        );
      }
    }),
  );

program
  .command('status')
  .description('show one item and its per-platform status')
  .argument('<id>', 'queue item id', parseId)
  .action(
    action(async (id) => {
      const db = openQueue();
      const item = getItem(db, id);
      if (!item) throw new Error(`No queue item with id ${id}`);
      const lines = [
        `#${item.id} ${item.title}`,
        `  status:     ${item.status}`,
        `  scheduled:  ${toLocalDisplay(item.scheduled_at)} (Florida time)`,
        `  audio:      ${item.audio_path}`,
        `  visual:     ${item.visual_path}`,
        ...(item.visual_vertical_path ? [`  vertical:   ${item.visual_vertical_path}`] : []),
        `  motion:     ${item.motion}`,
        `  short from: ${formatDuration(item.short_start_sec)}`,
        ...(item.long_video_path ? [`  long:       ${item.long_video_path}`, `  short:      ${item.short_video_path}`] : []),
        ...(item.error ? [`  error:      ${item.error}`] : []),
        '  platforms:',
        ...getTargets(db, item.id).map(
          (t) =>
            `    ${t.platform.padEnd(15)} ${t.status}` +
            (t.platform_post_id ? `  ${t.platform_post_id}` : '') +
            (t.last_error ? `  (${t.last_error})` : ''),
        ),
      ];
      console.log(lines.join('\n'));
    }),
  );

await program.parseAsync(process.argv);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/integration/cli.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Manual end-to-end check with real FFmpeg**

```bash
mkdir -p /tmp/fcs-demo
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "anoisesrc=d=120:c=pink:a=0.1" -ac 2 /tmp/fcs-demo/raw.wav
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=0x3d6b4f:s=1920x1080" -frames:v 1 /tmp/fcs-demo/pond.png
FCS_DB_PATH=/tmp/fcs-demo/queue.db FCS_OUTPUT_DIR=/tmp/fcs-demo/videos node src/index.js prep /tmp/fcs-demo/raw.wav --trim-start 5s --trim-end 5s --duration 5m --out /tmp/fcs-demo/raw.prepped.flac
FCS_DB_PATH=/tmp/fcs-demo/queue.db FCS_OUTPUT_DIR=/tmp/fcs-demo/videos node src/index.js add --title "Demo" --audio /tmp/fcs-demo/raw.prepped.flac --visual /tmp/fcs-demo/pond.png --platforms youtube,instagram --schedule 2026-10-28T20:00
FCS_DB_PATH=/tmp/fcs-demo/queue.db node src/index.js status 1
```

Expected: `Prepped 0:05:00 (looped) → /tmp/fcs-demo/raw.prepped.flac`; `Queued #1 …`; `long:` and `short:` paths printed; `status 1` shows `status: assembled`. Open both MP4s and confirm they play.

- [ ] **Step 6: Run the full suite**

Run: `npm run test:all`
Expected: all unit and integration tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.js tests/integration/cli.test.js
git commit -m "feat: add CLI for prep, add, assemble, list and status"
```

---

### Task 12: Update CLAUDE.md to match the built system

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Replace the "Content queue schema (SQLite)" section** (from the `## Content queue schema (SQLite)` heading through the closing ``` of its SQL block) with:

````markdown
## Content queue schema (SQLite)

Defined in `src/db.js` (migrations via `PRAGMA user_version`). Full spec: `docs/superpowers/specs/2026-10-27-core-pipeline-design.md`.

- `queue` — one row per piece of content: inputs, `long_video_path`, `short_video_path`, `scheduled_at` (UTC), assembly `status` (`pending | assembling | assembled | assembly_failed`).
- `post_targets` — one row per (item, platform): posting `status` (`pending | posted | failed`), `platform_post_id`, `attempts`, `last_error`.
- `post_log` — append-only history of posting attempts.

Platforms: `youtube`, `youtube_shorts`, `facebook`, `instagram`, `tiktok`, `bluesky`, `substack`. Long video → youtube, facebook. Short → youtube_shorts, instagram, tiktok, bluesky. Substack links to the YouTube video.
````

- [ ] **Step 2: Replace the "CLI interface (target)" section** (heading through the closing ``` of its bash block) with:

````markdown
## CLI interface

```bash
# 1. Edit out disturbances in Audacity, then:
node src/index.js prep assets/raw/backyard.wav --trim-start 10s --trim-end 15s --duration 2h
# 2. Queue + assemble (schedule is Florida local time):
node src/index.js add --title "Summer Night Frogs" --audio assets/audio/backyard.prepped.flac \
  --visual assets/visuals/pond.jpg --short-start 1:23:40 \
  --platforms youtube,youtube_shorts,instagram --schedule "2026-10-28T20:00"
node src/index.js list
node src/index.js status 12
node src/index.js assemble 12   # rebuild videos
```

Tests: `npm test` (unit), `npm run test:integration` (real FFmpeg + CLI).
````

- [ ] **Step 3: Fix the YouTube API note.** Replace:

```markdown
- **YouTube**: Requires Google Cloud project, OAuth2 consent screen, YouTube Data API v3 enabled. Free quota: 10,000 units/day (one video upload = ~1,600 units). Use a service account for unattended posting.
```

with:

```markdown
- **YouTube**: Requires Google Cloud project, OAuth2 consent screen, YouTube Data API v3 enabled. Service accounts are NOT supported for uploads — use a one-time OAuth login to get a refresh token, and set the consent screen to "In production" (Testing-mode refresh tokens expire after 7 days). Uploads are forced private until the project passes the YouTube API Services compliance audit.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for the built core pipeline"
```
