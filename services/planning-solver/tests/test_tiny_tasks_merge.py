"""Sub-quarter tasks are rounded as a group, not one by one.

Regression: an OT with 96 chapas of 0.025 h (2.4 h of work) was planned as
96 × 0.25 h = 24 h, blocking one worker for three days.
"""

from datetime import date

import pytest

from conftest import run_solve
from app.schemas import (
    EnginePerson,
    EngineProcessDef,
    EngineTask,
    PersonScheduleDayInput,
    PersonScheduleInput,
    PlanningWeights,
    SolveRequest,
    WorkWindowMinutes,
)

WEEK_START = date(2026, 11, 2)
WEEKLY = [
    PersonScheduleDayInput(
        dayOfWeek=d,
        windows=[WorkWindowMinutes(startMinutes=8 * 60, endMinutes=16 * 60)],
    )
    for d in range(1, 6)
]
CHAPAS = 96
CHAPA_HOURS = 0.025


def _person(pid: str, process: str) -> EnginePerson:
    return EnginePerson(
        id=pid,
        iniciales=pid[:2].upper(),
        primary=[process],
        fallback=[],
        capacityHours=8,
        hourlyRate=14.75,
        overtimeHourlyRate=22.13,
    )


def _request() -> SolveRequest:
    chapas = [
        EngineTask(
            id=f"chapa-{i:02d}",
            projectId="p1",
            lampId="lamp-1",
            lampElementId=f"el-{i:02d}",
            order=0,
            process="PREPARACION_CHAPAS",
            pendingHours=0.25,
            rawPendingHours=CHAPA_HOURS,
            workOrderId="ot-chapas",
            workOrderSequence=i,
        )
        for i in range(CHAPAS)
    ]
    ensamblaje = EngineTask(
        id="ensamblaje-07",
        projectId="p1",
        lampId="lamp-1",
        lampElementId="el-07",
        order=1,
        process="ENSAMBLAJE",
        pendingHours=1,
        workOrderId="ot-ensamblaje",
        workOrderSequence=0,
    )
    people = [_person("chapista", "PREPARACION_CHAPAS"), _person("montador", "ENSAMBLAJE")]
    return SolveRequest(
        weekStart=WEEK_START,
        processes=[
            EngineProcessDef(code="PREPARACION_CHAPAS", waitHours=0),
            EngineProcessDef(code="ENSAMBLAJE", waitHours=0),
        ],
        people=people,
        tasks=[*chapas, ensamblaje],
        weights=PlanningWeights(wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1, wLaborCost=1),
        schedules=[PersonScheduleInput(personId=p.id, weekly=WEEKLY, overrides=[]) for p in people],
    )


def test_tiny_chapas_take_their_real_time_and_keep_chain_order():
    result = run_solve(_request(), max_seconds=30)

    assert result.unscheduledHours == pytest.approx(0)
    chapas = [a for a in result.assignments if a.taskId.startswith("chapa-")]
    assert not any(a.taskId.startswith("__") for a in result.assignments)

    # Cada chapa con su tiempo real; en total 2.4 h, no 24 h.
    hours_by_task: dict[str, float] = {}
    for a in chapas:
        hours_by_task[a.taskId] = hours_by_task.get(a.taskId, 0) + a.hours
    assert len(hours_by_task) == CHAPAS
    assert all(h == pytest.approx(CHAPA_HOURS) for h in hours_by_task.values())
    assert {a.personId for a in chapas} == {"chapista"}

    # Seguidas, en el orden de la OT y sin solaparse.
    chapas.sort(key=lambda a: (a.date, a.startSlot))
    assert [a.taskId for a in chapas] == [f"chapa-{i:02d}" for i in range(CHAPAS)]
    for prev, nxt in zip(chapas, chapas[1:]):
        assert (nxt.date, nxt.startSlot) >= (prev.date, prev.endSlot - 1e-9)

    # El ensamblaje del elemento 7 espera a que acabe su chapa.
    chapa_7 = next(a for a in chapas if a.taskId == "chapa-07")
    ens = min(
        (a for a in result.assignments if a.taskId == "ensamblaje-07"),
        key=lambda a: (a.date, a.startSlot),
    )
    assert (ens.date, ens.startSlot) >= (chapa_7.date, chapa_7.endSlot - 1e-9)
