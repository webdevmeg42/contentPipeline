import { describe, expect, it } from 'vitest';
import { inspectInputs } from '../../src/assemble.js';

const audio = { duration: 7200, hasAudio: true, hasVideo: false };
const visual = { hasVideo: true, width: 4032, height: 3024 };
const ok = { audio, visual, visualVertical: null, shortStartSec: 30 };

describe('inspectInputs', () => {
  it('passes good inputs', () => {
    expect(inspectInputs(ok)).toEqual({ errors: [], warnings: [] });
  });

  it('allows a short that ends exactly at the end of the audio', () => {
    expect(inspectInputs({ ...ok, shortStartSec: 7140 }).errors).toEqual([]);
  });

  it.each([
    [{ audio: { ...audio, hasAudio: false } }, /no audio stream/],
    [{ visual: { ...visual, hasVideo: false } }, /Visual file is not an image or video/],
    [{ visualVertical: { hasVideo: false, width: 0, height: 0 } }, /Vertical visual file is not an image or video/],
    [{ shortStartSec: 7150 }, /runs past the end of the audio \(2:00:00\)/],
  ])('reports errors (%#)', (overrides, message) => {
    expect(inspectInputs({ ...ok, ...overrides }).errors.join('\n')).toMatch(message);
  });

  it('warns about low-resolution visuals', () => {
    const { errors, warnings } = inspectInputs({
      ...ok,
      visual: { hasVideo: true, width: 1280, height: 720 },
      visualVertical: { hasVideo: true, width: 720, height: 1280 },
    });
    expect(errors).toEqual([]);
    expect(warnings).toEqual([
      'Visual is 1280x720; below 1920x1080 it will look soft',
      'Vertical visual is 720x1280; below 1080x1920 it will look soft',
    ]);
  });
});
