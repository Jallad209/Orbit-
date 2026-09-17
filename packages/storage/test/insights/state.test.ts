import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import {
  APP_SETTINGS_ID,
  DEFAULT_INSIGHT_SETTINGS,
  DEFAULT_REVIEW_SETTINGS,
  InsightStateSchema,
  createRecord,
  dismissState,
  fixedClock,
  restoreState,
  snoozeState,
  snoozeUntilChangeState,
} from '@orbit/core';
import type { FixedClock, Insight, InsightState } from '@orbit/core';
import { createIndexedDbRepository } from '../../src/indexeddb';
import { readInsightStates, writeInsightState } from '../../src/insights';
import { createMemoryRepository } from '../../src/memory';
import type { Repository } from '../../src/repository';
import { createSqliteRepository } from '../../src/sqlite';
import type { SqlDriver } from '../../src/sqlite';
import { betterSqliteDriver } from '../betterSqliteDriver';

/**
 * Insight state persistence against every adapter: old rows normalize on
 * read, writes go by key inside one transaction, duplicates are retired,
 * and the last committed action wins without clobbering a newer change.
 */
const NOW = '2026-09-14T10:00:00.000Z';
const LEGACY_ID = '019372a0-0000-7000-8000-00000000a001';

/** Rows as week 9 wrote them, kept as a behaviour fixture beside the schema-version matrix. */
const WEEK9 = JSON.parse(
  readFileSync(
    new URL('../../../../tests/fixtures/behaviour/week9-rows.json', import.meta.url),
    'utf8',
  ),
) as { appSettings: Record<string, unknown>[]; insightStates: Record<string, unknown>[] };
const LEGACY_SETTINGS = WEEK9.appSettings[0]!;
const LEGACY_STATE = WEEK9.insightStates[0]!;
const LEGACY_DUPLICATE = WEEK9.insightStates[1]!;

interface Adapter {
  name: string;
  open(clock: FixedClock): Promise<{ repo: Repository; seedRaw(rows: RawRows): Promise<void> }>;
}

interface RawRows {
  appSettings?: Record<string, unknown>[];
  insightStates?: Record<string, unknown>[];
}

