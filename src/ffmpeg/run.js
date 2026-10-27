import { spawn } from 'node:child_process';

const STDERR_TAIL_LINES = 20;

export class FfmpegMissingError extends Error {
  constructor(bin) {
    super(`${bin} not found. Install FFmpeg (brew install ffmpeg, or a static build from evermeet.cx) and make sure it is on PATH`);
    this.name = 'FfmpegMissingError';
  }
}

export class FfmpegError extends Error {
  constructor({ bin, exitCode, stderr, command }) {
    super(`${bin} failed with exit code ${exitCode}`);
    this.name = 'FfmpegError';
    this.exitCode = exitCode;
    this.command = command;
    this.stderrTail = stderr.trimEnd().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
  }
}

export function formatCommand(bin, args) {
  return [bin, ...args]
    .map((arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`))
    .join(' ');
}

export function progressPercent(line, totalSec) {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match || !(totalSec > 0)) return null;
  return Math.min(100, (Number(match[1]) / 1e6 / totalSec) * 100);
}

function spawnCollect(bin, args, onStdoutLine) {
  const command = formatCommand(bin, args);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      if (!onStdoutLine) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop();
      lines.forEach(onStdoutLine);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (err) => reject(err.code === 'ENOENT' ? new FfmpegMissingError(bin) : err));
    child.on('close', (exitCode) => {
      if (exitCode === 0) resolve({ stdout, stderr, command });
      else reject(new FfmpegError({ bin, exitCode, stderr, command }));
    });
  });
}

export function runFfmpeg(args, { totalSec, onProgress } = {}) {
  const fullArgs = ['-hide_banner', '-nostdin', '-y', '-nostats', '-progress', 'pipe:1', ...args];
  return spawnCollect('ffmpeg', fullArgs, (line) => {
    const pct = progressPercent(line, totalSec);
    if (pct !== null) onProgress?.(pct);
  });
}

export const runFfprobe = (args) => spawnCollect('ffprobe', args);
