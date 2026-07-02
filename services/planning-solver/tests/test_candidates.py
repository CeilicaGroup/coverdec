from app.model.candidates import MANUAL_ESTIMATION_PROCESS, pick_candidates
from app.schemas import EnginePerson


def _person(
    pid: str,
    primary: list[str],
    fallback: list[str] | None = None,
    *,
    nave_id: str = "default-nave",
) -> EnginePerson:
    return EnginePerson(
        id=pid,
        iniciales=pid.upper(),
        naveId=nave_id,
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


def test_pick_candidates_caps_at_three_workers():
    people = [
        _person(f"primary-{i}", primary=["CNC"])
        for i in range(4)
    ] + [
        _person(f"fallback-{i}", primary=[], fallback=["CNC"])
        for i in range(3)
    ]

    result = pick_candidates(people, "CNC")

    assert len(result) == 3
    assert [p.id for p in result] == ["primary-0", "primary-1", "primary-2"]


def test_pick_candidates_returns_all_people_for_manual_estimation():
    people = [
        _person("cnc-op", primary=["CNC"]),
        _person("lij-op", primary=["LIJADO"]),
        _person("paint-op", primary=["PINTURA"]),
    ]

    result = pick_candidates(people, MANUAL_ESTIMATION_PROCESS)

    assert [p.id for p in result] == ["cnc-op", "lij-op", "paint-op"]


def test_pick_candidates_filters_by_nave_when_task_has_nave():
    people = [
        _person("cnc-a", primary=["CNC"], nave_id="nave-a"),
        _person("cnc-b", primary=["CNC"], nave_id="nave-b"),
    ]

    assert [p.id for p in pick_candidates(people, "CNC", task_nave_id="nave-a")] == [
        "cnc-a",
    ]
    assert [p.id for p in pick_candidates(people, "CNC", task_nave_id="nave-b")] == [
        "cnc-b",
    ]
