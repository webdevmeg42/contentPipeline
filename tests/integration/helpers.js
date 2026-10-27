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
  console.warn('FFmpeg not found — skipping FFmpeg integration tests. Install with brew install ffmpeg, or a static build from evermeet.cx');
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
