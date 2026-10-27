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
