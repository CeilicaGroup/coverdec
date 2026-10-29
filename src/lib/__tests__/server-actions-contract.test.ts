import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Contrato de errores: en producción Next tapa cualquier excepción de una server
 * action («No se pudo refrescar la pantalla…»). Por eso toda función exportada de
 * un fichero "use server" debe pasar por runServerAction (o runServerQuery si es una
 * lectura) y devolver ActionResult, para que el usuario vea el motivo real.
 */
const SRC = path.resolve(__dirname, "../..");

function serverActionFiles(): string[] {
  return (fs.readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !f.includes("__tests__") && !f.includes("generated"))
    .map((f) => path.join(SRC, f))
    .filter((f) => /^\s*["']use server["']/.test(fs.readFileSync(f, "utf8")));
}

describe("server actions", { timeout: 30_000 }, () => {
  it("todas devuelven ActionResult vía runServerAction o runServerQuery (nunca lanzan al cliente)", () => {
    const files = serverActionFiles();
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      // Cada trozo empieza en una función exportada y acaba en la siguiente.
      const parts = source.split(/^export async function /m).slice(1);
      for (const part of parts) {
        const name = part.match(/^\w+/)?.[0] ?? "?";
        const body = part.split(/^export /m)[0]!;
        if (!body.includes("runServerAction(") && !body.includes("runServerQuery(")) {
          offenders.push(`${path.relative(SRC, file)}: ${name}`);
        }
      }
      if (/^export (const|let|function) /m.test(source)) {
        offenders.push(`${path.relative(SRC, file)}: export no async-function (no se puede comprobar)`);
      }
    }
    expect(offenders, "acciones que lanzan errores al cliente").toEqual([]);
  });
});
