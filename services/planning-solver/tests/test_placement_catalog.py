"""WorkerPlacementCatalog: mid-segment starts and build performance."""

from __future__ import annotations

import time
from datetime import date, datetime, timedelta

from app.model.timeline import (
    WorkerDayTimeline,
    WorkerWeekTimeline,
    build_placement_catalog,
)
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
WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]
WEEKLY = [PersonScheduleDayInput(dayOfWeek=d, windows=WINDOWS) for d in range(1, 6)]


def _day_tl(person_id: str, day_index: int, day: date) -> WorkerDayTimeline:
    return WorkerDayTimeline.build(
        person_id,
        day,
        day_index,
        day.weekday() + 1,
        WEEKLY,
        None,
        0.0,
        None,
        False,
        8.0,
    )


def test_catalog_includes_mid_segment_starts():
    week = WorkerWeekTimeline.build_from_days([_day_tl("op1", 0, date(2026, 5, 4))])
    catalog = build_placement_catalog("op1", week, max_demand_q=8, horizon_days=5)

    segment_starts = set(week.segment_start_indices())
    # Noon Monday is compressed index 16 (slot 4.0 = 12:00).
    noon_idx = next(
        i for i, q in enumerate(week.quarters) if abs(q.ui_slot - 4.0) < 0.01
    )
    assert noon_idx not in segment_starts
    catalog_starts = {pl.start_idx for pl in catalog.placements}
    assert noon_idx in catalog_starts, "Catalog must allow starting at 12:00, not only segment boundaries"

    noon_placements = [pl for pl in catalog.placements if pl.start_idx == noon_idx]
    assert noon_placements, "At least one duration must start at noon"


def test_catalog_for_task_filters_by_min_week_quarter():
    week = WorkerWeekTimeline.build_from_days([_day_tl("op1", 0, date(2026, 5, 4))])
    catalog = build_placement_catalog("op1", week, max_demand_q=8, horizon_days=5)
    noon_idx = next(
        i for i, q in enumerate(week.quarters) if abs(q.ui_slot - 4.0) < 0.01
    )
    noon_wq = week.start_wqs[noon_idx]

    filtered = catalog.for_task(demand_q=8, min_week_quarter=noon_wq, can_fragment=True)
    assert filtered
    assert all(pl.start_wq >= noon_wq for pl in filtered)
    assert any(pl.start_idx == noon_idx for pl in filtered)


def test_catalog_build_under_budget():
    """Catalog build for a full worker week stays under 5s."""
    week_days = [WEEK_START + timedelta(days=i) for i in range(5)]
    week = WorkerWeekTimeline.build_from_days(
        [_day_tl("op0", i, d) for i, d in enumerate(week_days)]
    )
    t0 = time.perf_counter()
    catalog = build_placement_catalog("op0", week, max_demand_q=32, horizon_days=5)
    build_ms = (time.perf_counter() - t0) * 1000
    assert build_ms < 5000, f"Catalog build took {build_ms:.0f}ms"
    assert len(catalog.placements) > 500


def test_catalog_smoke_solve():
    """Catalog-backed model still solves a small instance."""
    windows = WINDOWS
    weekly = [PersonScheduleDayInput(dayOfWeek=d, windows=windows) for d in range(1, 6)]
    worker = EnginePerson(
        id="op0",
        iniciales="O0",
        primary=["CNC"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    tasks = [
        EngineTask(
            id=f"t{i}",
            projectId=f"p{i}",
            projectPriority=10,
            projectDeliveryDate=datetime(2026, 6, 1),
            lampId=f"l{i}",
            order=0,
            process="CNC",
            pendingHours=2,
        )
        for i in range(5)
    ]
    request = SolveRequest(
        weekStart=WEEK_START,
        processes=[EngineProcessDef(code="CNC")],
        people=[worker],
        tasks=tasks,
        weights=PlanningWeights(
            wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
        ),
        schedules=[PersonScheduleInput(personId="op0", weekly=weekly, overrides=[])],
    )
    result = run_solve(request, max_seconds=30)
    assert result.unscheduledHours == 0
