import {
  DailyReflectionSchema,
  DailyReviewDraftSchema,
  NoteSchema,
  createRecord,
  newId,
  systemClock,
} from '@orbit/core';
import type {
  Clock,
  DailyReflection,
  DailyReviewDraft,
  DailyReviewKind,
  DailyReviewStep,
  Id,
  LocalDate,
  ReviewRef,
} from '@orbit/core';
import type { Repository } from '@orbit/storage';
import { bumpData } from '@/data/useQuery';

export async function loadDailyReviewDraft(
  repo: Repository,
  date: LocalDate,
  kind: DailyReviewKind,
): Promise<DailyReviewDraft | null> {
  return (
    (
      await repo.dailyReviewDrafts.query((draft) => draft.date === date && draft.kind === kind)
    ).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export interface DailyDraftPatch {
  step: DailyReviewStep;
  formState: Record<string, unknown>;
  createdRefs: ReviewRef[];
  deferredQuestions: DailyReviewDraft['deferredQuestions'];
  reminderTime: number | null;
}

export async function saveDailyReviewDraft(
  repo: Repository,
  date: LocalDate,
  kind: DailyReviewKind,
  patch: DailyDraftPatch,
  clock: Clock = systemClock,
): Promise<DailyReviewDraft> {
  const existing = await loadDailyReviewDraft(repo, date, kind);
  return repo.dailyReviewDrafts.upsert(
    existing
      ? { ...existing, ...patch }
      : createRecord(DailyReviewDraftSchema, clock, {
          id: newId(),
          date,
          kind,
          ...patch,
        }),
  );
}

export async function clearDailyReviewDraft(
  repo: Repository,
  date: LocalDate,
  kind: DailyReviewKind,
): Promise<void> {
  const draft = await loadDailyReviewDraft(repo, date, kind);
  if (!draft) return;
  await repo.transaction(async (tx) => {
    await tx.dailyReviewDrafts.softDelete(draft.id);
    const reminders = await tx.reminders.query(
      (reminder) => reminder.source === 'review-step' && reminder.entityId === draft.id,
    );
    for (const reminder of reminders) await tx.reminders.softDelete(reminder.id);
  });
  bumpData();
}

/** Remove abandoned review state and its direct reminders before a new local day starts. */
export async function clearExpiredDailyReviewDrafts(
  repo: Repository,
  today: LocalDate,
): Promise<number> {
  const drafts = await repo.dailyReviewDrafts.query((draft) => draft.date < today);
  if (!drafts.length) return 0;
  const ids = new Set(drafts.map((draft) => draft.id));
  await repo.transaction(async (tx) => {
    for (const draft of drafts) await tx.dailyReviewDrafts.softDelete(draft.id);
    const reminders = await tx.reminders.query(
      (reminder) => reminder.source === 'review-step' && ids.has(reminder.entityId),
    );
    for (const reminder of reminders) await tx.reminders.softDelete(reminder.id);
  });
  bumpData();
  return drafts.length;
}

export interface ReflectionInput {
  body: string;
  promptId: string | null;
  mood: number | null;
  stress: number | null;
  sleepQuality: number | null;
  tags: string[];
}

export async function loadDailyReflection(
  repo: Repository,
  date: LocalDate,
): Promise<DailyReflection | null> {
  return (await repo.dailyReflections.query((item) => item.date === date))[0] ?? null;
}

export async function loadDailyReflectionDraft(
  repo: Repository,
  date: LocalDate,
): Promise<ReflectionInput> {
  const reflection = await loadDailyReflection(repo, date);
  const note = reflection?.journalNoteId ? await repo.notes.get(reflection.journalNoteId) : null;
  return {
    body: note?.body ?? '',
    promptId: reflection?.promptId ?? null,
    mood: reflection?.mood ?? null,
    stress: reflection?.stress ?? null,
    sleepQuality: reflection?.sleepQuality ?? null,
    tags: reflection?.tags ?? [],
  };
}

/** Save the note and explicit reflection fields atomically; journal prose is never inspected. */
export async function saveDailyReflection(
  repo: Repository,
  date: LocalDate,
  input: ReflectionInput,
  clock: Clock = systemClock,
): Promise<DailyReflection> {
  const saved = await repo.transaction(async (tx) => {
    const existing = await loadDailyReflection(tx, date);
    let journalNoteId: Id | null = existing?.journalNoteId ?? null;
    const text = input.body.trim();
    if (text) {
      const title = `Daily journal · ${date}`;
      const note = journalNoteId ? await tx.notes.get(journalNoteId) : undefined;
      const stored = await tx.notes.upsert(
        note
          ? { ...note, body: text }
          : createRecord(NoteSchema, clock, { id: newId(), title, body: text }),
      );
      journalNoteId = stored.id;
    }
    return tx.dailyReflections.upsert(
      existing
        ? {
            ...existing,
            journalNoteId,
            promptId: input.promptId,
            mood: input.mood,
            stress: input.stress,
            sleepQuality: input.sleepQuality,
            tags: input.tags,
            completedAt: clock.now().toISOString(),
          }
        : createRecord(DailyReflectionSchema, clock, {
            id: newId(),
            date,
            journalNoteId,
            promptId: input.promptId,
            mood: input.mood,
            stress: input.stress,
            sleepQuality: input.sleepQuality,
            tags: input.tags,
            completedAt: clock.now().toISOString(),
          }),
    );
  });
  bumpData();
  return saved;
}
