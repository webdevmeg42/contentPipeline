import { describe, expect, it } from 'vitest';
import { buildLoopArgs, buildMeasureArgs, buildNormalizeArgs, loopCopies, parseLoudnorm } from '../../src/ffmpeg/prepArgs.js';

const FLAC_OUT = ['-ar', '48000', '-ac', '2', '-c:a', 'flac', '-sample_fmt', 's16'];

const measured = {
  input_i: '-21.03',
  input_tp: '-14.50',
  input_lra: '0.00',
  input_thresh: '-31.03',
  target_offset: '0.01',
};

const LOUDNORM_STDERR = `
[Parsed_loudnorm_3 @ 0x600001234]
{
	"input_i" : "-21.03",
	"input_tp" : "-14.50",
	"input_lra" : "0.00",
	"input_thresh" : "-31.03",
	"output_i" : "-18.01",
	"output_tp" : "-11.48",
	"output_lra" : "0.00",
	"output_thresh" : "-28.01",
	"normalization_type" : "dynamic",
	"target_offset" : "0.01"
}
[out#0/null @ 0x600001] video:0KiB audio:3750KiB
`;

describe('buildMeasureArgs', () => {
  it('trims, high-passes and measures loudness', () => {
    expect(buildMeasureArgs({ input: 'in.wav', startSec: 10, endSec: 110, denoise: false, lufs: -18 })).toEqual([
      '-i',
      'in.wav',
      '-af',
      'atrim=start=10:end=110,asetpts=PTS-STARTPTS,highpass=f=80,loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json',
      '-f',
      'null',
      '-',
    ]);
  });

  it('adds gentle denoise after the high-pass when asked', () => {
    const af = buildMeasureArgs({ input: 'in.wav', startSec: 0, endSec: 20, denoise: true, lufs: -18 })[3];
    expect(af).toContain('highpass=f=80,afftdn=nr=10:nf=-50,loudnorm=');
  });
});

describe('parseLoudnorm', () => {
  it('extracts the measurement JSON from stderr', () => {
    expect(parseLoudnorm(LOUDNORM_STDERR)).toMatchObject(measured);
  });

  it('rejects silent audio', () => {
    expect(() => parseLoudnorm(LOUDNORM_STDERR.replace('"-21.03"', '"-inf"'))).toThrow(/silent/);
  });

  it('rejects output with no measurement', () => {
    expect(() => parseLoudnorm('nothing here')).toThrow(/loudnorm measurement/);
  });
});

describe('buildNormalizeArgs', () => {
  it('applies the measured values in linear mode, then fades', () => {
    expect(
      buildNormalizeArgs({
        input: 'in.wav',
        output: 'out.flac',
        startSec: 0,
        endSec: 20,
        denoise: false,
        lufs: -18,
        measured,
        fadeInSec: 3,
        fadeOutSec: 10,
      }),
    ).toEqual([
      '-i',
      'in.wav',
      '-af',
      'atrim=start=0:end=20,asetpts=PTS-STARTPTS,highpass=f=80,' +
        'loudnorm=I=-18:TP=-1.5:LRA=11:measured_I=-21.03:measured_TP=-14.50:measured_LRA=0.00:measured_thresh=-31.03:offset=0.01:linear=true,' +
        'aresample=48000,afade=t=in:d=3,afade=t=out:st=10:d=10',
      ...FLAC_OUT,
      'out.flac',
    ]);
  });

  it('omits fades when they are zero', () => {
    const af = buildNormalizeArgs({ input: 'in.wav', output: 'o.flac', startSec: 0, endSec: 20, denoise: false, lufs: -18, measured })[3];
    expect(af.endsWith('aresample=48000')).toBe(true);
  });
});

describe('loopCopies', () => {
  it.each([
    [20, 45, 5, 3],
    [2700, 7200, 5, 3],
    [20, 20, 5, 1],
  ])('source %ss → target %ss with %ss crossfade needs %i copies', (source, target, xf, expected) => {
    expect(loopCopies(source, target, xf)).toBe(expected);
  });

  it.each([8, 10])('rejects a %ss source as too short for a 5s crossfade', (source) => {
    expect(() => loopCopies(source, 60, 5)).toThrow(/too short to loop/);
  });
});

describe('buildLoopArgs', () => {
  it('chains crossfades across copies, trims to length, then fades', () => {
    expect(
      buildLoopArgs({ input: 'n.flac', output: 'o.flac', copies: 3, crossfadeSec: 5, durationSec: 45, fadeInSec: 3, fadeOutSec: 10 }),
    ).toEqual([
      '-i',
      'n.flac',
      '-i',
      'n.flac',
      '-i',
      'n.flac',
      '-filter_complex',
      '[0:a][1:a]acrossfade=d=5[x1];[x1][2:a]acrossfade=d=5[x2];[x2]atrim=end=45,afade=t=in:d=3,afade=t=out:st=35:d=10[out]',
      '-map',
      '[out]',
      ...FLAC_OUT,
      'o.flac',
    ]);
  });

  it('handles a single copy', () => {
    const args = buildLoopArgs({ input: 'n.flac', output: 'o.flac', copies: 1, crossfadeSec: 5, durationSec: 45 });
    expect(args[args.indexOf('-filter_complex') + 1]).toBe('[0:a]atrim=end=45[out]');
  });
});
