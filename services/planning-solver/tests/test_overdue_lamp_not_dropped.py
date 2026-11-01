"""A lamp whose delivery already passed must still be planned this week.

Regression: lateness was measured on the end of the *planned* blocks, so leaving
the tail of the chain unscheduled made the lamp "finish" earlier. For overdue
projects (quadratic lateness × overdue multiplier) dropping hours was cheaper
than planning them late, and the work slid into later weeks.
"""

from datetime import date, datetime

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

WEEK_START = date(2026, 11, 2)  # Monday
WEEKLY = [
    PersonScheduleDayInput(
        dayOfWeek=d,
        windows=[
            WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
            WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
        ],
    )
    for d in range(1, 6)
]

# Same shape as the reported case: one lamp, six chained processes with drying.
CHAIN = [
    ("CNC", 3.0, 0),
    ("ENSAMBLAJE", 7.0, 0),
    ("LIJADO", 7.0, 0),
    ("IMPRIMACION", 2.0, 12),
    ("PINTURA", 2.5, 12),
    ("EMBALAJE", 1.25, 0),
]


def _request(delivery: datetime | None) -> SolveRequest:
    return SolveRequest(
        weekStart=WEEK_START,
        processes=[EngineProcessDef(code=code, waitHours=wait) for code, _, wait in CHAIN],
        people=[
            EnginePerson(
                id=f"op-{code.lower()}",
                iniciales=code[:2],
                primary=[code],
                fallback=[],
                capacityHours=8,
                hourlyRate=14.75,
                overtimeHourlyRate=22.13,
            )
            for code, _, _ in CHAIN
        ],
        tasks=[
            EngineTask(
                id=f"t-{code.lower()}",
                projectId="p1",
                projectPriority=10,
                projectDeliveryDate=delivery,
                deadlineCurveExponent=2,
                overduePenaltyMultiplier=2.5,
                lampId="lamp-1",
                order=i,
                process=code,
                pendingHours=hours,
            )
            for i, (code, hours, _) in enumerate(CHAIN)
        ],
        weights=PlanningWeights(wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1, wLaborCost=1),
        schedules=[
            PersonScheduleInput(personId=f"op-{code.lower()}", weekly=WEEKLY, overrides=[])
            for code, _, _ in CHAIN
        ],
    )


@pytest.mark.parametrize(
    "delivery",
    [
        datetime(2026, 11, 1),  # ya vencida (el caso reportado)
        datetime(2026, 11, 30),  # a tiempo
        None,
    ],
    ids=["vencida", "a-tiempo", "sin-fecha"],
)
def test_chain_that_fits_in_the_week_is_fully_planned(delivery):
    result = run_solve(_request(delivery), max_seconds=60)

    total = sum(hours for _, hours, _ in CHAIN)
    assert result.unscheduledHours == pytest.approx(0)
    assert sum(a.hours for a in result.assignments) == pytest.approx(total)
