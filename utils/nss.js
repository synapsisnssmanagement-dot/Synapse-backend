// NSS programme rules and the calculations built on them.
//
// The NSS certificate needs 240 hours of service over two years (120 a year)
// plus attending one special camp. Hours here are recomputed from completed
// events (the hours each event actually ran, for students marked Present),
// so they always match the attendance record.

export const NSS_TARGET_HOURS = 240;
export const NSS_YEARLY_HOURS = 120;

// NSS follows the academic year, which in India starts in June.
export const academicYearOf = (date) => {
  const d = new Date(date);
  return d.getMonth() >= 5 ? d.getFullYear() : d.getFullYear() - 1;
};
export const academicYearLabel = (startYear) => `${startYear}–${String((startYear + 1) % 100).padStart(2, "0")}`;

// Fraction of the current academic year that has elapsed (0..1).
const elapsedOfYear = (now = new Date()) => {
  const start = new Date(academicYearOf(now), 5, 1);
  const end = new Date(start.getFullYear() + 1, 5, 1);
  return Math.min(1, Math.max(0, (now - start) / (end - start)));
};

const presentIds = (event) =>
  new Set((event.attendance || []).filter((a) => a.status === "Present" && a.student).map((a) => String(a.student._id || a.student)));

// A camp counts once the student was present on at least half its roll-call
// days; a camp with no daily roll call falls back to the event attendance.
export const attendedCamp = (event, studentId) => {
  const id = String(studentId);
  const days = event.campDays || [];
  if (!days.length) return presentIds(event).has(id);
  const attended = days.filter((d) => (d.present || []).some((p) => String(p) === id)).length;
  return attended >= Math.ceil(days.length / 2);
};

// events: the institution's Completed events (attendance, campDays, date,
// calculatedHours, type). Returns Map<studentId, summary>.
export const computeEligibility = (studentIds, events, now = new Date()) => {
  const currentYear = academicYearOf(now);
  const byStudent = new Map(
    studentIds.map((id) => [String(id), { total: 0, years: {}, camps: [], currentYear: 0 }])
  );

  for (const event of events) {
    const hours = Number(event.calculatedHours) || 0;
    const year = academicYearOf(event.date);
    const present = presentIds(event);
    for (const [id, s] of byStudent) {
      if (present.has(id) && hours > 0) {
        s.total += hours;
        s.years[year] = (s.years[year] || 0) + hours;
        if (year === currentYear) s.currentYear += hours;
      }
      if (event.type === "special_camp" && attendedCamp(event, id)) {
        s.camps.push({ id: event._id, title: event.title, date: event.date });
      }
    }
  }

  const expectedNow = NSS_YEARLY_HOURS * elapsedOfYear(now);
  for (const s of byStudent.values()) {
    s.total = Math.round(s.total * 100) / 100;
    s.currentYear = Math.round(s.currentYear * 100) / 100;
    s.campDone = s.camps.length > 0;
    s.eligible = s.total >= NSS_TARGET_HOURS && s.campDone;
    s.remainingHours = Math.max(0, Math.round((NSS_TARGET_HOURS - s.total) * 100) / 100);
    // Behind pace: under three-quarters of where they should be by now this year.
    s.behindPace = !s.eligible && s.currentYear < expectedNow * 0.75;
    s.expectedThisYear = Math.round(expectedNow);
    s.years = Object.entries(s.years)
      .map(([y, h]) => ({ year: Number(y), label: academicYearLabel(Number(y)), hours: Math.round(h * 100) / 100 }))
      .sort((a, b) => a.year - b.year);
  }
  return byStudent;
};

const sameDay = (a, b) => {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};

const words = (text = "") =>
  new Set(
    String(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2)
  );

// Ranks volunteers for an event: matching skills first, then those who most
// need hours, and pushes down anyone already on another drive that day.
export const rankVolunteers = (event, volunteers, eligibility, otherEventsSameDay) => {
  const required = (event.requiredSkills || []).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const eventWords = words(`${event.title} ${event.description}`);
  const busy = new Set();
  for (const other of otherEventsSameDay) {
    if (String(other._id) === String(event._id) || !sameDay(other.date, event.date)) continue;
    for (const p of other.participants || []) busy.add(String(p));
  }

  return volunteers
    .map((v) => {
      const talents = (v.talents || []).flatMap((t) => String(t).split(",")).map((t) => t.toLowerCase().trim()).filter(Boolean);
      const reasons = [];
      let score = 0;

      if (required.length) {
        const hits = required.filter((r) => talents.some((t) => t.includes(r) || r.includes(t)));
        score += (hits.length / required.length) * 50;
        if (hits.length) reasons.push(`Has ${hits.join(", ")}`);
      } else {
        const hits = talents.filter((t) => [...words(t)].some((w) => eventWords.has(w)));
        score += Math.min(1, hits.length / 2) * 30;
        if (hits.length) reasons.push(`Relevant: ${hits.slice(0, 2).join(", ")}`);
      }

      const e = eligibility.get(String(v._id));
      if (e) {
        const need = e.remainingHours / NSS_TARGET_HOURS;
        score += need * 30;
        if (e.behindPace) {
          score += 10;
          reasons.push("Behind on NSS hours");
        }
        if (!e.campDone && event.type === "special_camp") {
          score += 15;
          reasons.push("Needs a special camp");
        }
      }

      const clash = busy.has(String(v._id));
      if (clash) {
        score -= 40;
        reasons.push("Already on another drive that day");
      }

      return {
        _id: v._id,
        name: v.name,
        email: v.email,
        department: v.department,
        talents: v.talents,
        score: Math.max(0, Math.round(score)),
        clash,
        reasons,
        hours: e?.total ?? 0,
      };
    })
    .sort((a, b) => b.score - a.score);
};

// Great-circle distance in metres.
export const distanceMetres = (a, b) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
