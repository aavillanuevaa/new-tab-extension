// Google Calendar (secret iCal feed) + Canvas to-do widgets

const ICAL_KEY = "mc_ical";
const CANVAS_HOST = "https://webcourses.ucf.edu";
const WINDOW_DAYS = 7;
const CANVAS_DAYS = 14;
const REFRESH_MS = 10 * 60 * 1000;

const DAY_MS = 86400000;

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}
const fmtTime = (d) => d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - t) / DAY_MS);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// ================= iCal parsing =================
function parseICS(text) {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const [name, ...ps] = line.slice(0, i).split(";");
    const params = {};
    ps.forEach((p) => { const [k, v] = p.split("="); params[k.toUpperCase()] = v; });
    const entry = { val: line.slice(i + 1), params };
    const key = name.toUpperCase();
    if (key === "EXDATE") cur.exdates.push(entry); else cur[key] = entry;
  }
  return events;
}

function parseDT({ val, params }) {
  if (params.VALUE === "DATE" || /^\d{8}$/.test(val)) {
    return { allDay: true, y: +val.slice(0, 4), mo: +val.slice(4, 6), d: +val.slice(6, 8), h: 0, mi: 0 };
  }
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)(Z?)$/.exec(val);
  if (!m) return null;
  return {
    y: +m[1], mo: +m[2], d: +m[3], h: +m[4], mi: +m[5],
    tz: m[7] ? "UTC" : params.TZID, allDay: false,
  };
}

function tzOffset(ts, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ts));
  const p = {};
  parts.forEach((x) => (p[x.type] = +x.value));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ts;
}

// wall-clock components in a named timezone -> real Date
function toInstant(c, y = c.y, mo = c.mo, d = c.d) {
  if (c.allDay) return new Date(y, mo - 1, d);
  if (c.tz === "UTC") return new Date(Date.UTC(y, mo - 1, d, c.h, c.mi));
  if (!c.tz) return new Date(y, mo - 1, d, c.h, c.mi);
  try {
    const guess = Date.UTC(y, mo - 1, d, c.h, c.mi);
    const first = guess - tzOffset(guess, c.tz);
    return new Date(guess - tzOffset(first, c.tz));
  } catch {
    return new Date(y, mo - 1, d, c.h, c.mi); // unknown tz name: use local
  }
}

const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

function parseRule(str) {
  const r = {};
  str.split(";").forEach((kv) => { const [k, v] = kv.split("="); r[k] = v; });
  return {
    freq: r.FREQ, interval: +r.INTERVAL || 1, count: r.COUNT ? +r.COUNT : 0,
    until: r.UNTIL ? parseDT({ val: r.UNTIL, params: {} }) : null,
    byday: r.BYDAY ? r.BYDAY.split(",").map((x) => {
      const m = /^([+-]?\d+)?([A-Z]{2})$/.exec(x);
      return { n: m && m[1] ? +m[1] : 0, wd: m ? WD[m[2]] : 0 };
    }) : null,
    bymonthday: r.BYMONTHDAY ? r.BYMONTHDAY.split(",").map(Number) : null,
  };
}

