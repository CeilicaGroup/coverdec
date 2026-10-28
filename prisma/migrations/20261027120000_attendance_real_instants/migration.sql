-- Fichaje: una sola convención horaria, la de «Mis horas»: instantes reales (UTC) en BD,
-- mostrados e introducidos en Europe/Madrid.
--
-- Antes convivían dos:
--   * Botón (entrar / pausa / salir): instante real con segundos y milisegundos (new Date()). Ya correcto.
--   * Franjas manuales, del jefe, y cualquier sesión o pausa editada a mano: hora mural de Madrid
--     guardada como si fuera UTC (08:00 en Madrid → 08:00Z), siempre en minuto exacto.
--
-- Se convierten las filas del segundo tipo:
--   * source MANUAL / ADMIN_EDIT;
--   * source BUTTON cerradas con inicio y fin en minuto exacto (:00.000). Son las editadas a mano: un
--     fichaje en vivo cae en el segundo 0 y el milisegundo 0 con probabilidad 1/60000 en cada extremo.
-- `AT TIME ZONE 'Europe/Madrid'` interpreta la hora mural con el horario de verano de esa fecha.
-- Los minutos guardados (`minutes`) no cambian: los dos extremos se desplazan lo mismo.
--
-- Idempotente: al terminar marca la tabla con un COMMENT; si la marca ya existe, no vuelve a convertir.

DO $$
BEGIN
  IF obj_description('"AttendanceSession"'::regclass, 'pg_class') IS DISTINCT FROM 'tz:utc-instant' THEN

    UPDATE "AttendanceBreak"
    SET "startedAt" = ("startedAt" AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'UTC',
        "endedAt"   = ("endedAt"   AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'UTC'
    WHERE "source" <> 'BUTTON'
       OR ("endedAt" IS NOT NULL
           AND date_trunc('minute', "startedAt") = "startedAt"
           AND date_trunc('minute', "endedAt") = "endedAt");

    UPDATE "AttendanceSession"
    SET "startedAt" = ("startedAt" AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'UTC',
        "endedAt"   = ("endedAt"   AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'UTC'
    WHERE "source" <> 'BUTTON'
       OR ("endedAt" IS NOT NULL
           AND date_trunc('minute', "startedAt") = "startedAt"
           AND date_trunc('minute', "endedAt") = "endedAt");

    COMMENT ON TABLE "AttendanceSession" IS 'tz:utc-instant';
  END IF;
END $$;
