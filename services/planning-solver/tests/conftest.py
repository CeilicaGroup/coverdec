"""Shared fixtures for planning-solver tests."""

from __future__ import annotations

from app.model.solve_week import SchedulerConfig, solve_week
from app.schemas import SolveRequest, SolveResponse


def run_solve(
    request: SolveRequest,
    *,
    max_seconds: int = 30,
) -> SolveResponse:
    """Call solve_week with the post-refactor SchedulerConfig API."""
    return solve_week(request, SchedulerConfig(max_solve_seconds=max_seconds))
