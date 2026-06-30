"""Precomputed worker-day slots: one CP index maps to week quarter + UI display."""

from __future__ import annotations

import bisect
from dataclasses import dataclass, field
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
class WorkSegment:
    """One contiguous productive run within a worker day (e.g. morning or afternoon)."""

    index: int
    compressed_start: int  # inclusive index into week_q / ui_slot
    compressed_end: int  # exclusive
    exp_start: int  # inclusive index into full wq_exp
    exp_end: int  # exclusive

    @property
    def cap(self) -> int:
        return self.compressed_end - self.compressed_start


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

    def work_segments(self) -> tuple[WorkSegment, ...]:
        """Split the day at schedule breaks (e.g. lunch) into productive segments."""
        if not self.week_q:
            return ()

        segments: list[WorkSegment] = []
        seg_start = 0
        exp_offset = 0

        for i in range(1, len(self.week_q)):
            if self.week_q[i] == self.week_q[i - 1] + 1:
                continue
            gap_size = self.week_q[i] - self.week_q[i - 1] - 1
            exp_start = seg_start + exp_offset
            exp_end = exp_start + (i - seg_start)
            segments.append(
                WorkSegment(
                    index=len(segments),
                    compressed_start=seg_start,
                    compressed_end=i,
                    exp_start=exp_start,
                    exp_end=exp_end,
                )
            )
            exp_offset += gap_size
            seg_start = i

        exp_start = seg_start + exp_offset
        exp_end = exp_start + (len(self.week_q) - seg_start)
        segments.append(
            WorkSegment(
                index=len(segments),
                compressed_start=seg_start,
                compressed_end=len(self.week_q),
                exp_start=exp_start,
                exp_end=exp_end,
            )
        )
        return tuple(segments)

    def compressed_to_exp(self, compressed_index: int) -> int | None:
        for segment in self.work_segments():
            if segment.compressed_start <= compressed_index < segment.compressed_end:
                return segment.exp_start + (compressed_index - segment.compressed_start)
        return None

    def segment_for_compressed(self, compressed_index: int) -> WorkSegment | None:
        for segment in self.work_segments():
            if segment.compressed_start <= compressed_index < segment.compressed_end:
                return segment
        return None


@dataclass(frozen=True)
class WeekQuarterRef:
    """One productive 15-min quarter on a worker's week timeline."""

    week_q: int
    ui_slot: float
    day_index: int
    day: date


@dataclass(frozen=True)
class DailyAssignmentSlice:
    """One calendar-day slice of a contiguous work block."""

    day: date
    day_index: int
    start_slot: float
    end_slot: float
    hours: float
    is_afternoon: bool


@dataclass(frozen=True)
class WorkerWeekTimeline:
    """Contiguous productive quarters for one worker across the planning week."""

    person_id: str
    quarters: tuple[WeekQuarterRef, ...]
    start_wqs: tuple[int, ...]
    # end_exclusive[i][d] = week_q after d productive quarters from index i
    end_exclusive: tuple[tuple[int, ...], ...]

    @property
    def cap(self) -> int:
        return len(self.quarters)

    @staticmethod
    def build_from_days(day_timelines: list[WorkerDayTimeline]) -> WorkerWeekTimeline:
        if not day_timelines:
            return WorkerWeekTimeline("", (), (), ())
        person_id = day_timelines[0].person_id
        quarters: list[WeekQuarterRef] = []
        for tl in sorted(day_timelines, key=lambda d: d.day_index):
            if tl.cap <= 0:
                continue
            for idx in range(tl.cap):
                quarters.append(
                    WeekQuarterRef(
                        week_q=tl.week_q[idx],
                        ui_slot=tl.ui_slot[idx],
                        day_index=tl.day_index,
                        day=tl.day,
                    )
                )
        return WorkerWeekTimeline.build_from_quarters(person_id, tuple(quarters))

    @staticmethod
    def build_from_quarters(
        person_id: str,
        quarters: tuple[WeekQuarterRef, ...],
    ) -> WorkerWeekTimeline:
        cap = len(quarters)
        start_wqs = tuple(q.week_q for q in quarters)
        end_rows: list[tuple[int, ...]] = []
        for i in range(cap):
            row = [quarters[i].week_q]
            for d in range(1, cap + 1):
                if i + d <= cap:
                    row.append(quarters[i + d - 1].week_q + 1)
                else:
                    row.append(quarters[-1].week_q + 1 if cap > 0 else 0)
            end_rows.append(tuple(row))
        return WorkerWeekTimeline(person_id, quarters, start_wqs, tuple(end_rows))

    def segment_start_indices(self) -> tuple[int, ...]:
        """Indices where a new work segment begins (day or morning/afternoon)."""
        if self.cap <= 0:
            return ()
        starts: list[int] = [0]
        for i in range(1, self.cap):
            prev = self.quarters[i - 1]
            curr = self.quarters[i]
            if curr.day_index != prev.day_index or curr.week_q != prev.week_q + 1:
                starts.append(i)
        return tuple(starts)

    def end_wq_for(self, start: int, duration_q: int) -> int | None:
        if duration_q <= 0 or start < 0 or start >= self.cap:
            return None
        if start + duration_q > self.cap:
            return None
        if duration_q >= len(self.end_exclusive[start]):
            return None
        return self.end_exclusive[start][duration_q]

    def same_day_span(self, start: int, duration_q: int) -> bool:
        if duration_q <= 0 or start < 0 or start + duration_q > self.cap:
            return False
        first = self.quarters[start].day_index
        last = self.quarters[start + duration_q - 1].day_index
        return first == last

    def quarters_by_day(self, start: int, duration_q: int) -> dict[int, list[WeekQuarterRef]]:
        grouped: dict[int, list[WeekQuarterRef]] = {}
        for ref in self.quarters[start : start + duration_q]:
            grouped.setdefault(ref.day_index, []).append(ref)
        return grouped

    def to_daily_slices(self, start: int, duration_q: int) -> list[DailyAssignmentSlice]:
        if duration_q <= 0 or start < 0 or start + duration_q > self.cap:
            return []
        slices: list[DailyAssignmentSlice] = []
        refs = list(self.quarters[start : start + duration_q])
        run_start = 0
        for i in range(1, len(refs) + 1):
            split = (
                i == len(refs)
                or refs[i].day_index != refs[i - 1].day_index
                or refs[i].week_q != refs[i - 1].week_q + 1
            )
            if not split:
                continue
            chunk = refs[run_start:i]
            first = chunk[0]
            last = chunk[-1]
            slices.append(
                DailyAssignmentSlice(
                    day=first.day,
                    day_index=first.day_index,
                    start_slot=first.ui_slot,
                    end_slot=last.ui_slot + 0.25,
                    hours=len(chunk) / QUARTERS_PER_HOUR,
                    is_afternoon=first.ui_slot >= AFTERNOON_UI_OFFSET,
                )
            )
            run_start = i
        return slices

    def find_start_index(
        self,
        day_index: int,
        start_slot: float,
        hours: float,
    ) -> int | None:
        """Match a fixed/busy assignment to a block start index."""
        size_q = round(hours * QUARTERS_PER_HOUR)
        if size_q <= 0:
            return None
        best: int | None = None
        best_dist = 1e9
        for i, ref in enumerate(self.quarters):
            if ref.day_index != day_index:
                continue
            if i + size_q > self.cap:
                continue
            dist = abs(ref.ui_slot - start_slot)
            if dist < best_dist:
                best_dist = dist
                best = i
        return best


