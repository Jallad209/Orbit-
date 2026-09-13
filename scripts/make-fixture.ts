/**
 * Regenerate the data-safety fixtures for the CURRENT schema versions.
 * Part of the release checklist: run after any schema bump, commit the
 * new files, never edit or delete the old versions (they are the matrix).
 *
 *   pnpm run make:fixture
 *
 * Writes:
 *   tests/fixtures/export/v<EXPORT_SCHEMA_VERSION>.json   — an export envelope
 *   tests/fixtures/idb/v<INDEXEDDB_SCHEMA_VERSION>.json   — raw Dexie rows per store
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixedClock, seedWorld } from '@orbit/core';
import type { BaseRecord } from '@orbit/core';
import {
  EXPORT_SCHEMA_VERSION,
  INDEXEDDB_SCHEMA_VERSION,
  STORE_ORDER,
  createMemoryRepository,
  exportJson,
  serializeExport,
} from '@orbit/storage';
import type { EntityStore } from '@orbit/storage';

const clock = fixedClock('2026-09-12T09:00:00.000Z');
const world = seedWorld({
  seed: 2026,
  sizes: { tasks: 60, notes: 12, events: 6, people: 5, days: 7 },
});

const repo = createMemoryRepository({ clock });
await repo.transaction(async (tx) => {
  for (const name of STORE_ORDER) {
    const store = tx[name] as unknown as EntityStore<BaseRecord>;
    for (const rec of world[name]) await store.upsert(rec, { preserveUpdatedAt: true });
  }
});

mkdirSync('tests/fixtures/export', { recursive: true });
mkdirSync('tests/fixtures/idb', { recursive: true });

const envelope = await exportJson(repo, clock);
const exportPath = `tests/fixtures/export/v${EXPORT_SCHEMA_VERSION}.json`;
writeFileSync(exportPath, serializeExport(envelope) + '\n');

const stores: Record<string, BaseRecord[]> = {};
for (const name of STORE_ORDER) stores[name] = envelope.data[name];
const idbPath = `tests/fixtures/idb/v${INDEXEDDB_SCHEMA_VERSION}.json`;
writeFileSync(
  idbPath,
  JSON.stringify({ schemaVersion: INDEXEDDB_SCHEMA_VERSION, stores }, null, 2) + '\n',
);

const total = STORE_ORDER.reduce((n, name) => n + envelope.data[name].length, 0);
console.log(`wrote ${exportPath} and ${idbPath} (${total} records)`);
