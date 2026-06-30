"""Worker-week timeline: contiguous productive quarters across days."""

from datetime import date

from app.model.timeline import (
    AFTERNOON_UI_OFFSET,
    WorkerDayTimeline,
    WorkerWeekTimeline,
    WorkWindowMinutes,
)
from app.schemas import PersonScheduleDayInput

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


def test_week_timeline_concatenates_days():
    week = WorkerWeekTimeline.build_from_days(
        [_day_tl("op1", 0, date(2026, 5, 4)), _day_tl("op1", 1, date(2026, 5, 5))]
    )
    assert week.cap == 64
    assert week.quarters[0].day_index == 0
    assert week.quarters[-1].day_index == 1


def test_six_and_half_hours_monday_morning_to_afternoon():
    week = WorkerWeekTimeline.build_from_days([_day_tl("op1", 0, date(2026, 5, 4))])
    size_q = 26  # 6.5 h
    assert week.same_day_span(0, size_q)
    slices = week.to_daily_slices(0, size_q)
    assert len(slices) == 2
    assert sum(s.hours for s in slices) == 6.5
    assert slices[0].start_slot == 0.0
    assert slices[1].start_slot >= 6.0


def test_ten_hours_from_monday_crosses_to_tuesday():
    week = WorkerWeekTimeline.build_from_days(
        [_day_tl("op1", 0, date(2026, 5, 4)), _day_tl("op1", 1, date(2026, 5, 5))]
    )
    size_q = 40  # 10 h
    assert not week.same_day_span(0, size_q)
    slices = week.to_daily_slices(0, size_q)
    assert len(slices) == 3
    assert sum(s.hours for s in slices) == 10.0


def test_holiday_day_excluded():
    mon = _day_tl("op1", 0, date(2026, 5, 4))
    wed = WorkerDayTimeline.build(
        "op1",
        date(2026, 5, 6),
        2,
        3,
        WEEKLY,
        None,
        0.0,
        None,
        True,
        8.0,
    )
    fri = _day_tl("op1", 4, date(2026, 5, 8))
    week = WorkerWeekTimeline.build_from_days([mon, wed, fri])
    assert week.cap == 64
    day_indexes = {q.day_index for q in week.quarters}
    assert 2 not in day_indexes


def test_segment_start_indices():
    week = WorkerWeekTimeline.build_from_days([_day_tl("op1", 0, date(2026, 5, 4))])
    starts = week.segment_start_indices()
    assert starts[0] == 0
    assert 24 in starts  # afternoon segment


def test_end_wq_for_block():
    week = WorkerWeekTimeline.build_from_days([_day_tl("op1", 0, date(2026, 5, 4))])
    assert week.end_wq_for(0, 4) == week.quarters[3].week_q + 1
    assert week.end_wq_for(0, week.cap) == week.quarters[-1].week_q + 1
    assert week.end_wq_for(0, week.cap + 1) is None
