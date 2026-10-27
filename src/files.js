import fs from 'node:fs';
import path from 'node:path';

export function partPath(file, tag = 'part') {
  const ext = path.extname(file);
  return `${file.slice(0, file.length - ext.length)}.${tag}${ext}`;
}

// Calls write(partPath) and renames to finalPath only if it succeeds,
// so an interrupted encode never leaves a complete-looking file behind.
export async function writeAtomically(finalPath, write) {
  const part = partPath(finalPath);
  try {
    await write(part);
    fs.renameSync(part, finalPath);
  } catch (err) {
    fs.rmSync(part, { force: true });
    throw err;
  }
}
