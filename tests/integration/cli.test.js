import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTempDir } from './helpers.js';

const CLI = fileURLToPath(new URL('../../src/index.js', import.meta.url));

describe('CLI', () => {
  let env;
  let audio;
  let visual;

  beforeAll(() => {
    const dir = makeTempDir();
    audio = path.join(dir, 'frogs.flac');
    visual = path.join(dir, 'pond.jpg');
    fs.writeFileSync(audio, '');
    fs.writeFileSync(visual, '');
    env = { ...process.env, FCS_DB_PATH: path.join(dir, 'queue.db'), FCS_OUTPUT_DIR: path.join(dir, 'videos') };
  });

  const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { env, encoding: 'utf8' });
  const addArgs = (platforms) => [
    'add',
    '--title', 'Summer Night Frogs',
    '--audio', audio,
    '--visual', visual,
    '--platforms', platforms,
    '--schedule', '2026-10-28T20:00',
    '--short-start', '1:00',
    '--no-assemble',
  ];

  it('queues, lists and shows an item', () => {
    const add = cli(...addArgs('youtube,instagram'));
    expect(add.status, add.stderr).toBe(0);
    expect(add.stdout).toContain('Queued #1 "Summer Night Frogs" for 2026-10-28 20:00 → youtube, instagram');

    const list = cli('list');
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/#1\s+pending\s+2026-10-28 20:00\s+Summer Night Frogs\s+\[youtube,instagram\]/);

    const status = cli('status', '1');
    expect(status.status, status.stderr).toBe(0);
    expect(status.stdout).toContain('short from: 0:01:00');
    expect(status.stdout).toMatch(/instagram\s+pending/);
  });

  it('rejects bad input without writing to the queue', () => {
    const bad = cli(...addArgs('youtube,myspace'));
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Unknown platform\(s\): myspace/);
    expect(cli('list').stdout).not.toMatch(/#2/);
  });

  it('rejects a missing file', () => {
    const args = addArgs('youtube');
    args[args.indexOf('--audio') + 1] = '/nope/missing.flac';
    const bad = cli(...args);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/Audio not found: \/nope\/missing.flac/);
  });

  it('reports an unknown item', () => {
    const res = cli('status', '99');
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/No queue item with id 99/);
  });

  it('filters the list by status', () => {
    expect(cli('list', '--status', 'assembled').stdout).toContain('No items');
  });
});
