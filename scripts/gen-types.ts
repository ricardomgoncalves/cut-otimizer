// Generates the Parts Export v1 types from the vendored schema.
// Run `bun run gen:types`; CI fails when the committed file is out of date.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compile, type JSONSchema } from 'json-schema-to-typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const schemaPath = `${root}vendor/parts-export/parts-export.v1.schema.json`;
const outPath = `${root}src/core/import/parts-export.v1.generated.ts`;

const schema = JSON.parse(await readFile(schemaPath, 'utf8')) as JSONSchema;
const ts = await compile(schema, 'PartsExport', {
  bannerComment:
    '/* Generated from vendor/parts-export/parts-export.v1.schema.json by scripts/gen-types.ts. Do not edit; run `bun run gen:types`. */',
  additionalProperties: false,
  unreachableDefinitions: true,
  cwd: `${root}vendor/parts-export`,
  style: { singleQuote: true },
});
await writeFile(outPath, ts);
console.log(`wrote ${outPath}`);
