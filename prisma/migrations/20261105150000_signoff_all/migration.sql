-- «Firman todos»: la tarea la dan por terminada todos los operarios de la OT (p. ej. preparación
-- de chapas). Es independiente de requiredWorkers, que fuerza al planificador a poner a varias
-- personas a la vez: así una OT de chapas con un solo operario se cierra normal.
-- Las tareas y procesos que ya tenían requiredWorkers > 1 conservan el comportamiento de firmas.
ALTER TABLE "ElementTypeProcess" ADD COLUMN "signoffAll" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Task" ADD COLUMN "signoffAll" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ElementTypeProcess" SET "signoffAll" = true WHERE "requiredWorkers" > 1;
UPDATE "Task" SET "signoffAll" = true WHERE "requiredWorkers" > 1;
