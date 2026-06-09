from app.model.candidates import MANUAL_ESTIMATION_PROCESS, pick_candidates
from app.schemas import EnginePerson


def _person(pid: str, primary: list[str], fallback: list[str] | None = None) -> EnginePerson:
    return EnginePerson(
        id=pid,
        iniciales=pid.upper(),
        primary=primary,
        fallback=fallback or [],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )


def test_pick_candidates_filters_by_specialty_for_normal_processes():
    people = [
        _person("cnc-op", primary=["CNC"]),
        _person("lij-op", primary=["LIJADO"]),
    ]

    assert [p.id for p in pick_candidates(people, "CNC")] == ["cnc-op"]
    assert [p.id for p in pick_candidates(people, "LIJADO")] == ["lij-op"]
    assert pick_candidates(people, "PINTURA") == []


def test_pick_candidates_includes_fallback_after_primary():
    people = [
        _person("primary-op", primary=["CNC"]),
        _person("fallback-op", primary=[], fallback=["CNC"]),
        _person("other-op", primary=["LIJADO"]),
    ]

    assert [p.id for p in pick_candidates(people, "CNC")] == [
        "primary-op",
        "fallback-op",
    ]


def test_pick_candidates_returns_all_people_for_manual_estimation():
    people = [
        _person("cnc-op", primary=["CNC"]),
        _person("lij-op", primary=["LIJADO"]),
        _person("paint-op", primary=["PINTURA"]),
    ]

    result = pick_candidates(people, MANUAL_ESTIMATION_PROCESS)

    assert [p.id for p in result] == ["cnc-op", "lij-op", "paint-op"]
