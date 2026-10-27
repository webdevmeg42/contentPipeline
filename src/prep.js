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
