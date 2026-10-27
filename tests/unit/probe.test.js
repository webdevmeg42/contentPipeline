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
