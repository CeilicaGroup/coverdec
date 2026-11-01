-- Las tareas de una OT las hace un solo operario en orden de workOrderSequence. Ese orden era por
-- id de proyecto (arbitrario), así que un proyecto urgente podía quedar detrás de otros con entrega
-- más tardía en cada proceso y acumular semanas de retraso.
-- Se reordenan las OT abiertas igual que compareTasksForWorkOrderSequence: entrega más urgente
-- primero (sin fecha, al final) y después proyecto, lámpara, cadena y orden del proceso.
-- Idempotente: recalcula la secuencia completa de cada OT.

WITH ordered AS (
  SELECT
    t.id,
    ROW_NUMBER() OVER (
      PARTITION BY t."workOrderId"
      ORDER BY
        p."deliveryDate" ASC NULLS LAST,
        t."projectId",
        t."lampId",
        COALESCE(t."lampElementId", t."lampId"),
        t."order",
        t.id
    ) - 1 AS seq
  FROM "Task" t
  JOIN "Project" p ON p.id = t."projectId"
  JOIN "WorkOrder" wo ON wo.id = t."workOrderId"
  WHERE wo.status = 'OPEN'
)
UPDATE "Task" t
SET "workOrderSequence" = ordered.seq
FROM ordered
WHERE t.id = ordered.id;
