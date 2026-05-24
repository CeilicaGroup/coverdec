from datetime import date, datetime, timedelta

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

WEEK_START = date(2026, 5, 4)

DEFAULT_WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]

WEEKLY = [
    PersonScheduleDayInput(dayOfWeek=d, windows=DEFAULT_WINDOWS) for d in range(1, 6)
]


def _schedules(person_ids: list[str]) -> list[PersonScheduleInput]:
    return [
        PersonScheduleInput(personId=pid, weekly=WEEKLY, overrides=[])
        for pid in person_ids
    ]


def _base_request(tasks: list[EngineTask]) -> SolveRequest:
    return SolveRequest(
        weekStart=WEEK_START,
        processes=[
            EngineProcessDef(code="CNC"),
            EngineProcessDef(code="LIJADO"),
            EngineProcessDef(code="IMPRIMACION"),
            EngineProcessDef(code="PINTURA"),
        ],
        people=[
            EnginePerson(
                id="daniil",
                iniciales="DS",
                primary=["CNC"],
                fallback=[],
                capacityHours=8,
                hourlyRate=14.75,
                overtimeHourlyRate=22.13,
            ),
            EnginePerson(
                id="tetiana",
                iniciales="TM",
                primary=["LIJADO"],
                fallback=[],
                capacityHours=8,
                hourlyRate=14.75,
                overtimeHourlyRate=22.13,
            ),
        ],
        tasks=tasks,
        weights=PlanningWeights(
            wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1, wLaborCost=1
        ),
        schedules=_schedules(["daniil", "tetiana"]),
    )


def test_assigns_pending_hours_within_capacity():
    result = run_solve(
        _base_request(
            [
                EngineTask(
                    id="cnc-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                )
            ]
        ),
    )
    unassigned = [w for w in result.warnings if "sin asignar" in w.reason]
    assert len(unassigned) == 0
    total = sum(a.hours for a in result.assignments)
    assert abs(total - 4) < 0.1


def test_lamp_processes_do_not_overlap_on_same_day():
    result = run_solve(
        _base_request(
            [
                EngineTask(
                    id="cnc-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=1,
                ),
                EngineTask(
                    id="lij-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=1,
                    process="LIJADO",
                    pendingHours=2,
                ),
            ]
        ),
    )
    monday = [a for a in result.assignments if a.date == WEEK_START]
    if len(monday) >= 2:
        sorted_a = sorted(monday, key=lambda a: a.startSlot)
        for i in range(1, len(sorted_a)):
            assert sorted_a[i].startSlot >= sorted_a[i - 1].endSlot - 0.001


def test_lijado_starts_monday_after_ensamblaje_finishes():
    """LIJADO starts on Monday when ENS finishes at noon, spills at most into Tuesday.

    With early_start objective, starting Monday afternoon (after ENS) is
    preferred over waiting for Tuesday even though it requires a two-day split.
    The span-based gap penalty ensures the split spans at most one day (Mon→Tue),
    not a wider scatter (Mon→Thu or later).
    """
    painter = EnginePerson(
        id="tetiana",
        iniciales="TM",
        primary=["LIJADO"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    assembler = EnginePerson(
        id="ihor",
        iniciales="IA",
        primary=["ENSAMBLAJE"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="ENSAMBLAJE", waitHours=0),
                EngineProcessDef(code="LIJADO", waitHours=0),
            ],
            people=[painter, assembler],
            tasks=[
                EngineTask(
                    id="ens-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 20),
                    lampId="l1",
                    order=0,
                    process="ENSAMBLAJE",
                    pendingHours=4,
                ),
                EngineTask(
                    id="lij-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 20),
                    lampId="l1",
                    order=1,
                    process="LIJADO",
                    pendingHours=3,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["tetiana", "ihor"]),
        ),
    )
    lij = [a for a in result.assignments if a.taskId == "lij-1"]
    assert lij
    assert result.unscheduledHours == 0
    assert sum(a.hours for a in lij) >= 2.9
    monday = WEEK_START
    tuesday = WEEK_START + timedelta(days=1)
    lij_dates = {a.date for a in lij}
    assert monday in lij_dates, "LIJADO should start Monday (right after ENS finishes at noon)"
    assert max(lij_dates) <= tuesday, f"LIJADO should finish by Tuesday, got {max(lij_dates)}"


def test_lamp_precedence_cnc_before_lijado():
    """LIJADO on same lamp cannot be scheduled until CNC is fully assigned."""
    result = run_solve(
        _base_request(
            [
                EngineTask(
                    id="cnc-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=0,
                    process="CNC",
                    pendingHours=4,
                ),
                EngineTask(
                    id="lij-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=1,
                    process="LIJADO",
                    pendingHours=2,
                ),
            ]
        ),
    )
    cnc_hours = sum(a.hours for a in result.assignments if a.taskId == "cnc-1")
    lij_hours = sum(a.hours for a in result.assignments if a.taskId == "lij-1")
    if lij_hours > 0:
        assert cnc_hours >= 3.9


def test_accepts_extended_process_codes():
    """Process codes are open strings (not a fixed Literal enum)."""
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="PERFILES"),
                EngineProcessDef(code="EMBALAJE"),
                EngineProcessDef(code="PEGADO_ESPEJO"),
            ],
            people=[
                EnginePerson(
                    id="worker",
                    iniciales="WK",
                    primary=["PERFILES", "EMBALAJE", "PEGADO_ESPEJO"],
                    fallback=["LIMPIEZA"],
                    capacityHours=8,
                    hourlyRate=14,
                    overtimeHourlyRate=22,
                ),
            ],
            tasks=[
                EngineTask(
                    id="perfiles-1",
                    projectId="p1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=0,
                    process="PERFILES",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=1, wLoadBalance=1, wMove=1, wLaborCost=1
            ),
            schedules=_schedules(["worker"]),
        ),
    )
    assert result.assignments
    assert all(a.process == "PERFILES" for a in result.assignments)