function expand(ev, winStart, winEnd, skipByUid) {
  const dt = parseDT(ev.DTSTART);
  if (!dt) return [];
  const start0 = toInstant(dt);
  const endDt = ev.DTEND ? parseDT(ev.DTEND) : null;
  const dur = endDt ? toInstant(endDt) - start0 : dt.allDay ? DAY_MS : 0;
  const make = (start) => ({
    start, end: new Date(start.getTime() + dur), allDay: dt.allDay,
    title: (ev.SUMMARY && ev.SUMMARY.val.replace(/\\,/g, ",").replace(/\\n/g, " ")) || "(No title)",
    location: ev.LOCATION ? ev.LOCATION.val.replace(/\\,/g, ",") : "",
  });
  const inWin = (s) => s.getTime() + dur >= winStart && s < winEnd;

  if (!ev.RRULE) return inWin(start0) ? [make(start0)] : [];

  const rule = parseRule(ev.RRULE.val);
  const skip = new Set(skipByUid.get(ev.UID && ev.UID.val) || []);
  ev.exdates.forEach((x) => x.val.split(",").forEach((v) => {
    const c = parseDT({ val: v, params: x.params });
    if (c) skip.add(toInstant(c).getTime());
  }));
  const untilMs = rule.until ? toInstant(rule.until).getTime() : Infinity;
  const base = Date.UTC(dt.y, dt.mo - 1, dt.d);
  const weekStart = (t) => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS;
  const out = [];
  let n = 0;

  for (let t = base; t <= winEnd.getTime() + DAY_MS; t += DAY_MS) {
    const c = new Date(t);
    const y = c.getUTCFullYear(), mo = c.getUTCMonth() + 1, d = c.getUTCDate(), wd = c.getUTCDay();
    let match = false;
    if (rule.freq === "DAILY") {
      match = ((t - base) / DAY_MS) % rule.interval === 0;
    } else if (rule.freq === "WEEKLY") {
      const days = rule.byday ? rule.byday.map((b) => b.wd) : [new Date(base).getUTCDay()];
      const weeks = Math.round((weekStart(t) - weekStart(base)) / (7 * DAY_MS));
      match = days.includes(wd) && weeks % rule.interval === 0;
    } else if (rule.freq === "MONTHLY") {
      const months = (y - dt.y) * 12 + (mo - dt.mo);
      if (months % rule.interval === 0) {
        const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        if (rule.bymonthday) match = rule.bymonthday.some((x) => (x > 0 ? x === d : dim + x + 1 === d));
        else if (rule.byday) match = rule.byday.some((b) => b.wd === wd && (!b.n ||
          (b.n > 0 ? Math.ceil(d / 7) === b.n : Math.ceil((dim - d + 1) / 7) === -b.n)));
        else match = d === dt.d;
      }
    } else if (rule.freq === "YEARLY") {
      match = mo === dt.mo && d === dt.d && (y - dt.y) % rule.interval === 0;
    }
    if (!match) continue;

    const start = toInstant(dt, y, mo, d);
    if (start.getTime() > untilMs) break;
    n++;
    if (rule.count && n > rule.count) break;
    if (skip.has(start.getTime())) continue;
    if (inWin(start)) out.push(make(start));
  }
  return out;
}

function upcomingFromICS(text) {
  const raw = parseICS(text);
  // Edited single occurrences replace the matching slot of their series
  const skipByUid = new Map();
  raw.forEach((ev) => {
    if (ev["RECURRENCE-ID"] && ev.UID) {
      const c = parseDT(ev["RECURRENCE-ID"]);
      if (c) {
        const list = skipByUid.get(ev.UID.val) || [];
        list.push(toInstant(c).getTime());
        skipByUid.set(ev.UID.val, list);
      }
    }
  });
  const now = new Date();
  const winEnd = new Date(now.getTime() + WINDOW_DAYS * DAY_MS);
  const out = [];
  raw.forEach((ev) => {
    if (ev.STATUS && ev.STATUS.val === "CANCELLED") return;
    if (!ev.DTSTART) return;
    out.push(...expand(ev, now.getTime(), winEnd, skipByUid));
  });
  return out.sort((a, b) => a.start - b.start);
}

// ================= Events widget =================
const eventsBody = document.getElementById("eventsBody");
const icalInput = document.getElementById("icalInput");
icalInput.value = localStorage.getItem(ICAL_KEY) || "";

function renderEvents(events) {
  if (!events.length) { eventsBody.innerHTML = `<p class="list-empty">Nothing coming up in the next ${WINDOW_DAYS} days.</p>`; return; }
  let html = "", last = "";
  for (const e of events.slice(0, 30)) {
    const label = dayLabel(e.start);
    if (label !== last) { html += `<div class="day-label">${esc(label)}</div>`; last = label; }
    const time = e.allDay ? "All day" : fmtTime(e.start);
    html += `<div class="item"><span class="t">${esc(e.title)}${e.location ? `<span class="sub">${esc(e.location)}</span>` : ""}</span><span class="m">${time}</span></div>`;
  }
  eventsBody.innerHTML = html;
}

function eventsError(msg) {
  eventsBody.innerHTML = `<p class="list-empty">Couldn't load the calendar: ${esc(msg)}</p>`;
}

