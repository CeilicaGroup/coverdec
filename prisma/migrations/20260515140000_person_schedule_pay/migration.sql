-- Person pay rates
ALTER TABLE "Person" ADD COLUMN "hourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 14.75;
ALTER TABLE "Person" ADD COLUMN "overtimeHourlyRate" DECIMAL(10,2) NOT NULL DEFAULT 22.13;

-- Weekly schedule template + date overrides
CREATE TABLE "PersonWorkWindow" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    CONSTRAINT "PersonWorkWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonScheduleOverride" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    CONSTRAINT "PersonScheduleOverride_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonOverrideWindow" (
    "id" TEXT NOT NULL,
    "overrideId" TEXT NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "endMinutes" INTEGER NOT NULL,
    CONSTRAINT "PersonOverrideWindow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PersonWorkWindow_personId_dayOfWeek_idx" ON "PersonWorkWindow"("personId", "dayOfWeek");
CREATE UNIQUE INDEX "PersonScheduleOverride_personId_date_key" ON "PersonScheduleOverride"("personId", "date");

ALTER TABLE "PersonWorkWindow" ADD CONSTRAINT "PersonWorkWindow_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonScheduleOverride" ADD CONSTRAINT "PersonScheduleOverride_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonOverrideWindow" ADD CONSTRAINT "PersonOverrideWindow_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "PersonScheduleOverride"("id") ON DELETE CASCADE ON UPDATE CASCADE;
