#!/usr/bin/env python3
"""Run solver tests without pytest (stdlib discovery)."""

from __future__ import annotations

import importlib.util
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
TESTS = ROOT / "tests"


def load_tests():
    modules = []
    for path in sorted(TESTS.glob("test_*.py")):
        spec = importlib.util.spec_from_file_location(path.stem, path)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        sys.modules[path.stem] = mod
        spec.loader.exec_module(mod)
        modules.append(mod)
    return modules


def main() -> int:
    failed = 0
    passed = 0
    for mod in load_tests():
        for name in dir(mod):
            if not name.startswith("test_"):
                continue
            fn = getattr(mod, name)
            if not callable(fn):
                continue
            try:
                fn()
                passed += 1
                print(f"PASS {mod.__name__}.{name}")
            except Exception as exc:
                failed += 1
                print(f"FAIL {mod.__name__}.{name}: {exc}")
                traceback.print_exc()
    print(f"\n{passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
