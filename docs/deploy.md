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

Opcional: `LOG_LEVEL` (`info` en producción).

## Compose de referencia

El repositorio incluye `docker-compose.yml` con servicios `web` (build local) y `db` (Postgres 16). En Coolify suele definirse el stack equivalente desde la UI; ajusta nombres de servicio y volúmenes según tu plantilla.

## Migraciones

En el **CMD** de la imagen ya se ejecuta `prisma migrate deploy` antes de levantar Next. Para releases manuales:

```bash
npx prisma migrate deploy
```

## Backups

Configura en Coolify copias de seguridad del volumen de Postgres (o snapshots del servicio de base de datos). Frecuencia recomendada: diaria para producción.

## Build local de imagen

```bash
docker build -t coverdec:local .
docker run --rm -e DATABASE_URL=... -e BETTER_AUTH_SECRET=... -e BETTER_AUTH_URL=... -e NEXT_PUBLIC_BETTER_AUTH_URL=... -p 3000:3000 coverdec:local
```

## HTTPS

`BETTER_AUTH_URL` debe coincidir con el esquema y host públicos (HTTPS en producción) para que las cookies y CORS funcionen correctamente.