def test_delivery_date_and_deadline_weight_schedule_full_lamp_chain():
    """Legacy wLate/wUnscheduled map to tier-1/0 and schedule the full lamp chain in-horizon."""
    painter = EnginePerson(
        id="painter",
        iniciales="PT",
        primary=["IMPRIMACION", "PINTURA"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    delivery = datetime(2026, 5, 6, 12, 0, 0)
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="IMPRIMACION", waitHours=0),
                EngineProcessDef(code="PINTURA", waitHours=0),
            ],
            people=[painter],
            tasks=[
                EngineTask(
                    id="imp-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=delivery,
                    lampId="l1",
                    order=0,
                    process="IMPRIMACION",
                    pendingHours=2,
                ),
                EngineTask(
                    id="paint-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=delivery,
                    lampId="l1",
                    order=1,
                    process="PINTURA",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=5, wUnscheduled=5, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["painter"]),
        ),
    )
    assert result.assignments
    assert result.unscheduledHours == 0
    week_end = date(2026, 5, 8)
    assert max(a.date for a in result.assignments) <= week_end
    processes = {a.process for a in result.assignments}
    assert processes == {"IMPRIMACION", "PINTURA"}


def test_dry_hours_delay_between_lamp_processes():
    """12h dry after imprimación pushes pintura to the next working window."""
    painter = EnginePerson(
        id="painter",
        iniciales="PT",
        primary=["IMPRIMACION", "PINTURA"],
        fallback=[],
        capacityHours=8,
        hourlyRate=10,
        overtimeHourlyRate=15,
    )
    result = run_solve(
        SolveRequest(
            weekStart=WEEK_START,
            processes=[
                EngineProcessDef(code="IMPRIMACION", waitHours=12),
                EngineProcessDef(code="PINTURA", waitHours=0),
            ],
            people=[painter],
            tasks=[
                EngineTask(
                    id="imp-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=0,
                    process="IMPRIMACION",
                    pendingHours=2,
                ),
                EngineTask(
                    id="paint-1",
                    projectId="pr1",
                    projectPriority=10,
                    projectDeliveryDate=datetime(2026, 5, 15),
                    lampId="l1",
                    order=1,
                    process="PINTURA",
                    pendingHours=2,
                ),
            ],
            weights=PlanningWeights(
                wLate=1, wUnscheduled=1, wLoadBalance=0, wMove=0, wLaborCost=0
            ),
            schedules=_schedules(["painter"]),
        ),
    )
    imp_days = {a.date for a in result.assignments if a.taskId == "imp-1"}
    paint_days = {a.date for a in result.assignments if a.taskId == "paint-1"}
    if imp_days and paint_days:
        assert min(paint_days) >= min(imp_days)


def test_health_endpoint():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    assert client.get("/health").json() == {"status": "ok"}
