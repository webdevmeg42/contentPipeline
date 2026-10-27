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
