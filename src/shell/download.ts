// Browser downloads. Zipping is a thin shell step over the DXF writer's file map.
import { strToU8, zipSync, type Zippable } from 'fflate';

// A fixed timestamp keeps the zip itself byte-identical for the same files.
const ZIP_MTIME = new Date('2000-01-01T00:00:00Z');

/** Zips `name -> text` files in the map's order. */
export function zipFiles(files: Map<string, string>): Uint8Array {
  const entries: Zippable = {};
  for (const [name, text] of files) entries[name] = [strToU8(text), { mtime: ZIP_MTIME }];
  return zipSync(entries, { level: 6 });
}

/** Offers bytes to the user as a file download. */
export function downloadBytes(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
}

/** A file-name-safe version of a Project name. */
export function safeFileName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';
}