async function loadEvents() {
  let url = (localStorage.getItem(ICAL_KEY) || "").trim().replace(/^webcal:/i, "https:");
  if (!url) {
    eventsBody.innerHTML = `<p class="list-empty">Add your Google Calendar secret iCal link in Settings (gear icon) to see events here.</p>`;
    return;
  }
  if (!/^https:\/\/calendar\.google\.com\/calendar\/ical\/.+\.ics/i.test(url)) {
    eventsError("that doesn't look like an iCal link. It should start with https://calendar.google.com/calendar/ical/ and end with .ics");
    return;
  }
  eventsBody.innerHTML = `<p class="list-empty">Loading...</p>`;
  try {
    const res = await fetch(url, { credentials: "omit" });
    if (!res.ok) throw new Error(`Google returned ${res.status}. The link may have been reset or is the wrong one.`);
    const text = await res.text();
    if (!text.includes("BEGIN:VCALENDAR")) throw new Error("the link didn't return calendar data.");
    renderEvents(upcomingFromICS(text));
  } catch (err) {
    const m = String(err.message || err);
    eventsError(/Failed to fetch/i.test(m)
      ? "request blocked. Reload the extension in chrome://extensions and accept the new permissions."
      : m);
    console.error("Calendar error", err);
  }
}

let icalTimer;
function saveIcal() {
  clearTimeout(icalTimer);
  icalTimer = setTimeout(() => {
    localStorage.setItem(ICAL_KEY, icalInput.value.trim());
    loadEvents();
  }, 300);
}
icalInput.addEventListener("input", saveIcal);
icalInput.addEventListener("change", saveIcal);

// ================= Canvas widget =================
const canvasBody = document.getElementById("canvasBody");

function canvasLoginPrompt() {
  canvasBody.innerHTML = `<p class="list-empty">Couldn't reach Canvas. <a href="${CANVAS_HOST}/" target="_blank" rel="noopener">Log in to Webcourses</a>, then open a new tab.</p>`;
}

async function loadCanvas() {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + CANVAS_DAYS * DAY_MS).toISOString();
  const api = `${CANVAS_HOST}/api/v1/planner/items?start_date=${encodeURIComponent(from)}&end_date=${encodeURIComponent(to)}&per_page=100`;
  let items;
  try {
    const res = await fetch(api, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(res.status);
    items = JSON.parse((await res.text()).replace(/^while\(1\);/, ""));
    if (!Array.isArray(items)) throw new Error("unexpected response");
  } catch (err) {
    console.error("Canvas error", err);
    canvasLoginPrompt();
    return;
  }

  const now = Date.now();
  const todo = items
    .filter((it) => {
      if (it.plannable_type === "announcement") return false;
      const done = (it.planner_override && it.planner_override.marked_complete) ||
        (it.submissions && (it.submissions.submitted || it.submissions.excused));
      return !done;
    })
    .map((it) => {
      const p = it.plannable || {};
      const due = new Date(p.due_at || p.todo_date || it.plannable_date);
      return { title: p.title || p.name || "(Untitled)", course: it.context_name || "", due, url: it.html_url ? CANVAS_HOST + it.html_url : CANVAS_HOST, overdue: due.getTime() < now };
    })
    .filter((x) => !isNaN(x.due) && !x.overdue && x.due.getTime() <= now + CANVAS_DAYS * DAY_MS)
    .sort((a, b) => a.due - b.due);

  if (!todo.length) { canvasBody.innerHTML = `<p class="list-empty">You're all caught up.</p>`; return; }
  canvasBody.innerHTML = todo.slice(0, 30).map((x) => {
    const when = x.overdue ? "Overdue" : `${dayLabel(x.due)} ${fmtTime(x.due)}`;
    return `<a class="item${x.overdue ? " overdue" : ""}" href="${esc(x.url)}" target="_blank" rel="noopener">
      <span class="t">${esc(x.title)}<span class="sub">${esc(x.course)}</span></span><span class="m">${esc(when)}</span></a>`;
  }).join("");
}

loadEvents();
loadCanvas();
setInterval(() => { loadEvents(); loadCanvas(); }, REFRESH_MS);
