-- Enum values must be committed before use (PostgreSQL); keep DDL enums only here.
ALTER TYPE "ProjectKind" ADD VALUE 'STOCK';

CREATE TYPE "LampElementStockStatus" AS ENUM ('IN_PRODUCTION', 'AVAILABLE', 'ASSIGNED');

ALTER TYPE "TaskSystemKind" ADD VALUE 'AD_HOC';
