# Sub-project A: Core Pipeline — Design

**Date:** 2026-10-27
**Status:** Approved design, pending implementation plan
**Scope:** Audio prep, video assembly, SQLite queue, CLI. No platform APIs, no scheduler, no LLM.

## Context

Florida Country Sounds turns long backyard field recordings into a 1–3 hour 16:9 video plus a 60-second 9:16 short. The overall build is split into sub-projects:

| # | Sub-project | Depends on |
|---|---|---|
| **A** | **Core — prep, assembly, queue, CLI (this spec)** | — |
| B | YouTube posting (long + Shorts) | A |
| C | Scheduler (node-cron) | A, ≥1 platform |
| D | Bluesky | A |
| E | Meta (Facebook + Instagram Reels) | A |
| F | TikTok | A |
| G | Substack drafts | A |
| H | LLM captions | A |

Platform approvals (Google API audit, TikTok app review, Meta app review) should be applied for in parallel with building A, since unaudited YouTube and TikTok API uploads are forced private.

## Content workflow

1. Record a long take in the backyard.
2. Remove disturbances (cars, dogs, voices, bumps) manually in **Audacity**. Skip if the take is clean.
3. `prep` — automated cleanup, loudness normalization, optional looping to a target length.
4. `add` — queue the item; assembly starts automatically.
5. Preview `output/videos/<id>-long.mp4` and `<id>-short.mp4` before the scheduled time.

## Tech stack

- Node.js 22, JavaScript (ESM)
- `better-sqlite3` for the queue
- `commander` for the CLI
- FFmpeg + ffprobe from Homebrew (`brew install ffmpeg`), invoked via `child_process.spawn`. No wrapper library (`fluent-ffmpeg` is archived).
- Vitest for tests

## CLI

```bash
node src/index.js prep <input> [--trim-start 10s] [--trim-end 15s] [--duration 2h] [--denoise] [--lufs -18] [--out <path>]
node src/index.js add --title "…" --audio <path> --visual <path> [--visual-vertical <path>] \
    [--motion static|slow-zoom] [--short-start 1:23:40] --platforms youtube,youtube_shorts,instagram \
    --schedule "2026-10-28T20:00" [--description "…"] [--no-assemble]
node src/index.js assemble <id>      # (re)run assembly for an item
node src/index.js list [--status <status>]
node src/index.js status <id>        # item details + per-platform target rows
```

- Durations and timestamps accept `90`, `90s`, `1:30`, `1:23:40`, `2h`, `45m`.
- `--schedule` is interpreted as America/New_York local time and stored as UTC ISO 8601.
- `--short-start` defaults to 30 seconds.
- `--motion` defaults to `static`; it applies to photo visuals only and is ignored for video clips.
- `add` runs assembly synchronously after inserting unless `--no-assemble` is given. If assembly fails, the item remains queued with status `assembly_failed`; the command exits non-zero.

## Module layout

```
src/
├── index.js              CLI (commander): prep, add, assemble, list, status
├── config.js             paths, encoding defaults, loudness target, platform→video mapping
├── db.js                 schema, migrations, queries
├── time.js               duration/timestamp parsing, local→UTC conversion
├── ffmpeg/
│   ├── run.js            spawn ffmpeg/ffprobe, parse progress, throw FfmpegError
│   ├── probe.js          ffprobe → { duration, width, height, hasVideo, hasAudio, isImage, videoCodec, audioCodec }
│   ├── prepArgs.js       pure: options → ffmpeg args for audio prep
│   └── videoArgs.js      pure: options → ffmpeg args for loop segment, long mux, short
├── files.js              .part paths and atomic write-then-rename
├── prep.js               orchestration: probe → args → run → output
└── assemble.js           orchestration: validate → long + short → update DB
```

Rules:
- `ffmpeg/run.js` is the only module that spawns processes.
- `*Args.js` modules are pure functions with no I/O.
- `db.js` has no knowledge of FFmpeg.
- `prep.js` and `assemble.js` are the only modules combining FFmpeg, filesystem, and (for assemble) the DB.

## Database

```sql
CREATE TABLE queue (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  title                TEXT NOT NULL,
  description          TEXT,
  audio_path           TEXT NOT NULL,
  visual_path          TEXT NOT NULL,
  visual_vertical_path TEXT,
  motion               TEXT NOT NULL DEFAULT 'static',   -- static | slow-zoom
  short_start_sec      INTEGER NOT NULL DEFAULT 30,
  long_video_path      TEXT,
  short_video_path     TEXT,
  scheduled_at         TEXT NOT NULL,                    -- UTC ISO 8601
  status               TEXT NOT NULL DEFAULT 'pending',  -- pending | assembling | assembled | assembly_failed
  error                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE post_targets (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  queue_id         INTEGER NOT NULL REFERENCES queue(id) ON DELETE CASCADE,
  platform         TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending',      -- pending | posted | failed
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
  status           TEXT NOT NULL,                        -- success | failed
  platform_post_id TEXT,
  error            TEXT,
  posted_at        TEXT DEFAULT (datetime('now'))
);
```

