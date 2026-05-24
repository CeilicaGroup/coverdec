"""Precomputed worker-day slots: one CP index maps to week quarter + UI display."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.schemas import (
    PersonScheduleDayInput,
    PersonScheduleOverrideInput,
    WorkWindowMinutes,
)

QUARTERS_PER_HOUR = 4
QUARTERS_PER_DAY = 24 * 4
MORNING_START_MINUTES = 8 * 60
MORNING_END_MINUTES = 14 * 60
AFTERNOON_START_MINUTES = 15 * 60
AFTERNOON_UI_OFFSET = 6.0

DEFAULT_WINDOWS: list[WorkWindowMinutes] = [
    WorkWindowMinutes(startMinutes=MORNING_START_MINUTES, endMinutes=MORNING_END_MINUTES),
    WorkWindowMinutes(startMinutes=AFTERNOON_START_MINUTES, endMinutes=17 * 60),
]


def get_windows_for_date(
    day_of_week: int,
    weekly: list[PersonScheduleDayInput],
    override: PersonScheduleOverrideInput | None,
) -> list[WorkWindowMinutes]:
    if override is not None:
        return override.windows
    for day in weekly:
        if day.dayOfWeek == day_of_week:
            return day.windows
    return DEFAULT_WINDOWS


def contract_quarters_for_day(
    day_of_week: int,
    weekly: list[PersonScheduleDayInput],
    override: PersonScheduleOverrideInput | None,
    absence_hours: float,
    absence_block: tuple[int, int] | None = None,
) -> int:
    windows = get_windows_for_date(day_of_week, weekly, override)
    if override is not None and len(windows) == 0:
        return 0
    raw = sum(round(max(0, w.endMinutes - w.startMinutes) / 15) for w in windows)
    if absence_block is not None:
        bs, be = absence_block
        forbidden = 0
        for w in windows:
            span_q = round(max(0, w.endMinutes - w.startMinutes) / 15)
            for i in range(span_q):
                m = w.startMinutes + i * 15
                if bs <= m < be:
                    forbidden += 1
        return max(0, raw - forbidden)
    absence_q = round(absence_hours * QUARTERS_PER_HOUR)
    return max(0, raw - absence_q)


def _minute_to_ui_slot(minute: int) -> float:
    if minute < MORNING_END_MINUTES:
        return (minute - MORNING_START_MINUTES) / 60.0
    if minute >= AFTERNOON_START_MINUTES:
        return AFTERNOON_UI_OFFSET + (minute - AFTERNOON_START_MINUTES) / 60.0
    return AFTERNOON_UI_OFFSET


def minute_to_week_quarter(day_index: int, minute_of_day: int) -> int:
    """Single global time unit: 15-min index from week start (0 = Mon 00:00)."""
    return day_index * QUARTERS_PER_DAY + minute_of_day // 15


def _build_expanded(
    wq_list: list[int], ui_list: list[float]
) -> tuple[tuple[int, ...], tuple[float, ...]]:
    """Build expanded wq/ui lists that include break-quarter slots.

    Whenever consecutive working quarters are non-adjacent (gap in week_q),
    insert the missing quarter values so the expanded list is contiguous.
    This lets CP-SAT enforce NoOverlap across the break positions.
    """
    wq_exp: list[int] = []
    ui_exp: list[float] = []
    for i, (q, u) in enumerate(zip(wq_list, ui_list)):
        wq_exp.append(q)
        ui_exp.append(u)
        if i < len(wq_list) - 1 and wq_list[i + 1] != q + 1:
            gap_size = wq_list[i + 1] - q - 1
            for g in range(gap_size):
                wq_exp.append(q + 1 + g)
                ui_exp.append(u + 0.25 * (g + 1))
    return tuple(wq_exp), tuple(ui_exp)


@dataclass(frozen=True)
class WorkerDayTimeline:
    """Compressed slot index i <-> week_q[i] (solver time) + ui_slot[i] (output only).

    wq_exp / ui_exp are the same data expanded to include break-quarter positions.
    CP-SAT variables use the expanded coordinate; wq / ui_slot are kept for reference.
    """

    person_id: str
    day: date
    day_index: int
    cap: int
    week_q: tuple[int, ...]
    ui_slot: tuple[float, ...]
    contract_q: int
    wq_exp: tuple[int, ...]   # expanded: includes break quarters
    ui_exp: tuple[float, ...]  # expanded: includes dummy break UI values

    @staticmethod
    def build(
        person_id: str,
        day: date,
        day_index: int,
        day_of_week: int,
        weekly: list[PersonScheduleDayInput],
        override: PersonScheduleOverrideInput | None,
        absence_hours: float,
        absence_block: tuple[int, int] | None,
        is_holiday: bool,
        capacity_hours: float,
        booked_quarters: int = 0,
    ) -> WorkerDayTimeline:
        empty = WorkerDayTimeline(person_id, day, day_index, 0, (), (), 0, (), ())
        if is_holiday:
            return empty

        windows = get_windows_for_date(day_of_week, weekly, override)
        if override is not None and len(windows) == 0:
            return empty

        contract_q = contract_quarters_for_day(
            day_of_week, weekly, override, absence_hours, absence_block
        )

        wq_list: list[int] = []
        ui_list: list[float] = []

        if not weekly and not override:
            cap_q = contract_q if contract_q > 0 else round(capacity_hours * QUARTERS_PER_HOUR)
            if cap_q <= 0:
                return empty
            productive = 0.0
            for _ in range(cap_q):
                if productive < 6.0:
                    minute = MORNING_START_MINUTES + int(productive * 60)
                else:
                    minute = AFTERNOON_START_MINUTES + int((productive - 6.0) * 60)
                wq_list.append(minute_to_week_quarter(day_index, minute))
                ui_list.append(productive)
                productive += 0.25
            wq_exp, ui_exp = _build_expanded(wq_list, ui_list)
            return WorkerDayTimeline(
                person_id, day, day_index, cap_q,
                tuple(wq_list), tuple(ui_list), contract_q,
                wq_exp, ui_exp,
            )

        for w in windows:
            span_q = round(max(0, w.endMinutes - w.startMinutes) / 15)
            for i in range(span_q):
                minute = w.startMinutes + i * 15
                if absence_block is not None:
                    bs, be = absence_block
                    if bs <= minute < be:
                        continue
                wq_list.append(minute_to_week_quarter(day_index, minute))
                ui_list.append(_minute_to_ui_slot(minute))

        cap = len(wq_list)
        if absence_block is None:
            absence_q = round(absence_hours * QUARTERS_PER_HOUR)
            if absence_q > 0:
                cap = max(0, cap - absence_q)
                wq_list = wq_list[:cap]
                ui_list = ui_list[:cap]

        if booked_quarters > 0:
            wq_list = wq_list[booked_quarters:]
            ui_list = ui_list[booked_quarters:]
            cap = len(wq_list)

        wq_exp, ui_exp = _build_expanded(wq_list, ui_list)
        return WorkerDayTimeline(
            person_id, day, day_index, cap,
            tuple(wq_list), tuple(ui_list), contract_q,
            wq_exp, ui_exp,
        )

    # ── Compressed-coordinate helpers (kept for backward-compat / reference) ──

    def week_start(self, local_start: int) -> int:
        if 0 <= local_start < len(self.week_q):
            return self.week_q[local_start]
        return self.day_index * QUARTERS_PER_DAY

    def week_end_exclusive(self, local_start: int, size_q: int) -> int:
        if size_q <= 0:
            return self.week_start(local_start)
        end_local = min(local_start + size_q - 1, len(self.week_q) - 1)
        return self.week_q[end_local] + 1

    def ui_start(self, local_start: int) -> float:
        if 0 <= local_start < len(self.ui_slot):
            return self.ui_slot[local_start]
        return AFTERNOON_UI_OFFSET

    def ui_end(self, local_start: int, size_q: int) -> float:
        if size_q <= 0:
            return self.ui_start(local_start)
        end_local = min(local_start + size_q - 1, len(self.ui_slot) - 1)
        return self.ui_slot[end_local] + 0.25

    def is_afternoon(self, local_start: int) -> bool:
        return self.ui_start(local_start) >= AFTERNOON_UI_OFFSET

    # ── Expanded-coordinate helpers (used by CP-SAT model) ───────────────────

    @property
    def gaps(self) -> list[tuple[int, int]]:
        """(expanded_start, gap_size) for each schedule break. Handles multiple gaps."""
        result: list[tuple[int, int]] = []
        offset = 0
        for i in range(len(self.week_q) - 1):
            if self.week_q[i + 1] != self.week_q[i] + 1:
                gap_size = self.week_q[i + 1] - self.week_q[i] - 1
                result.append((i + 1 + offset, gap_size))
                offset += gap_size
        return result

    def week_start_exp(self, local_exp: int) -> int:
        if 0 <= local_exp < len(self.wq_exp):
            return self.wq_exp[local_exp]
        return self.day_index * QUARTERS_PER_DAY

    def week_end_exclusive_exp(self, local_exp: int, size_q: int) -> int:
        if size_q <= 0:
            return self.week_start_exp(local_exp)
        end_local = min(local_exp + size_q - 1, len(self.wq_exp) - 1)
        return self.wq_exp[end_local] + 1

    def ui_start_exp(self, local_exp: int) -> float:
        if 0 <= local_exp < len(self.ui_exp):
            return self.ui_exp[local_exp]
        return AFTERNOON_UI_OFFSET

    def ui_end_exp(self, local_exp: int, size_q: int) -> float:
        if size_q <= 0:
            return self.ui_start_exp(local_exp)
        end_local = min(local_exp + size_q - 1, len(self.ui_exp) - 1)
        return self.ui_exp[end_local] + 0.25

    def is_afternoon_exp(self, local_exp: int) -> bool:
        return self.ui_start_exp(local_exp) >= AFTERNOON_UI_OFFSET
