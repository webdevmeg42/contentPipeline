import { runFfprobe } from './run.js';

export async function probe(file) {
  const { stdout } = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  return parseProbe(JSON.parse(stdout));
}

export function parseProbe(info) {
  const video = info.streams.find((s) => s.codec_type === 'video');
  const audio = info.streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(info.format.duration) || 0,
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    // Still images are demuxed by image2 (jpeg/tiff) or a *_pipe demuxer (png, webp).
    isImage: /^image2$|_pipe$/.test(info.format.format_name),
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
  };
}
