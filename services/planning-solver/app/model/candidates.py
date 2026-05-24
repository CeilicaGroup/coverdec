from app.schemas import EnginePerson


def pick_candidates(people: list[EnginePerson], process: str) -> list[EnginePerson]:
    primary = [p for p in people if process in p.primary]
    if primary:
        return primary
    return [p for p in people if process in p.fallback]
