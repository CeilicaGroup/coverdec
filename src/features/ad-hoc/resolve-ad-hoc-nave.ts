export interface AdHocPersonNaveRow {
  personId: string;
  naveIds: string[];
}

export const AD_HOC_PERSON_NOT_FOUND_ERROR = "Persona no encontrada.";
export const AD_HOC_PERSON_WITHOUT_NAVE_ERROR = "El operario no tiene nave asignada.";
export const AD_HOC_SELECT_NAVE_ERROR = "Selecciona la nave de la imprevista.";
export const AD_HOC_OPERATORS_DIFFERENT_NAVES_ERROR =
  "Los operarios deben pertenecer a la misma nave.";
export const AD_HOC_OPERATOR_NOT_IN_NAVE_ERROR =
  "Uno o más operarios no pertenecen a la nave seleccionada.";

export function resolveAdHocNaveId(
  people: AdHocPersonNaveRow[],
  explicitNaveId?: string,
): string {
  if (people.length === 0) {
    throw new Error(AD_HOC_PERSON_NOT_FOUND_ERROR);
  }

  if (explicitNaveId) {
    for (const person of people) {
      if (!person.naveIds.includes(explicitNaveId)) {
        throw new Error(AD_HOC_OPERATOR_NOT_IN_NAVE_ERROR);
      }
    }
    return explicitNaveId;
  }

  const uniqueNaves = new Set(people.flatMap((person) => person.naveIds));
  if (uniqueNaves.size === 0) {
    throw new Error(AD_HOC_PERSON_WITHOUT_NAVE_ERROR);
  }

  const personWithMultipleNaves = people.find((person) => person.naveIds.length > 1);
  if (personWithMultipleNaves) {
    throw new Error(AD_HOC_SELECT_NAVE_ERROR);
  }

  if (uniqueNaves.size > 1) {
    throw new Error(AD_HOC_OPERATORS_DIFFERENT_NAVES_ERROR);
  }

  return people[0]!.naveIds[0]!;
}

export function formatAdHocPersonLabel(args: {
  name: string;
  iniciales: string;
  naveCodigo?: string;
}): string {
  const displayName =
    args.name.trim() && args.name !== args.iniciales
      ? `${args.name} (${args.iniciales})`
      : args.name || args.iniciales;
  return args.naveCodigo ? `${displayName} · ${args.naveCodigo}` : displayName;
}
