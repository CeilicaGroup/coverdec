-- Legacy "otras tareas" rows had isPrimary=false and isFallback=false.
-- Normalize them to apoyo so UI and planning stay aligned.
UPDATE "PersonSpecialty"
SET "isFallback" = true
WHERE "isPrimary" = false AND "isFallback" = false;
