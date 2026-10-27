import { describe, expect, it } from 'vitest';
import { PLATFORMS, PLATFORM_VIDEO, parsePlatforms } from '../../src/config.js';

describe('parsePlatforms', () => {
  it('splits, trims, lowercases and dedupes', () => {
    expect(parsePlatforms(' YouTube,instagram ,youtube')).toEqual(['youtube', 'instagram']);
  });

  it('rejects unknown platforms and names them', () => {
    expect(() => parsePlatforms('youtube,myspace')).toThrow(/Unknown platform\(s\): myspace/);
  });

  it('rejects an empty list', () => {
    expect(() => parsePlatforms(' , ')).toThrow(/At least one platform/);
  });
});

describe('PLATFORM_VIDEO', () => {
  it('maps each platform to the video it needs', () => {
    expect(PLATFORM_VIDEO.youtube).toBe('long');
    expect(PLATFORM_VIDEO.facebook).toBe('long');
    expect(PLATFORM_VIDEO.youtube_shorts).toBe('short');
    expect(PLATFORM_VIDEO.instagram).toBe('short');
    expect(PLATFORM_VIDEO.tiktok).toBe('short');
    expect(PLATFORM_VIDEO.bluesky).toBe('short');
    expect(PLATFORM_VIDEO.substack).toBeNull();
    expect(PLATFORMS).toHaveLength(7);
  });
});
