/**
 * Diferencias JSON Patch (RFC 6902) superficiales para `STATE_DELTA`.
 *
 * Enviar el estado completo cuatro veces por segundo con cuarenta carriles
 * es caro y hace que la rejilla parpadee. Este diff compara clave a clave —
 * y carril a carril dentro de `carriles` — y emite solo los `replace` de lo
 * que de verdad cambió.
 */

export interface OperacionParche {
  op: "replace" | "add" | "remove";
  path: string;
  value?: unknown;
}

function igual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffEstado(
  anterior: Record<string, unknown>,
  siguiente: Record<string, unknown>,
): OperacionParche[] {
  const ops: OperacionParche[] = [];

  for (const clave of Object.keys(siguiente)) {
    const a = anterior[clave];
    const b = siguiente[clave];
    if (igual(a, b)) continue;

    // La rejilla de carriles es lo que más cambia y lo que más pesa: se
    // difunde por índice para que solo viaje la celda que se movió.
    if (clave === "carriles" && Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      for (let i = 0; i < b.length; i++) {
        if (!igual(a[i], b[i])) ops.push({ op: "replace", path: `/carriles/${i}`, value: b[i] });
      }
      continue;
    }

    // Los eventos solo crecen por el final: se añaden, no se reemplazan.
    if (clave === "eventos" && Array.isArray(a) && Array.isArray(b) && b.length >= a.length) {
      const compartido = a.length > 0 && b.length > a.length && igual(a[0], b[b.length - a.length - (b.length - a.length)]);
      if (compartido || a.length === 0) {
        for (let i = a.length; i < b.length; i++) ops.push({ op: "add", path: "/eventos/-", value: b[i] });
        continue;
      }
    }

    ops.push({ op: "replace", path: `/${clave}`, value: b });
  }

  for (const clave of Object.keys(anterior)) {
    if (!(clave in siguiente)) ops.push({ op: "remove", path: `/${clave}` });
  }

  return ops;
}
