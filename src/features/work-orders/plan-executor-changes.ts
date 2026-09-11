export interface ExecutorAssignmentRow {
  id: string;
  personId: string;
}

export interface ExecutorChangePlan {
  /** Assignment row ids to delete (people dropped from the executor set). */
  rowIdsToDelete: string[];
  /** Person ids that need brand-new rows, cloned from templateRowIds. */
  personIdsToAdd: string[];
  /** Existing row ids to mirror (same date/slot/hours) for each added person. */
  templateRowIds: string[];
}

/**
 * Diffs a task's current PlanningAssignment rows against a newly chosen
 * executor set: which rows to drop, which people need new (duplicated,
 * not split) rows, and which existing rows to clone as the template.
 *
 * The template always comes from ONE person's rows — preferably someone
 * being kept, otherwise whoever was already there — never a mix of two
 * different people's slices.
 */
export function planExecutorChanges(
  existingRows: ExecutorAssignmentRow[],
  personIds: string[],
): ExecutorChangePlan {
  const rowsByPerson = new Map<string, ExecutorAssignmentRow[]>();
  for (const row of existingRows) {
    const list = rowsByPerson.get(row.personId) ?? [];
    list.push(row);
    rowsByPerson.set(row.personId, list);
  }

  const rowIdsToDelete = [...rowsByPerson.entries()]
    .filter(([personId]) => !personIds.includes(personId))
    .flatMap(([, rows]) => rows.map((r) => r.id));

  const templatePersonId =
    personIds.find((id) => rowsByPerson.has(id)) ?? [...rowsByPerson.keys()][0];
  const templateRowIds = templatePersonId
    ? (rowsByPerson.get(templatePersonId) ?? []).map((r) => r.id)
    : [];

  const personIdsToAdd = personIds.filter((id) => !rowsByPerson.has(id));

  return { rowIdsToDelete, personIdsToAdd, templateRowIds };
}
