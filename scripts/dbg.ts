import { crearCorrida } from "../src/composicion";
import { construirOferta, generarGuion, semillaComportamiento } from "../src/sim/donornet";

const c = crearCorrida({ semilla: process.argv[2] ?? "S-001" });
c.isquemia.iniciar();
c.reloj.correrHastaVacio(72 * 3600);

console.log("secuencia | estado         | guion(agente@t0)      | modalidad");
for (const e of c.isquemia.carriles.slice(0, 12)) {
  const centro = c.mundo.centro(e.entradaMatchRun.centroId);
  const cand = c.mundo.candidato(e.entradaMatchRun.candidatoId);
  const of = construirOferta(c.mundo.donante, c.mundo.organo, e.entradaMatchRun.secuencia, 0, c.mundo.citProyectada_h(centro.id), 0);
  const g = generarGuion(centro, of, cand.grupoSanguineo, cand.aceptaDCD, cand.kdpiMaximoAceptado,
    semillaComportamiento(c.mundo.semilla, c.mundo.organo.id, centro.id, 0));
  console.log(
    String(e.entradaMatchRun.secuencia).padStart(9), "|",
    e.estado.padEnd(14), "|",
    `${g.decision}${g.decision === "provisional" ? (g.completara ? "/completa" : "/incompleto") : ""}`.padEnd(21), "|",
    e.modalidad,
  );
}
const verif = c.almacen.todos().filter((x) => x.tipo === "CARRIL_VERIFICACION_INICIADA");
console.log("\nverificaciones iniciadas:", verif.length, verif.map((v: any) => v.payload.carrilId).join(","));
console.log("baseline pasos:", c.isquemia.resultadoBaseline?.pasos.map((p) => `#${p.secuencia}:${p.resultado}`).join(" "));