const adapters: Adapter[] = [
  {
    name: 'memory',
    async open(clock) {
      const repo = createMemoryRepository({ clock });
      return {
        repo,
        // Memory has no raw layer: legacy shapes arrive through upsert as they would from a JS caller.
        seedRaw: async (rows) => {
          for (const r of rows.appSettings ?? [])
            await repo.appSettings.upsert(r as never, { preserveUpdatedAt: true });
          for (const r of rows.insightStates ?? [])
            await repo.insightStates.upsert(r as never, { preserveUpdatedAt: true });
        },
      };
    },
  },
  {
    name: 'indexeddb',
    async open(clock) {
      const name = `orbit-insight-state-${Math.random()}`;
      const deps = { indexedDB: new IDBFactory(), IDBKeyRange };
      const repo = await createIndexedDbRepository({ name, clock, ...deps });
      return {
        repo,
        seedRaw: async (rows) => {
          const db = new Dexie(name, deps);
          await db.open();
          for (const [store, list] of Object.entries(rows)) await db.table(store).bulkPut(list);
          db.close();
        },
      };
    },
  },
  {
    name: 'sqlite',
    async open(clock) {
      const driver: SqlDriver = betterSqliteDriver();
      const repo = await createSqliteRepository({ driver, clock });
      return {
        repo,
        seedRaw: async (rows) => {
          for (const [store, list] of Object.entries(rows)) {
            for (const r of list) {
              await driver.execute(
                `INSERT INTO ${store}(id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
                [r.id as string, JSON.stringify(r)],
              );
            }
          }
        },
      };
    },
  },
];

function insight(key: string, fingerprint = 'aaaaaaaa00000000'): Insight {
  return {
    key,
    kind: 'stale-project',
    severity: 'attention',
    title: 'Thesis has had no recorded activity for 12 days.',
    detail: '',
    subject: { type: 'project', id: '019372a0-0000-7000-8000-000000000001' },
    evidence: [],
    threshold: {
      metric: 'staleDays',
      actual: 12,
      operator: '>=',
      limit: 10,
      unit: 'days',
      sampleSize: null,
      minSamples: null,
    },
    metrics: { staleDays: 12 },
    range: null,
    notes: [],
    computedAt: NOW,
    fingerprint,
    algorithmVersion: 1,
  };
}

for (const adapter of adapters) {
  describe(`insight state on ${adapter.name}`, () => {
    it('normalizes week-9 settings and states on read, on every read path', async () => {
      const clock = fixedClock(NOW);
      const { repo, seedRaw } = await adapter.open(clock);
      await seedRaw({ appSettings: [LEGACY_SETTINGS], insightStates: [LEGACY_STATE] });

      const settings = await repo.appSettings.get(APP_SETTINGS_ID);
      expect(settings).toEqual({
        ...LEGACY_SETTINGS,
        insights: DEFAULT_INSIGHT_SETTINGS,
        reviews: DEFAULT_REVIEW_SETTINGS,
      });
      expect((await repo.appSettings.list())[0]).toEqual(settings);

      const expected: InsightState = {
        ...(LEGACY_STATE as unknown as InsightState),
        snoozeMode: 'time',
        suppressedFingerprint: null,
        lastSummary: null,
      };
      expect(await repo.insightStates.get(LEGACY_ID)).toEqual(expected);
      expect(await repo.insightStates.getMany([LEGACY_ID])).toEqual([expected]);
      expect(await repo.insightStates.list()).toEqual([expected]);
      expect(await repo.insightStates.query((s) => s.snoozeMode === 'time')).toEqual([expected]);
      expect(await readInsightStates(repo)).toEqual([expected]);
      // Saving it back writes the current shape and the legacy row is gone for good.
      await repo.insightStates.upsert(restoreState(expected));
      expect(await repo.insightStates.get(LEGACY_ID)).toMatchObject({
        snoozeMode: null,
        snoozedUntil: null,
      });
      await repo.close();
    });

    it('writes by key in one transaction, merging duplicates into the canonical row', async () => {
      const clock = fixedClock(NOW);
      const { repo, seedRaw } = await adapter.open(clock);
      await seedRaw({ insightStates: [LEGACY_STATE, LEGACY_DUPLICATE] });
      expect(await repo.insightStates.count()).toBe(2);

      const written = await writeInsightState(
        repo,
        'neglected-goal:demo',
        (current) => {
          // The canonical row is the newest: the timed snooze, not the older dismissal.
          expect(current?.id).toBe(LEGACY_ID);
          expect(current?.snoozeMode).toBe('time');
          return dismissState(current, insight('neglected-goal:demo'), clock);
        },
        clock,
      );
      expect(written).toMatchObject({
        retired: 1,
        state: { id: LEGACY_ID, dismissedAt: NOW, updatedAt: NOW },
      });
      const live = await repo.insightStates.list();
      expect(live.map((s) => s.id)).toEqual([LEGACY_ID]);
      expect(await repo.insightStates.count({ includeDeleted: true })).toBe(2);
      expect((await readInsightStates(repo))[0]?.lastSummary?.title).toBe(insight('x').title);
      // Returning null writes nothing.
      const seq = await repo.opLog.latestSeq();
      expect(await writeInsightState(repo, 'neglected-goal:demo', () => null, clock)).toBeNull();
      expect(await repo.opLog.latestSeq()).toBe(seq);
      await repo.close();
    });

    it('creates the state on first action and keeps the id across later actions; a stale caller sees the newer row', async () => {
      const clock = fixedClock(NOW);
      const { repo } = await adapter.open(clock);
      const first = await writeInsightState(
        repo,
        'stale-project:p1',
        (current) => snoozeState(current, insight('stale-project:p1'), 'day', clock),
        clock,
      );
      expect(first?.state).toMatchObject({ insightKey: 'stale-project:p1', snoozeMode: 'time' });
      clock.advance(60_000);
      // Window B snoozes until change; window A, holding the old row, then dismisses: A's update
      // callback receives B's committed row, not the one A read earlier.
      await writeInsightState(
        repo,
        'stale-project:p1',
        (c) => snoozeUntilChangeState(c, insight('stale-project:p1'), clock),
        clock,
      );
      clock.advance(60_000);
      const seen: InsightState[] = [];
      const last = await writeInsightState(
        repo,
        'stale-project:p1',
        (current) => {
          seen.push(current!);
          return dismissState(current, insight('stale-project:p1'), clock);
        },
        clock,
      );
      expect(seen[0]).toMatchObject({
        snoozeMode: 'change',
        suppressedFingerprint: 'aaaaaaaa00000000',
      });
      expect(last?.state).toMatchObject({
        id: first?.state.id,
        dismissedAt: clock.now().toISOString(),
        snoozeMode: null,
      });
      expect(await repo.insightStates.count({ includeDeleted: true })).toBe(1);
      // The key is a lookup, never the id.
      expect(InsightStateSchema.safeParse({ ...last!.state, id: 'stale-project:p1' }).success).toBe(
        false,
      );
      await repo.close();
    });

    it('rolls the whole action back when the write fails', async () => {
      const clock = fixedClock(NOW);
      const { repo } = await adapter.open(clock);
      const a = createRecord(InsightStateSchema, clock, {
        insightKey: 'k',
        snoozedUntil: null,
        dismissedAt: null,
      });
      const b = createRecord(InsightStateSchema, clock, {
        insightKey: 'k',
        snoozedUntil: null,
        dismissedAt: null,
      });
      await repo.insightStates.upsert(a);
      await repo.insightStates.upsert(b);
      await expect(
        writeInsightState(repo, 'k', (current) => ({ ...current!, insightKey: 'other' }), clock),
      ).rejects.toThrow('keeps its key');
      expect(await repo.insightStates.count()).toBe(2); // the duplicate retirement rolled back too
      await repo.close();
    });
  });
}
