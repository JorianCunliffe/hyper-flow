/** Convert an explicit wall time without relying on the browser's own timezone. */
export function calendarWallTime(at: string, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(at))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function calendarInstant(local: string, timezone: string) {
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(local))
    throw new Error("Choose a date and time");
  const baseline = Date.parse(local + "Z");
  if (
    !Number.isFinite(baseline) ||
    new Date(baseline).toISOString().slice(0, 16) !== local
  )
    throw new Error("Choose a valid calendar date and time");
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 6) {
    const sample = baseline + hour * 3600000;
    offsets.add(
      Date.parse(
        calendarWallTime(new Date(sample).toISOString(), timezone) + "Z",
      ) - sample,
    );
  }
  const matches = [...offsets]
    .map((offset) => new Date(baseline - offset).toISOString())
    .filter((at) => calendarWallTime(at, timezone) === local);
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? "This daylight-saving hour occurs twice. Use an explicit-offset timestamp through the API or choose another time."
        : "This local time does not exist because the clocks change. Choose another time.",
    );
  return matches[0];
}
