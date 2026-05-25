from datetime import date, datetime

from pydantic import BaseModel, Field


class WorkWindowMinutes(BaseModel):
    startMinutes: int
    endMinutes: int


class PersonScheduleDayInput(BaseModel):
    dayOfWeek: int
    windows: list[WorkWindowMinutes]


class PersonScheduleOverrideInput(BaseModel):
    date: date
    windows: list[WorkWindowMinutes]


class PersonScheduleInput(BaseModel):
    personId: str
    weekly: list[PersonScheduleDayInput] = Field(default_factory=list)
    overrides: list[PersonScheduleOverrideInput] = Field(default_factory=list)


class PreviousHoursEntry(BaseModel):
    key: str
    quarters: int


class PlanningWeights(BaseModel):
    wLate: float
    wUnscheduled: float
    wLoadBalance: float
    wMove: float
    wLaborCost: float = 1.0
    wPriority: float = 0.0  # project priority by delivery proximity


class EngineProcessDef(BaseModel):
    code: str
    waitHours: float = 0.0


class EnginePerson(BaseModel):
    id: str
    iniciales: str
    primary: list[str]
    fallback: list[str]
    capacityHours: float
    hourlyRate: float
    overtimeHourlyRate: float


class EngineTask(BaseModel):
    id: str
    projectId: str
    projectPriority: int = 50
    projectDeliveryDate: datetime | None = None
    lampId: str
    order: int
    process: str
    pendingHours: float
    canFragment: bool = True


class EngineAbsence(BaseModel):
    personId: str
    date: date
    hours: float = 0.0
    blockStartMinutes: int | None = None
    blockEndMinutes: int | None = None


class EngineHoliday(BaseModel):
    date: date


class FixedAssignment(BaseModel):
    taskId: str
    personId: str
    date: date
    startSlot: float
    endSlot: float
    hours: float
    process: str


class BookedHoursEntry(BaseModel):
    personId: str
    date: date
    hours: float


class SolveRequest(BaseModel):
    weekStart: date
    processes: list[EngineProcessDef]
    people: list[EnginePerson]
    tasks: list[EngineTask]
    absences: list[EngineAbsence] = Field(default_factory=list)
    holidays: list[EngineHoliday] = Field(default_factory=list)
    weights: PlanningWeights
    schedules: list[PersonScheduleInput] = Field(default_factory=list)
    previousHours: list[PreviousHoursEntry] = Field(default_factory=list)
    firstSchedulableDayIndex: int = 0
    firstSchedulableWeekQuarter: int | None = None
    fixedAssignments: list[FixedAssignment] = Field(default_factory=list)
    bookedHours: list[BookedHoursEntry] = Field(default_factory=list)


class EngineAssignment(BaseModel):
    taskId: str
    personId: str
    date: date
    startSlot: float
    endSlot: float
    hours: float
    process: str
    isAfternoon: bool


class EngineWarning(BaseModel):
    taskId: str
    reason: str


class SolveResponse(BaseModel):
    assignments: list[EngineAssignment]
    warnings: list[EngineWarning]
    unscheduledHours: float
