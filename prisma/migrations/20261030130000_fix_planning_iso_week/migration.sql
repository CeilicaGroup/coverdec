-- isoWeek() contaba desde el 4 de enero en vez de desde el 1: en los años en que el 4 de enero
-- no cae en jueves (2025, 2026…) cada semana salía con un número de menos (y la primera, S00).
-- Se renumeran los plannings guardados con la semana ISO real de su lunes (weekStart).
--
-- Dos pasos para no chocar con el índice único (naveId, year, week) a mitad del UPDATE:
-- primero se apartan los números actuales a valores <= 0, luego se escriben los buenos (>= 1).

UPDATE "Planning" SET "week" = -"week";

UPDATE "Planning"
SET "year" = EXTRACT(ISOYEAR FROM "weekStart")::int,
    "week" = EXTRACT(WEEK FROM "weekStart")::int;
