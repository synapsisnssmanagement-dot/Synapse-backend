// Session date generation for projects (pure; UTC date keys).
const key = (d) => d.toISOString().slice(0, 10);

export const sessionDates = (schedule, kind) => {
  const start = new Date(schedule.startDate);
  if (Number.isNaN(start.getTime())) return [];
  if (kind === "standalone" || (schedule.recurrence?.freq || "none") === "none") return [key(start)];
  const end = schedule.endDate ? new Date(schedule.endDate) : null;
  const max = Math.min(schedule.recurrence.count || 200, 200);
  const out = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  if (schedule.recurrence.freq === "weekly") {
    const days = schedule.recurrence.weekdays?.length ? new Set(schedule.recurrence.weekdays) : new Set([d.getUTCDay()]);
    for (let i = 0; i < 3660 && out.length < max; i++) {
      if (end && d > end) break;
      if (days.has(d.getUTCDay())) out.push(key(d));
      d.setUTCDate(d.getUTCDate() + 1);
    }
  } else if (schedule.recurrence.freq === "monthly") {
    const dom = d.getUTCDate();
    for (let m = 0; out.length < max && m < 240; m++) {
      const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, dom));
      if (x.getUTCDate() !== dom) continue; // skip months without that day
      if (end && x > end) break;
      out.push(key(x));
    }
  }
  return out;
};
