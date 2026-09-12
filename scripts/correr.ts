/**
 * Corre una campaña completa en consola. Es el atajo para verificar la
 * simulación sin levantar la interfaz.
 *
 *   npx tsx scripts/correr.ts S-001
 */

import { cargarEnvLocal } from "./cargar-env";
import { crearCorrida } from "../src/composicion";
import { evaluarMetas } from "../src/orquestacion/metricas";
import type { ResultadoCorrida } from "../src/orquestacion/corrida";

cargarEnvLocal();

const semilla = process.argv[2] ?? "S-001";
const c = crearCorrida({ semilla });

let resultado: ResultadoCorrida | null = null;
c.isquemia.iniciar((r) => (resultado = r));
c.isquemia.iniciar === undefined;

// 72 h de simulación bastan para agotar campaña y línea base.
c.reloj.correrHastaVacio(72 * 3600);

if (!resultado) {
  console.error("la corrida no terminó dentro de la ventana de simulación");
  process.exit(1);
}

const r = resultado as ResultadoCorrida;
const cent = r.desempenoCentinela;
const porEstado = new Map<string, number>();
for (const carril of c.isquemia.carriles) porEstado.set(carril.estado, (porEstado.get(carril.estado) ?? 0) + 1);

console.log(`\n═══ ISQUEMIA · semilla ${semilla} ═══\n`);
console.log(`Órgano        ${c.mundo.organo.tipo}  ·  límite CIT ${c.mundo.citLimite_h()} h`);
console.log(`Donante       ${c.mundo.donante.id} · ${c.mundo.donante.via} · ${c.mundo.donante.edad} y · ${c.mundo.donante.grupoSanguineo}`);
console.log(`Eventos       ${c.almacen.todos().length}`);

console.log(`\n── Centinela (reloj 1) ─────────────────────────`);
console.log(`Sensibilidad          ${(cent.sensibilidad * 100).toFixed(1)} %   (meta ≥ 95 %)`);
console.log(`Falsos positivos      ${(cent.tasaFalsosPositivos * 100).toFixed(1)} %   (meta ≤ 5 %)`);
console.log(`Escalamientos G7      ${cent.escalamientosCorrectos}/${cent.limitrofesTotales} limítrofes`);
console.log(`Citas válidas         ${cent.citasValidas}/${cent.criteriosReportados}`);

console.log(`\n── Colocación (reloj 2) ────────────────────────`);
console.log(`Estados de carril     ${[...porEstado].map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`Ganador               ${r.campana.ganador ? `#${r.campana.secuenciaFinal} ${c.mundo.centro(r.campana.ganador.entradaMatchRun.centroId).nombre}` : "ninguno"}`);
console.log(`Degradaciones         ${r.campana.degradaciones}/${r.campana.provisionalYesTotales} provisional yes`);
console.log(`Horas protegidas      ${r.campana.horasProtegidas.toFixed(1)} h`);
console.log(`Línea base            ${r.baseline.secuenciaFinal ? `colocó en #${r.baseline.secuenciaFinal}` : "no colocó"} tras ${r.baseline.ofertasEmitidas} ofertas, ${r.baseline.rechazosTardios} rechazos tardíos`);

if (r.transporte) {
  console.log(`\n── Transporte (reloj 3) ────────────────────────`);
  for (const o of r.transporte) {
    const marca = o.viable ? " " : "✗";
    console.log(`${marca} ${o.modalidad.padEnd(12)} ${String(o.duracionTotal_min).padStart(4)} min  CIT ${o.citProyectada_h.toFixed(1)} h  $${String(o.costoUSD).padStart(6)}  puntaje ${o.puntaje.toFixed(3)}${o.viable ? "" : `  — ${o.motivoNoViable}`}`);
  }
}

if (r.expediente) {
  console.log(`\n── Expediente AOOS ─────────────────────────────`);
  console.log(`Cobertura de citación ${(r.expediente.cobertura * 100).toFixed(0)} %`);
  console.log(`Firma                 ${r.expediente.firmaHash}`);
  console.log(`Oraciones             ${r.expediente.justificacion.length}`);
}

console.log(`\n── Las nueve métricas (§14.3) ──────────────────`);
for (const m of evaluarMetas(r.metricas)) {
  console.log(`${m.cumple ? "✓" : "✗"} ${m.metrica}  ${String(m.valor).padStart(10)}   meta ${m.meta}`);
}
console.log();
