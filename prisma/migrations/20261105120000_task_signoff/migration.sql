-- «Yo ya he registrado y dado por terminada esta tarea» (tareas con requiredWorkers > 1, p. ej.
-- preparación de chapas): la tarea se cierra cuando firman todos los operarios de la OT.
-- CreateTable
CREATE TABLE "TaskSignoff" (
    "taskId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSignoff_pkey" PRIMARY KEY ("taskId","personId")
);

-- CreateIndex
CREATE INDEX "TaskSignoff_personId_idx" ON "TaskSignoff"("personId");

-- AddForeignKey
ALTER TABLE "TaskSignoff" ADD CONSTRAINT "TaskSignoff_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSignoff" ADD CONSTRAINT "TaskSignoff_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