- Assembly state lives on `queue`; posting state lives per platform on `post_targets`. `post_log` records every posting attempt (written by sub-projects B+).
- `add` inserts the `queue` row and one `post_targets` row per platform in a single transaction.
- Valid platforms: `youtube`, `youtube_shorts`, `facebook`, `instagram`, `tiktok`, `bluesky`, `substack`.
- Platform → video mapping in `config.js`: `youtube`, `facebook` → long; `youtube_shorts`, `instagram`, `tiktok`, `bluesky` → short; `substack` → none (links to the YouTube video).
- Both videos are always assembled regardless of platforms.
- Migrations: an ordered array of SQL strings in `db.js`, applied based on `PRAGMA user_version`. Foreign keys enabled via `PRAGMA foreign_keys = ON`.
- DB file at `db/queue.db`, auto-created. Path overridable via `FCS_DB_PATH`; video output dir overridable via `FCS_OUTPUT_DIR` (both used by tests).

## Audio prep (`prep`)

Applied in order:

1. **Trim** `--trim-start` / `--trim-end` from the ends.
2. **High-pass** at 80 Hz (`highpass=f=80`).
3. **Denoise** (`afftdn`, gentle settings) only with `--denoise`.
4. **Loudness normalization**, two-pass `loudnorm`: pass 1 measures (JSON parsed from stderr), pass 2 applies with `linear=true`. Target integrated loudness defaults to −18 LUFS, true peak −1.5 dBTP.
5. **Loop** only if `--duration` exceeds the trimmed length: concatenate N copies with 5 s `acrossfade` between each, then trim to exactly `--duration`.
6. **Fades**: 3 s fade-in, 10 s fade-out.
7. **Output** FLAC, 48 kHz, stereo, to `assets/audio/<input-basename>.prepped.flac` (or `--out`).

Normalization runs before looping so every copy is identical in level and pass 1 only measures the original length.

## Assembly (`assemble`)

### Pre-flight validation
- Audio and visual files exist and ffprobe can read them.
- Audio has an audio stream; visual is an image or has a video stream.
- `short_start_sec + 60 ≤ audio duration`.
- Visual smaller than 1920×1080 (or vertical override smaller than 1080×1920) → warning, not error.
- FFmpeg missing → error with `brew install ffmpeg` instruction.

### Long video (16:9)
1. **Loop segment** (~60 s, 1920×1080, 30 fps, H.264 `libx264 -crf 20 -preset slow -pix_fmt yuv420p`), scaled to cover and center-cropped:
   - Photo, `static`: still frame.
   - Photo, `slow-zoom`: `zoompan` that zooms in then back out over the segment so the last frame matches the first.
   - Video clip: trimmed to ≤60 s; the tail crossfades (`xfade`, 2 s) into the head so the loop point is invisible.
2. **Mux**: `-stream_loop -1` the segment with `-c:v copy`, audio encoded AAC 192 kbps 48 kHz, `-shortest`, `-movflags +faststart`.

Output: `output/videos/<id>-long.mp4`.

### Short (9:16)
- Audio: 60 s from `short_start_sec`, 1 s fade-in and fade-out, AAC 192 kbps.
- Visual: `visual_vertical_path` if set, otherwise center 9:16 crop of `visual_path`; 1080×1920, 30 fps, same H.264 settings. Motion setting applies the same way as the long video. Video clips are looped if shorter than 60 s.
- Built with the same two steps as the long video (loop segment at 1080×1920, then mux with `-c:v copy`), so both outputs share one code path.

Both muxes use `-t <duration>` rather than `-shortest` so output length is exact.

Output: `output/videos/<id>-short.mp4`.

### State transitions
`pending` → `assembling` → `assembled` (paths saved) or `assembly_failed` (`error` saved). `assemble <id>` is allowed from any state except `assembling` and overwrites existing outputs. On CLI startup, any row stuck in `assembling` is reset to `pending`.

## Error handling

- `run.js` throws `FfmpegError { exitCode, stderrTail (last 20 lines), command }`. The CLI prints a one-line summary plus the full command for manual reproduction.
- All encodes write to `<name>.part.<ext>` and rename on success; partial files are deleted on failure.
- Progress: `-progress pipe:1` parsed into a single updating percentage line on stderr, based on the known output duration.
- Input validation (paths, durations, timestamps, platforms) happens in `add`/`prep` before any DB write or encode.

## Testing (Vitest)

| Layer | Coverage |
|---|---|
| Unit | `prepArgs`, `videoArgs` for every branch (static / slow-zoom / video clip, vertical override, loop vs no loop, denoise on/off); `time.js` parsing and America/New_York → UTC across DST boundaries; platform mapping and validation. |
| DB | In-memory SQLite: migrations from empty, `add` transaction with targets, status transitions, `assembling` → `pending` recovery, cascade delete. |
| Integration | Real FFmpeg on fixtures generated at test time (20 s and 75 s sine tones, solid-color 1920×1080 PNG, 6 s 1280×720 `testsrc` clip — long enough to exercise the clip crossfade). Assert via ffprobe: duration (±0.1 s audio, ±0.2 s video to allow for AAC priming), resolution, codecs, and measured loudness (±1 LU). Skipped with a clear message if FFmpeg is absent. |
| CLI smoke | `add` → `list` → `status` against a temp DB (`FCS_DB_PATH`) and temp output dir. |

Scripts: `npm test` (unit + DB), `npm run test:integration` (integration + CLI smoke).

## Out of scope

Platform APIs, OAuth, scheduler, LLM captions, automatic short-segment selection, GUI, cloud hosting.
