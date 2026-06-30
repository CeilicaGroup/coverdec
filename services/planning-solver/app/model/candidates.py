from app.schemas import EnginePerson

# Budget/prototype lamps created "by hours" use this process; any active nave worker
# may be assigned (see load-engine-input person filter upstream).
MANUAL_ESTIMATION_PROCESS = "ESTIMACION_MANUAL"

MAX_CANDIDATES_PER_TASK = 3


def pick_candidates(
    people: list[EnginePerson],
    process: str,
    *,
    max_count: int = MAX_CANDIDATES_PER_TASK,
) -> list[EnginePerson]:
    if process == MANUAL_ESTIMATION_PROCESS:
        return list(people)
    primary = [p for p in people if process in p.primary]
    fallback_only = [
        p for p in people if process in p.fallback and process not in p.primary
    ]
    ranked = [*primary, *fallback_only]
    if max_count <= 0 or len(ranked) <= max_count:
        return ranked
    return ranked[:max_count]
