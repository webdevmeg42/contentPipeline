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
