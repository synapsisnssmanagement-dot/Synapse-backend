// Pure service-accounting rules shared by the API, exports and tests.
// All durations are integer minutes.

export const DEFAULT_YEAR_START_MONTH = 6; // June, 1-based

// Academic year (start year) for a date, using UTC so the server, the UI and
// exports agree regardless of server timezone.
export const academicYearFor = (date, startMonth = DEFAULT_YEAR_START_MONTH) => {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d.getUTCMonth() + 1 >= startMonth ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
};
export const academicYearBounds = (startYear, startMonth = DEFAULT_YEAR_START_MONTH) => ({
  start: new Date(Date.UTC(startYear, startMonth - 1, 1)),
  end: new Date(Date.UTC(startYear + 1, startMonth - 1, 1)), // exclusive
});
export const yearLabel = (y) => `${y}–${String((y + 1) % 100).padStart(2, "0")}`;

export const toMinutes = (hours) => Math.round(Number(hours || 0) * 60);
export const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

// Summarise ledger entries for one volunteer. Legacy (imported attendance
// totals) is always reported separately from verified service.
export const summariseLedger = (entries, startMonth = DEFAULT_YEAR_START_MONTH) => {
  const s = { verifiedRegular: 0, verifiedCamp: 0, legacy: 0, communityService: 0, byYear: {}, byCategory: {}, campDays: {} };
  for (const e of entries) {
    const m = e.minutes;
    if (e.programme === "community_service") {
      s.communityService += m;
      continue;
    }
    if (e.entryType === "legacy") {
      s.legacy += m;
      continue;
    }
    const y = e.academicYear ?? academicYearFor(e.serviceDate, startMonth);
    if (e.kind === "camp") {
      s.verifiedCamp += m;
      if (e.event) {
        const k = String(e.event);
        s.campDays[k] = s.campDays[k] || {};
        const d = dayKey(e.serviceDate);
        s.campDays[k][d] = (s.campDays[k][d] || 0) + m;
      }
    } else {
      s.verifiedRegular += m;
      s.byYear[y] = (s.byYear[y] || 0) + m;
      const c = e.category || "general";
      s.byCategory[c] = (s.byCategory[c] || 0) + m;
    }
  }
  return s;
};

// Evaluate a summary against a policy's rules. Returns per-requirement
// results; "met" for the whole policy only when every requirement is met.
// Legacy minutes count only if the policy explicitly says so.
export const evaluatePolicy = (summary, rules, { legacyByYear = {} } = {}) => {
  const perYear = rules.regularMinutesPerYear || 0;
  const years = Object.keys({ ...summary.byYear, ...(rules.countLegacy ? legacyByYear : {}) })
    .map(Number)
    .sort((a, b) => a - b)
    .map((y) => ({
      year: y,
      label: yearLabel(y),
      minutes: (summary.byYear[y] || 0) + (rules.countLegacy ? legacyByYear[y] || 0 : 0),
    }));
  const qualifying = years.filter((y) => perYear > 0 && y.minutes >= perYear).map((y) => y.year);

  let yearsMet = qualifying.length >= (rules.yearsRequired || 0);
  if (yearsMet && rules.consecutiveYears && (rules.yearsRequired || 0) > 1) {
    let best = 0;
    let run = 0;
    for (let i = 0; i < qualifying.length; i++) {
      run = i > 0 && qualifying[i] === qualifying[i - 1] + 1 ? run + 1 : 1;
      best = Math.max(best, run);
    }
    yearsMet = best >= rules.yearsRequired;
  }

  const categories = (rules.categories || []).map((c) => {
    const done = summary.byCategory[c.name] || 0;
    return { name: c.name, required: c.minMinutes, done, met: done >= c.minMinutes };
  });

  const reqDays = rules.camp?.requiredDays || 0;
  const camps = Object.entries(summary.campDays).map(([event, days]) => ({
    event,
    daysAttended: Object.keys(days).length,
    met: reqDays > 0 && Object.keys(days).length >= reqDays,
  }));
  const campMet = !rules.camp?.required || camps.some((c) => c.met);

  return {
    years,
    qualifyingYears: qualifying,
    yearsRequired: rules.yearsRequired || 0,
    regularMinutesPerYear: perYear,
    consecutiveYears: Boolean(rules.consecutiveYears),
    yearsMet,
    categories,
    categoriesMet: categories.every((c) => c.met),
    camp: { required: Boolean(rules.camp?.required), requiredDays: reqDays, camps, met: campMet },
    met: yearsMet && categories.every((c) => c.met) && campMet,
  };
};

// Missing camp days: the camp's scheduled dates the volunteer has no verified credit for.
export const missingCampDays = (event, creditedDayKeys) => {
  const start = new Date(event.date);
  const end = new Date(event.endDate || event.date);
  const out = [];
  for (let d = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()); d <= end.getTime(); d += 86400000) {
    const k = new Date(d).toISOString().slice(0, 10);
    if (!creditedDayKeys.has(k)) out.push(k);
  }
  return out;
};

// Diary state machine.
const TRANSITIONS = {
  draft: ["submitted"],
  returned: ["submitted"],
  submitted: ["approved", "returned", "rejected"],
  approved: [],
  rejected: [],
};
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

// Credit key: one regular credit per volunteer per event per day; camp the same.
// External service is keyed by its diary.
export const creditKey = ({ student, event, serviceDate, diary, kind }) =>
  event ? `credit:${student}:${event}:${dayKey(serviceDate)}` : `credit:${student}:${kind}:diary:${diary}`;
