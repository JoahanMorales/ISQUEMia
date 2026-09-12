/** Formateo compartido. Todo en inglés: §12.0. */

export function hhmmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function horas(h: number): string {
  return `${h.toFixed(1)} h`;
}

export function reloj_t(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600) % 24;
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function clase_umbral(fraccion: number): string {
  if (fraccion >= 0.9) return "u90";
  if (fraccion >= 0.75) return "u75";
  if (fraccion >= 0.5) return "u50";
  return "u0";
}

export function color_umbral(fraccion: number): string {
  if (fraccion >= 0.9) return "var(--critico)";
  if (fraccion >= 0.75) return "#c2410c";
  if (fraccion >= 0.5) return "var(--aviso)";
  return "var(--acento)";
}

export function titulo(estado: string): string {
  return estado.replace(/_/g, " ").toLowerCase();
}

export function usd(n: number): string {
  return n < 1 ? `$${n.toFixed(4)}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export function minutos(m: number): string {
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h > 0 ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
}
