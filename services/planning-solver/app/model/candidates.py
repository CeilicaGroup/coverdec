from app.schemas import EnginePerson


def pick_candidates(people: list[EnginePerson], process: str) -> list[EnginePerson]:
    primary = [p for p in people if process in p.primary]
    fallback_only = [p for p in people if process in p.fallback and process not in p.primary]
    # Prefer primary workers first, but keep fallback as secondary option.
    return [*primary, *fallback_only]
