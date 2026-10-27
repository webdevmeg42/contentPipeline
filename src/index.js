#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import { assembleItem } from './assemble.js';
import { AUDIO, DEFAULT_SHORT_START_SEC, MOTIONS, PLATFORMS, parsePlatforms } from './config.js';
import { getItem, getTargets, insertItem, listItems, openDb, resetStuckAssemblies } from './db.js';
import { FfmpegError } from './ffmpeg/run.js';
import { prepAudio } from './prep.js';
import { formatDuration, localToUtcIso, parseDuration, toLocalDisplay } from './time.js';

const interactive = process.stderr.isTTY;

function showProgress(stage, pct) {
  if (interactive) process.stderr.write(`\r  ${stage.padEnd(10)} ${pct.toFixed(0).padStart(3)}%`);
}

function endProgress() {
  if (interactive) process.stderr.write('\n');
}

function openQueue() {
  const db = openDb();
  const reset = resetStuckAssemblies(db);
  if (reset) console.log(`Reset ${reset} interrupted assembly item(s) to pending`);
  return db;
}

function action(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      endProgress();
      console.error(`Error: ${err.message}`);
      if (err instanceof FfmpegError) {
        console.error(`\nCommand:\n  ${err.command}\n\nFFmpeg output (last lines):\n${err.stderrTail}`);
      }
      process.exitCode = 1;
    }
  };
}

function requireFile(file, label) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`${label} not found: ${file}`);
  return abs;
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new InvalidArgumentError('must be a positive integer');
  return id;
}

async function runAssembly(db, id) {
  console.log(`Assembling #${id}…`);
  const result = await assembleItem(db, id, { onProgress: showProgress });
  endProgress();
  for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
  console.log(`  long:  ${result.longVideoPath}\n  short: ${result.shortVideoPath}`);
}

const program = new Command().name('fcs').description('Florida Country Sounds content pipeline');

program
  .command('prep')
  .description('clean, normalize and optionally loop an edited recording')
  .argument('<input>', 'edited recording (wav, flac, mp3, m4a)')
  .option('--trim-start <duration>', 'cut from the start', '0')
  .option('--trim-end <duration>', 'cut from the end', '0')
  .option('--duration <duration>', 'final length; loops with crossfades if longer than the recording')
  .option('--denoise', 'apply gentle hiss reduction')
  .option('--lufs <number>', 'target loudness, e.g. --lufs=-16', String(AUDIO.lufs))
  .option('--out <path>', 'output file (default: assets/audio/<name>.prepped.flac)')
  .action(
    action(async (input, opts) => {
      const lufs = Number(opts.lufs);
      if (!(lufs < 0)) throw new Error('--lufs must be a negative number, e.g. --lufs=-18');
      const result = await prepAudio({
        input: requireFile(input, 'Input'),
        output: opts.out ? path.resolve(opts.out) : undefined,
        trimStartSec: parseDuration(opts.trimStart),
        trimEndSec: parseDuration(opts.trimEnd),
        durationSec: opts.duration ? parseDuration(opts.duration) : undefined,
        denoise: Boolean(opts.denoise),
        lufs,
        onProgress: showProgress,
      });
      endProgress();
      console.log(`Prepped ${formatDuration(result.durationSec)}${result.looped ? ' (looped)' : ''} → ${result.output}`);
    }),
  );

program
  .command('add')
  .description('queue an item and assemble its videos')
  .requiredOption('--title <title>', 'video title')
  .requiredOption('--audio <path>', 'prepped audio file')
  .requiredOption('--visual <path>', 'photo or video clip')
  .requiredOption('--platforms <list>', `comma-separated: ${PLATFORMS.join(',')}`)
  .requiredOption('--schedule <datetime>', 'Florida local time, e.g. 2026-10-28T20:00')
  .option('--visual-vertical <path>', 'separate photo or clip for the 9:16 short')
  .option('--motion <motion>', MOTIONS.join(' | '), 'static')
  .option('--short-start <time>', 'where the 60s short starts in the audio', String(DEFAULT_SHORT_START_SEC))
  .option('--description <text>', 'video description')
  .option('--no-assemble', 'queue only; run `assemble <id>` later')
  .action(
    action(async (opts) => {
      if (!MOTIONS.includes(opts.motion)) throw new Error(`--motion must be one of: ${MOTIONS.join(', ')}`);
      const item = {
        title: opts.title,
        description: opts.description,
        audioPath: requireFile(opts.audio, 'Audio'),
        visualPath: requireFile(opts.visual, 'Visual'),
        visualVerticalPath: opts.visualVertical ? requireFile(opts.visualVertical, 'Vertical visual') : undefined,
        motion: opts.motion,
        shortStartSec: Math.floor(parseDuration(opts.shortStart)),
        scheduledAt: localToUtcIso(opts.schedule),
      };
      const platforms = parsePlatforms(opts.platforms);

      const db = openQueue();
      const id = insertItem(db, item, platforms);
      console.log(`Queued #${id} "${item.title}" for ${toLocalDisplay(item.scheduledAt)} → ${platforms.join(', ')}`);
      if (opts.assemble) await runAssembly(db, id);
    }),
  );

program
  .command('assemble')
  .description('(re)build the long and short videos for an item')
  .argument('<id>', 'queue item id', parseId)
  .action(action(async (id) => runAssembly(openQueue(), id)));

program
  .command('list')
  .description('show queued items')
  .option('--status <status>', 'pending | assembling | assembled | assembly_failed')
  .action(
    action(async (opts) => {
      const db = openQueue();
      const items = listItems(db, { status: opts.status });
      if (items.length === 0) {
        console.log('No items');
        return;
      }
      for (const item of items) {
        const platforms = getTargets(db, item.id).map((t) => t.platform).join(',');
        console.log(
          `#${String(item.id).padEnd(4)} ${item.status.padEnd(16)} ${toLocalDisplay(item.scheduled_at)}  ${item.title}  [${platforms}]`,
        );
      }
    }),
  );

program
  .command('status')
  .description('show one item and its per-platform status')
  .argument('<id>', 'queue item id', parseId)
  .action(
    action(async (id) => {
      const db = openQueue();
      const item = getItem(db, id);
      if (!item) throw new Error(`No queue item with id ${id}`);
      const lines = [
        `#${item.id} ${item.title}`,
        `  status:     ${item.status}`,
        `  scheduled:  ${toLocalDisplay(item.scheduled_at)} (Florida time)`,
        `  audio:      ${item.audio_path}`,
        `  visual:     ${item.visual_path}`,
        ...(item.visual_vertical_path ? [`  vertical:   ${item.visual_vertical_path}`] : []),
        `  motion:     ${item.motion}`,
        `  short from: ${formatDuration(item.short_start_sec)}`,
        ...(item.long_video_path ? [`  long:       ${item.long_video_path}`, `  short:      ${item.short_video_path}`] : []),
        ...(item.error ? [`  error:      ${item.error}`] : []),
        '  platforms:',
        ...getTargets(db, item.id).map(
          (t) =>
            `    ${t.platform.padEnd(15)} ${t.status}` +
            (t.platform_post_id ? `  ${t.platform_post_id}` : '') +
            (t.last_error ? `  (${t.last_error})` : ''),
        ),
      ];
      console.log(lines.join('\n'));
    }),
  );

await program.parseAsync(process.argv);
