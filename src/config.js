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
