"""
Weekly CP-SAT scheduler — block model with contiguous worker assignments.

See solve_week_blocks.py for the implementation.
"""

from app.model.solve_week_blocks import (
    SchedulerConfig,
    SchedulerWeights,
    _coerce_weights,
    _delivery_urgency_score,
    solve_week,
)

__all__ = [
    "SchedulerConfig",
    "SchedulerWeights",
    "_coerce_weights",
    "_delivery_urgency_score",
    "solve_week",
]
