import { VIDEO } from './config.js';
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
