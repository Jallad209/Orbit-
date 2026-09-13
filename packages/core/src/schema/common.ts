import { z } from 'zod';
import { isValidLocalDate } from '../dates';

/** RFC 9562 UUID, any version 1–8. Orbit generates v7 (time-ordered). */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IdSchema = z.string().regex(UUID_RE, 'must be a UUID');
export type Id = string;

/** ISO 8601 instant with offset, e.g. 2026-09-12T14:30:00.000Z */
export const InstantSchema = z.string().datetime({ offset: true });
export type Instant = string;

/** Calendar date in the user's local zone, e.g. 2026-09-12 */
export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(isValidLocalDate, 'must be a real calendar date');
export type LocalDate = string;

/** Minutes since local midnight, 0..1440 */
export const MinuteOfDaySchema = z.number().int().min(0).max(1440);
export type MinuteOfDay = number;

export const EnergySchema = z.enum(['low', 'medium', 'high']);
export type Energy = z.infer<typeof EnergySchema>;

/** 1 = highest priority */
export const PrioritySchema = z.number().int().min(1).max(3);
export type Priority = number;

export const WeekdaySchema = z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']);
export type Weekday = z.infer<typeof WeekdaySchema>;

export const EntityTypeSchema = z.enum([
  'area',
  'goal',
  'project',
  'milestone',
  'task',
  'event',
  'routine',
  'routineInstance',
  'note',
  'person',
  'commitment',
  'bill',
  'block',
  'dayCommitment',
  'session',
  'rule',
  'link',
  'insightState',
  'capture',
  'reminder',
  'appSettings',
]);
export type EntityType = z.infer<typeof EntityTypeSchema>;

/** Fields every stored record carries. `deletedAt` implements soft delete. */
export const BaseRecordSchema = z.object({
  id: IdSchema,
  createdAt: InstantSchema,
  updatedAt: InstantSchema,
  deletedAt: InstantSchema.nullable().default(null),
});
export type BaseRecord = z.infer<typeof BaseRecordSchema>;
