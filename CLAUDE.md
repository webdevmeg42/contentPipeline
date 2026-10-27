# Florida Country Sounds — Content Pipeline

## What this project is

A standalone Node.js automation tool that assembles ambient nature videos and posts them across multiple social media platforms on a schedule. The brand is **Florida Country Sounds** — ambient audio recordings from a rural Florida property (Branford/Gainesville area). Content is authentic field recordings when available; bridge content from free royalty-free libraries (freesound.org, Mixkit) while the owner builds up original recordings.

The goal is a passive income stream via YouTube AdSense, affiliate links, and eventual sponsorships. This is Phase 1 of a larger content operation — Phase 2 will add an AI tools content arm once this pipeline is proven.

## Owner context

- **Developer**: Megan — SDET/QA engineer, primary language JavaScript/TypeScript, secondary Golang and Python
- **Stack comfort**: Node.js, Express, PostgreSQL, React, Docker, GitLab CI, GitHub Actions
- **Budget**: Under $50 total to start — no paid APIs, no paid services unless free tier covers it
- **Microphone status**: Does not yet have a field recording mic. SYNCO Smic (~$39) is the target purchase. Using bridge content until then.

## Target platforms

1. YouTube (primary — AdSense monetization target)
2. Facebook
3. Instagram (via Facebook Graph API — same integration)
4. TikTok
5. Bluesky
6. Substack (automated draft creation; manual publish for now)

Future: Plotrunner integration (separate project, not in scope here)

## Tech stack decisions

- **Runtime**: Node.js (no framework needed — this is a CLI tool, not a web app)
- **Database**: SQLite via `better-sqlite3` — local, no server, free, sufficient for a content queue
- **Video assembly**: FFmpeg (free, command-line) — combines audio + static/slow-pan visual into video file
- **Scheduler**: Node-cron — checks queue and triggers posts on schedule
- **LLM descriptions**: OpenAI API or Anthropic API on free/cheap tier — generates YouTube descriptions, hashtags, and per-platform captions from title input. Add last, not blocking.
- **Language**: JavaScript (ESM modules)

## Project structure

```
florida-country-sounds/
├── CLAUDE.md                  ← you are here
├── package.json
├── .env                       ← API keys, never commit
├── .gitignore
├── db/
│   └── queue.db               ← SQLite database (auto-created)
├── src/
│   ├── index.js               ← CLI entry point
│   ├── db.js                  ← database setup and queries
│   ├── assemble.js            ← FFmpeg video assembly
│   ├── scheduler.js           ← cron job, checks queue and fires posts
│   └── platforms/
│       ├── youtube.js
│       ├── facebook.js        ← covers Instagram too
│       ├── tiktok.js
│       ├── bluesky.js
│       └── substack.js
├── assets/
│   ├── audio/                 ← .wav or .mp3 source files
│   └── visuals/               ← .jpg or .png static images, or .mp4 slow-pan loops
└── output/
    └── videos/                ← assembled video files ready to post
```

## Content queue schema (SQLite)

Defined in `src/db.js` (migrations via `PRAGMA user_version`). Full spec: `docs/superpowers/specs/2026-10-27-core-pipeline-design.md`.

- `queue` — one row per piece of content: inputs, `long_video_path`, `short_video_path`, `scheduled_at` (UTC), assembly `status` (`pending | assembling | assembled | assembly_failed`).
- `post_targets` — one row per (item, platform): posting `status` (`pending | posted | failed`), `platform_post_id`, `attempts`, `last_error`.
- `post_log` — append-only history of posting attempts.

Platforms: `youtube`, `youtube_shorts`, `facebook`, `instagram`, `tiktok`, `bluesky`, `substack`. Long video → youtube, facebook. Short → youtube_shorts, instagram, tiktok, bluesky. Substack links to the YouTube video.

## Build order

Build and test each step before moving to the next:

