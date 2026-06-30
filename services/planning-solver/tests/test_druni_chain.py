"""DRUNI-style lamp chain: successor starts when predecessor ends (slot-aware)."""

from datetime import date, datetime

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
from conftest import run_solve

WEEK_START = date(2026, 5, 4)
DEFAULT_WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]
WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=DEFAULT_WINDOWS) for d in range(1, 6)
]


def test_ensamblaje_noon_after_cnc_without_min_week_quarter():
    """CNC 8-12 on one worker → ENSAMBLAJE starts 12:00 on another (no minWeekQuarter)."""
    cnc_worker = EnginePerson(
        id="claudio",
        iniciales="CP",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    asm_worker = EnginePerson(
        id="ihor",
        iniciales="IA",
        primary=["ENSAMBLAJE"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    monday = WEEK_START
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="CNC", waitHours=0),
                EngineProcessDef(code="ENSAMBLAJE", waitHours=0),
            ],
            people=[cnc_worker, asm_worker],
            tasks=[
                EngineTask(
                    id="cnc-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                ),
                EngineTask(
                    id="ens-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 6, 1),
                    lampId="l1",
                    order=1,
                    process="ENSAMBLAJE",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=[
                PersonScheduleInput(personId="claudio", weekly=WEEKLY, overrides=[]),
                PersonScheduleInput(personId="ihor", weekly=WEEKLY, overrides=[]),
            ],
        ),
    )

    assert result.unscheduledHours == 0
    ens_monday = [
        a for a in result.assignments if a.taskId == "ens-1" and a.date == monday
    ]
    assert ens_monday, "ENSAMBLAJE should be scheduled on Monday after CNC finishes"
    first_start = min(a.startSlot for a in ens_monday)
    assert first_start <= 4.01, (
        f"ENSAMBLAJE should start at 12:00 (slot 4.0) after CNC, got {first_start}"
    )
    assert first_start >= 3.99