@dataclass(frozen=True)
class BlockPlacement:
    start_idx: int
    assigned_q: int
    start_wq: int
    end_wq: int
    day_load: tuple[int, ...]


def build_placement_catalog(
    person_id: str,
    week_tl: WorkerWeekTimeline,
    max_demand_q: int,
    horizon_days: int = 5,
) -> WorkerPlacementCatalog:
    """Precompute all valid (start, duration) pairs for one worker week."""
    return WorkerPlacementCatalog.build(
        person_id, week_tl, max_demand_q, horizon_days
    )


@dataclass
class WorkerPlacementCatalog:
    """Shared placement grid for one worker; filtered per task on demand."""

    person_id: str
    week_tl: WorkerWeekTimeline
    placements: tuple[BlockPlacement, ...]
    horizon_days: int = 5
    start_wqs: tuple[int, ...] = ()
    _task_cache: dict[tuple[int, int, bool], tuple[BlockPlacement, ...]] = field(
        default_factory=dict,
        repr=False,
        compare=False,
    )

    @staticmethod
    def build(
        person_id: str,
        week_tl: WorkerWeekTimeline,
        max_demand_q: int,
        horizon_days: int = 5,
    ) -> WorkerPlacementCatalog:
        if week_tl.cap <= 0 or max_demand_q <= 0:
            return WorkerPlacementCatalog(person_id, week_tl, (), horizon_days, ())

        seen: set[tuple[int, int]] = set()
        placements: list[BlockPlacement] = []
        cap = week_tl.cap
        max_d = min(max_demand_q, cap)

        for i in range(cap):
            for d in range(1, min(max_d, cap - i) + 1):
                key = (i, d)
                if key in seen:
                    continue
                end_wq = week_tl.end_wq_for(i, d)
                if end_wq is None:
                    continue
                seen.add(key)
                by_day = [0] * horizon_days
                for ref in week_tl.quarters[i : i + d]:
                    by_day[ref.day_index] += 1
                placements.append(
                    BlockPlacement(
                        start_idx=i,
                        assigned_q=d,
                        start_wq=week_tl.start_wqs[i],
                        end_wq=end_wq,
                        day_load=tuple(by_day),
                    )
                )

        placements.sort(key=lambda p: (p.start_wq, p.start_idx, p.assigned_q))
        start_wqs = tuple(p.start_wq for p in placements)

        return WorkerPlacementCatalog(
            person_id,
            week_tl,
            tuple(placements),
            horizon_days,
            start_wqs,
        )

    def for_task(
        self,
        demand_q: int,
        min_week_quarter: int,
        can_fragment: bool,
    ) -> tuple[BlockPlacement, ...]:
        if demand_q <= 0 or not self.placements:
            return ()

        cache_key = (demand_q, min_week_quarter, can_fragment)
        cached = self._task_cache.get(cache_key)
        if cached is not None:
            return cached

        filtered: list[BlockPlacement] = []
        scan_from = 0
        if self.start_wqs:
            scan_from = bisect.bisect_left(self.start_wqs, min_week_quarter)
        for pl in self.placements[scan_from:]:
            if pl.assigned_q > demand_q:
                continue
            if pl.start_wq < min_week_quarter:
                continue
            if not can_fragment and not self.week_tl.same_day_span(
                pl.start_idx, pl.assigned_q
            ):
                continue
            filtered.append(pl)

        result = tuple(filtered)
        self._task_cache[cache_key] = result
        return result
