import { describe, expect, it } from 'vitest';
import { FfmpegError, formatCommand, progressPercent } from '../../src/ffmpeg/run.js';

describe('formatCommand', () => {
  it('leaves safe args bare and single-quotes the rest', () => {
    expect(
      formatCommand('ffmpeg', ['-i', 'my file.wav', '-af', 'loudnorm=I=-18:print_format=json', '-vf', "zoompan=z='1+0.1'"]),
    ).toBe(`ffmpeg -i 'my file.wav' -af loudnorm=I=-18:print_format=json -vf 'zoompan=z='\\''1+0.1'\\'''`);
  });
});

describe('progressPercent', () => {
  it.each([
    ['out_time_us=30000000', 60, 50],
    ['out_time_us=90000000', 60, 100],
    ['frame=10', 60, null],
    ['out_time_us=N/A', 60, null],
    ['out_time_us=1000000', 0, null],
    ['out_time_us=1000000', undefined, null],
  ])('%s of %ss → %s', (line, total, expected) => {
    expect(progressPercent(line, total)).toBe(expected);
  });
});

describe('FfmpegError', () => {
  it('keeps the last 20 lines of stderr and the command', () => {
    const stderr = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
    const err = new FfmpegError({ bin: 'ffmpeg', exitCode: 1, stderr, command: 'ffmpeg -i x' });
    expect(err.message).toBe('ffmpeg failed with exit code 1');
    expect(err.command).toBe('ffmpeg -i x');
    const tail = err.stderrTail.split('\n');
    expect(tail).toHaveLength(20);
    expect(tail[0]).toBe('line 11');
    expect(tail.at(-1)).toBe('line 30');
  });
});
