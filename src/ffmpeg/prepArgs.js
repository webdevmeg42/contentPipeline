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
