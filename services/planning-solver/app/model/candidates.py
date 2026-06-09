from app.schemas import EnginePerson

# Budget/prototype lamps created "by hours" use this process; any active nave worker
# may be assigned (see load-engine-input person filter upstream).
MANUAL_ESTIMATION_PROCESS = "ESTIMACION_MANUAL"


def pick_candidates(people: list[EnginePerson], process: str) -> list[EnginePerson]:
    if process == MANUAL_ESTIMATION_PROCESS:
        return list(people)
    primary = [p for p in people if process in p.primary]
    fallback_only = [p for p in people if process in p.fallback and process not in p.primary]
    # Prefer primary workers first, but keep fallback as secondary option.
    return [*primary, *fallback_only]
