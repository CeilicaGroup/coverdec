# Despliegue (Coolify + Docker)

## Requisitos

- Coolify (o cualquier host con Docker Compose).
- Variables de entorno configuradas en el servicio **web** y **db** (o Postgres gestionado externo).

## Variables obligatorias

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | Cadena PostgreSQL (ej. `postgresql://user:pass@db:5432/coverdec?schema=public`). |
| `BETTER_AUTH_SECRET` | Secreto largo y aleatorio (producción). |
| `BETTER_AUTH_URL` | URL pública del sitio, **sin barra final** (ej. `https://coverdec.tudominio.com`). |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | Misma URL que `BETTER_AUTH_URL` para el cliente de auth en el navegador. |
| `PLANNING_SOLVER_URL` | URL del microservicio OR-Tools (ej. `http://planning-solver:8000` en Compose). |

Opcional: `LOG_LEVEL` (`info` en producción), `SOLVER_MAX_SECONDS` (límite CP-SAT, default `60` en el servicio Python).

## Desarrollo local

Ver `docker-compose.dev.yml` en la raíz del repositorio (`npm run dev:up`).

## Producción

Despliegue con la imagen Docker del `Dockerfile` (build standalone de Next.js) y Postgres/solver como servicios separados en Coolify o tu orquestador. No hay `docker-compose.yml` de producción en el repo.

## Migraciones

En el **CMD** de la imagen ya se ejecuta `prisma migrate deploy` antes de levantar Next. Para releases manuales:

```bash
npx prisma migrate deploy
```

Si Coolify u otro orquestador **sobrescribe el comando de arranque** con solo `node server.js`, las migraciones no se aplican y el dashboard fallará en producción (error genérico de Server Components). En ese caso, ejecuta `npx prisma migrate deploy` contra la base de datos del entorno o restaura el CMD del `Dockerfile`.

### Error genérico en el dashboard

Next.js oculta el detalle en producción. Busca en los logs del servicio **web** la línea con el mismo `digest` que muestra la UI. Causas habituales:

- Migraciones pendientes (columnas nuevas como `User.banned` o tablas como `AttendanceSession`).
- `DATABASE_URL` incorrecta o base de datos vacía sin seed.

## Backups

Configura en Coolify copias de seguridad del volumen de Postgres (o snapshots del servicio de base de datos). Frecuencia recomendada: diaria para producción.

## Build local de imagen

```bash
docker build -t coverdec:local .
docker run --rm -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... -e BETTER_AUTH_URL=... -e NEXT_PUBLIC_BETTER_AUTH_URL=... -p 3000:3000 coverdec:local
```

## HTTPS

`BETTER_AUTH_URL` debe coincidir con el esquema y host públicos (HTTPS en producción) para que las cookies y CORS funcionen correctamente.