1. **FFmpeg assembly** (`src/assemble.js`) — takes audio path + visual path, outputs video file to `output/videos/`. Test with a sample file before touching any APIs.
2. **SQLite queue** (`src/db.js`) — setup, insert, query by status, update status. CLI commands: `add` to queue an item, `list` to see queue, `status` to check a post.
3. **YouTube posting** (`src/platforms/youtube.js`) — YouTube Data API v3, OAuth2. Most documented, best monetization. Get this working end-to-end first.
4. **Facebook/Instagram** (`src/platforms/facebook.js`) — Facebook Graph API. One integration covers both. Reels format for Instagram.
5. **TikTok** (`src/platforms/tiktok.js`) — TikTok Content Posting API.
6. **Bluesky** (`src/platforms/bluesky.js`) — AT Protocol, open API, no approval needed.
7. **Substack** (`src/platforms/substack.js`) — draft creation via their API or web automation fallback.
8. **Scheduler** (`src/scheduler.js`) — node-cron, runs every 15 minutes, picks up `pending` items past their `scheduled_at`, assembles if needed, posts to all platforms.
9. **LLM descriptions** — add last. Prompt takes title, returns description + hashtags + per-platform caption variants.

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

FFmpeg: Homebrew can't build it on this Mac (macOS 13, Tier 3). Installed instead as static binaries from evermeet.cx in `/usr/local/bin`.

## API notes

- **YouTube**: Requires Google Cloud project, OAuth2 consent screen, YouTube Data API v3 enabled. Service accounts are NOT supported for uploads — use a one-time OAuth login to get a refresh token, and set the consent screen to "In production" (Testing-mode refresh tokens expire after 7 days). Uploads are forced private until the project passes the YouTube API Services compliance audit.
- **Facebook/Instagram**: Meta Developer app, `pages_manage_posts` and `instagram_content_publish` permissions. Requires a Facebook Page (not personal profile) and connected Instagram Business account.
- **TikTok**: TikTok for Developers, Content Posting API. Requires app review for production but sandbox works for testing.
- **Bluesky**: AT Protocol. No app approval needed. Use `@atproto/api` npm package.
- **Substack**: No official public API. Options: unofficial API endpoints (fragile) or Playwright automation as fallback.

## Environment variables (.env)

```
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
YOUTUBE_REFRESH_TOKEN=

FACEBOOK_PAGE_ID=
FACEBOOK_ACCESS_TOKEN=

TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_ACCESS_TOKEN=

BLUESKY_HANDLE=
BLUESKY_APP_PASSWORD=

SUBSTACK_EMAIL=
SUBSTACK_PASSWORD=
OPENAI_API_KEY=        # or ANTHROPIC_API_KEY= — for LLM descriptions, add last
```

## Bridge content sources (while mic is pending)

- [freesound.org](https://freesound.org) — search: florida, frogs, swamp, rain, cicadas, palmetto, crickets. Filter by CC0 license (no attribution needed).
- [Mixkit](https://mixkit.co/free-sound-effects/nature/) — free nature sounds, royalty-free.
- Do NOT label bridge content as "recorded in my yard." Use "Florida nature sounds" as the description until original recordings are available.

## Brand notes

- **Name**: Florida Country Sounds
- **Vibe**: Authentic, unhurried, rural Florida — not produced or polished. The rawness is the point.
- **Signature sounds to capture once mic arrives**: tree frogs after rain, morning birds, cicadas at dusk, wind through palmettos, distant thunder, rural night ambience
- **Visual style**: Static or very slow pan — sky, trees, water, yard. No text overlays, no logos. Let the sound be the content.
- **Video length**: YouTube long-form = 1–3 hours (maximizes watch time and AdSense). Shorts/TikTok/Reels = 60 seconds cut from the same source file.

## Phase 2 (not in scope yet)

Once this pipeline runs reliably: add an **AI Tools for Non-Technical People** content arm through the same pipeline. Different brand, different content type (text + graphics), same scheduling and posting infrastructure.
