/** Local calendar date, independent of ICU locale data and locale formatting. */
export function localDay(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Data e hora locais sem fuso (2026-10-09T14:30:00), o formato de todos os registros do Agent Control. */
export function localIso(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${localDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
