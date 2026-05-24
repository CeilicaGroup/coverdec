import logging
import os
import time

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.model.solve_week import SchedulerConfig, solve_week
from app.schemas import SolveRequest, SolveResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("planning-solver")

app = FastAPI(title="CoverDec Planning Solver", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    _request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    logger.warning("request validation failed", extra={"errors": exc.errors()})
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/solve", response_model=SolveResponse)
def solve(body: SolveRequest) -> SolveResponse:
    max_seconds = int(os.environ.get("SOLVER_MAX_SECONDS", "60"))
    started = time.perf_counter()
    result = solve_week(
        body,
        SchedulerConfig(max_solve_seconds=max_seconds),
    )
    logger.info(
        "solve done",
        extra={
            "solve_ms": int((time.perf_counter() - started) * 1000),
            "assignments": len(result.assignments),
            "warnings": len(result.warnings),
        },
    )
    return result
