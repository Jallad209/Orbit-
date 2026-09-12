import type { Clock } from '../clock';
import { createRecord } from '../records';
import { LinkSchema } from '../schema';
import type { EntityType, Id, Link } from '../schema';

export interface EntityRef {
  type: EntityType;
  id: Id;
}

/** Same pair, either direction, same link type. */
export function findDuplicateLink(
  links: readonly Link[],
  from: EntityRef,
  to: EntityRef,
  linkType = 'related',
): Link | undefined {
  return links.find(
    (l) =>
      l.deletedAt === null &&
      l.linkType === linkType &&
      ((l.fromType === from.type &&
        l.fromId === from.id &&
        l.toType === to.type &&
        l.toId === to.id) ||
        (l.fromType === to.type &&
          l.fromId === to.id &&
          l.toType === from.type &&
          l.toId === from.id)),
  );
}

/** Build a link record, or return the existing one when the pair is already linked. */
export function makeLink(
  clock: Clock,
  links: readonly Link[],
  from: EntityRef,
  to: EntityRef,
  linkType = 'related',
): { link: Link; created: boolean } {
  if (from.type === to.type && from.id === to.id) throw new Error('An item cannot link to itself.');
  const existing = findDuplicateLink(links, from, to, linkType);
  if (existing) return { link: existing, created: false };
  const link = createRecord(LinkSchema, clock, {
    fromType: from.type,
    fromId: from.id,
    toType: to.type,
    toId: to.id,
    linkType,
  });
  return { link, created: true };
}

/** The "other end" of every live link touching `entity`. */
export function linkedRefs(
  links: readonly Link[],
  entity: EntityRef,
): Array<EntityRef & { link: Link }> {
  const out: Array<EntityRef & { link: Link }> = [];
  for (const l of links) {
    if (l.deletedAt !== null) continue;
    if (l.fromType === entity.type && l.fromId === entity.id)
      out.push({ type: l.toType, id: l.toId, link: l });
    else if (l.toType === entity.type && l.toId === entity.id)
      out.push({ type: l.fromType, id: l.fromId, link: l });
  }
  return out;
}

/** Group the other ends by entity type, for the "linked" panel. */
export function groupLinked(
  links: readonly Link[],
  entity: EntityRef,
): Partial<Record<EntityType, Array<EntityRef & { link: Link }>>> {
  const groups: Partial<Record<EntityType, Array<EntityRef & { link: Link }>>> = {};
  for (const ref of linkedRefs(links, entity)) (groups[ref.type] ??= []).push(ref);
  return groups;
}
