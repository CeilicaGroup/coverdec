from app.schemas import EnginePerson

# Budget/prototype lamps created "by hours" use this process; any active nave worker
# may be assigned (see load-engine-input person filter upstream).
MANUAL_ESTIMATION_PROCESS = "ESTIMACION_MANUAL"

MAX_CANDIDATES_PER_TASK = 3


def _person_matches_nave(person: EnginePerson, task_nave_id: str | None) -> bool:
    if not task_nave_id:
        return True
    return person.naveId == task_nave_id


def pick_candidates(
    people: list[EnginePerson],
    process: str,
    *,
    task_nave_id: str | None = None,
    max_count: int = MAX_CANDIDATES_PER_TASK,
) -> list[EnginePerson]:
    nave_people = [p for p in people if _person_matches_nave(p, task_nave_id)]
    if process == MANUAL_ESTIMATION_PROCESS:
        return list(nave_people)
    primary = [p for p in nave_people if process in p.primary]
    fallback_only = [
        p for p in nave_people if process in p.fallback and process not in p.primary
    ]
    ranked = [*primary, *fallback_only]
    if max_count <= 0 or len(ranked) <= max_count:
        return ranked
    return ranked[:max_count]
