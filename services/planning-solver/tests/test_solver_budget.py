"""El recorte de tiempo para problemas pequeños no puede convertirse en un fallo."""

from ortools.sat.python import cp_model

from app.model.solve_week_blocks import _dynamic_max_seconds, _should_retry_with_full_budget


def test_small_problem_budget_is_capped():
    assert _dynamic_max_seconds(240, task_count=3, block_count=10) == 15


def test_retries_when_capped_pass_finds_nothing():
    assert _should_retry_with_full_budget(cp_model.UNKNOWN, effective_max=15, configured_max=240)


def test_no_retry_when_capped_pass_already_had_full_budget():
    assert not _should_retry_with_full_budget(cp_model.UNKNOWN, effective_max=60, configured_max=60)


def test_no_retry_on_real_answers():
    for status in (cp_model.OPTIMAL, cp_model.FEASIBLE, cp_model.INFEASIBLE):
        assert not _should_retry_with_full_budget(status, effective_max=15, configured_max=240)
