"""Worker-day segment splitting (morning / afternoon)."""

from datetime import date

from app.model.timeline import (
    AFTERNOON_UI_OFFSET,
    WorkerDayTimeline,
    WorkWindowMinutes,
)
from app.schemas import PersonScheduleDayInput

WINDOWS = [
    WorkWindowMinutes(startMinutes=8 * 60, endMinutes=14 * 60),
    WorkWindowMinutes(startMinutes=15 * 60, endMinutes=17 * 60),
]
WEEKLY = [PersonScheduleDayInput(dayOfWeek=d, windows=WINDOWS) for d in range(1, 6)]


def test_default_day_splits_into_morning_and_afternoon_segments():
    tl = WorkerDayTimeline.build(
        "op1",
        date(2026, 5, 4),
        0,
        1,
        WEEKLY,
        None,
        0.0,
        None,
        False,
        8.0,
    )
    segments = tl.work_segments()
    assert len(segments) == 2
    assert segments[0].cap == 24
    assert segments[1].cap == 8
    assert tl.ui_slot[segments[1].compressed_start] >= AFTERNOON_UI_OFFSET
    assert tl.compressed_to_exp(0) == segments[0].exp_start
    assert tl.compressed_to_exp(24) == segments[1].exp_start
