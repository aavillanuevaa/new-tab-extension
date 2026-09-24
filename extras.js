// Add-on widgets: internship tracker and daily tasks.
// Always-on cards on the board.
(() => {
  const board = document.getElementById("board");
  const BOARD_KEY = "mc_board_order"; // shared with home.js

  const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const pad = (n) => String(n).padStart(2, "0");
  const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(text, cls = "mc-btn") {
    const b = el("button", cls, text);
    b.type = "button";
    return b;
  }

  // Row height = half the board, so two rows fill the window and extra cards scroll
  function setRowHeight() {
    const gap = parseFloat(getComputedStyle(board).rowGap) || 0;
    board.style.setProperty("--row-h", Math.max(220, (board.clientHeight - gap) / 2) + "px");
  }
  window.addEventListener("resize", setRowHeight);

  function applyBoardOrder() {
    load(BOARD_KEY, []).forEach((id) => {
      const n = document.getElementById(id);
      if (n && n.parentNode === board) board.appendChild(n);
    });
  }

  // ================= Internship tracker =================
  const STATUSES = ["Interested", "Applied", "Interview", "Offer", "Done", "Rejected"];

  function buildTracker(body, tools) {
    let rows = load("mc_tracker", []);
    const save = () => store("mc_tracker", rows);

    const add = button("+ Add");
    tools.prepend(add);

    const wrap = el("div", "table-wrap");
    const table = el("table", "tracker");
    const head = el("tr");
    ["Name", "Application link", "Role", "Status", "Date added", "Comment", ""].forEach((h) => head.appendChild(el("th", "", h)));
    table.appendChild(el("thead")).appendChild(head);
    const tbody = table.appendChild(el("tbody"));
    wrap.appendChild(table);
    body.appendChild(wrap);
    const empty = el("p", "list-empty", "No applications yet. Click + Add to track one.");
    body.appendChild(empty);

    function textCell(row, key, placeholder) {
      const td = el("td");
      const inp = el("input");
      inp.type = "text";
      inp.value = row[key] || "";
      inp.placeholder = placeholder;
      inp.addEventListener("input", () => { row[key] = inp.value; save(); });
      td.appendChild(inp);
      return td;
    }

    function rowEl(row) {
      const tr = el("tr");
      tr.appendChild(textCell(row, "name", "Company"));

      const linkTd = textCell(row, "link", "https://...");
      const open = el("a", "open-link", "↗");
      open.target = "_blank";
      open.rel = "noopener";
      open.title = "Open link";
      const syncLink = () => {
        const v = (row.link || "").trim();
        open.hidden = !/^https?:\/\//i.test(v);
        open.href = v;
      };
      syncLink();
      linkTd.firstChild.addEventListener("input", syncLink);
      linkTd.classList.add("link-cell");
      linkTd.appendChild(open);
      tr.appendChild(linkTd);

      tr.appendChild(textCell(row, "role", "Role"));

      const stTd = el("td");
      const sel = el("select", "status");
      STATUSES.forEach((s) => { const o = el("option", "", s); o.value = s; sel.appendChild(o); });
      sel.value = row.status || "Interested";
      const paint = () => { sel.className = "status st-" + sel.value.toLowerCase(); };
      paint();
      sel.addEventListener("change", () => { row.status = sel.value; paint(); save(); });
      stTd.appendChild(sel);
      tr.appendChild(stTd);

      const dateTd = el("td", "date-cell");
      const date = el("input");
      date.type = "date";
      date.value = row.added || "";
      const todayBtn = button("Today", "link-btn");
      const syncDate = () => { todayBtn.hidden = !!date.value; };
      date.addEventListener("change", () => { row.added = date.value; save(); syncDate(); });
      todayBtn.addEventListener("click", () => { date.value = todayKey(); row.added = date.value; save(); syncDate(); });
      syncDate();
      dateTd.append(date, todayBtn);
      tr.appendChild(dateTd);

      tr.appendChild(textCell(row, "comment", "Comment"));

      const delTd = el("td");
      const del = button("×", "icon-btn");
      del.title = "Delete row";
      del.addEventListener("click", () => {
        rows = rows.filter((r) => r.id !== row.id);
        save();
        render();
      });
      delTd.appendChild(del);
      tr.appendChild(delTd);
      return tr;
    }

    function render() {
      tbody.innerHTML = "";
      rows.forEach((r) => tbody.appendChild(rowEl(r)));
      empty.hidden = rows.length > 0;
      wrap.hidden = rows.length === 0;
    }

    add.addEventListener("click", () => {
      rows.push({ id: uid(), name: "", link: "", role: "", status: "Interested", added: todayKey(), comment: "" });
      save();
      render();
      const inputs = tbody.querySelectorAll("tr:last-child input");
      if (inputs[0]) inputs[0].focus();
      wrap.scrollTop = wrap.scrollHeight;
    });
    render();
  }

  // ================= Daily tasks (reset every day) =================
  function buildTasks(body, tools) {
    let st = load("mc_tasks", { date: todayKey(), tasks: [] });
    const save = () => store("mc_tasks", st);

    const count = el("span", "task-count");
    tools.prepend(count);

    const form = el("form", "task-add");
    const input = el("input");
    input.type = "text";
    input.placeholder = "Add a daily task...";
    form.appendChild(input);
    const list = el("div", "list");
    body.append(form, list);

    function resetIfNewDay() {
      if (st.date !== todayKey()) {
        st.date = todayKey();
        st.tasks.forEach((t) => (t.done = false));
        save();
        render();
      }
    }

    function render() {
      list.innerHTML = "";
      st.tasks.forEach((t) => {
        const row = el("label", "task" + (t.done ? " done" : ""));
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = !!t.done;
        cb.addEventListener("change", () => { t.done = cb.checked; save(); render(); });

        const txt = el("input", "task-text");
        txt.type = "text";
        txt.value = t.text;
        // stop label from toggling the checkbox while editing text
        txt.addEventListener("click", (e) => e.preventDefault());
        txt.addEventListener("change", () => {
          const v = txt.value.trim();
          if (v) { t.text = v; } else { st.tasks = st.tasks.filter((x) => x.id !== t.id); }
          save();
          render();
        });

        const del = button("×", "icon-btn");
        del.title = "Delete task";
        del.addEventListener("click", (e) => {
          e.preventDefault();
          st.tasks = st.tasks.filter((x) => x.id !== t.id);
          save();
          render();
        });
        row.append(cb, txt, del);
        list.appendChild(row);
      });
      const n = st.tasks.filter((t) => t.done).length;
      count.textContent = st.tasks.length ? `${n}/${st.tasks.length}` : "";
      if (!st.tasks.length) list.appendChild(el("p", "list-empty", "Add tasks above. They uncheck themselves every day."));
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      st.tasks.push({ id: uid(), text: v, done: false });
      input.value = "";
      save();
      render();
    });

    render();
    resetIfNewDay();
    setInterval(resetIfNewDay, 60 * 1000);
    window.addEventListener("focus", resetIfNewDay);
    document.addEventListener("visibilitychange", resetIfNewDay);
  }

  // ================= Gym split carousel =================
  const SPLIT = ["Push", "Pull", "Legs", "Upper", "Lower"];

  function buildGym(body) {
    // i = today's workout, doneOn = date it was checked off, history = dates trained
    let st = load("mc_gym2", { i: 0, doneOn: null, history: [] });
    const save = () => store("mc_gym2", st);
    body.classList.add("gym");

    const stage = el("div", "gym-stage");
    const prev = button("‹", "gym-arrow");
    const nextBtn = button("›", "gym-arrow");
    const track = el("div", "gym-track");
    stage.append(prev, track, nextBtn);

    const dots = el("div", "gym-dots");
    const check = button("", "gym-check");
    const checkLabel = el("div", "gym-check-label");
    const meta = el("div", "gym-meta");
    body.append(stage, dots, check, checkLabel, meta);

    // New day: if yesterday's (or earlier) workout was completed, move on to the next one.
    // A skipped day doesn't advance the rotation.
    function rollover() {
      if (st.doneOn && st.doneOn !== todayKey()) {
        st.i = (st.i + 1) % SPLIT.length;
        st.doneOn = null;
        save();
        render();
      }
    }

    const doneToday = () => st.doneOn === todayKey();
    const at = (n) => SPLIT[(n + SPLIT.length) % SPLIT.length];

    function render(dir) {
      track.innerHTML = "";
      [-1, 0, 1].forEach((o) => {
        const item = el("div", "gym-item" + (o === 0 ? " current" : ""), at(st.i + o));
        track.appendChild(item);
      });
      if (dir) {
        track.classList.remove("slide-l", "slide-r");
        void track.offsetWidth; // restart animation
        track.classList.add(dir > 0 ? "slide-l" : "slide-r");
      }
      dots.innerHTML = "";
      SPLIT.forEach((_, idx) => dots.appendChild(el("span", "dot" + (idx === st.i ? " on" : ""))));

      const done = doneToday();
      check.classList.toggle("on", done);
      check.textContent = "✓";
      check.setAttribute("aria-pressed", done);
      checkLabel.textContent = done ? `${SPLIT[st.i]} done today` : "Tap when you've trained";
      prev.disabled = nextBtn.disabled = done;
      meta.textContent = done ? `Tomorrow: ${at(st.i + 1)}` : `Up next after: ${at(st.i + 1)}`;
    }

    function move(d) {
      if (doneToday()) return;
      st.i = (st.i + d + SPLIT.length) % SPLIT.length;
      save();
      render(d);
    }
    prev.addEventListener("click", () => move(-1));
    nextBtn.addEventListener("click", () => move(1));

    check.addEventListener("click", () => {
      const today = todayKey();
      if (doneToday()) {
        st.doneOn = null;
        st.history = st.history.filter((h) => h !== today);
      } else {
        st.doneOn = today;
        if (!st.history.includes(today)) st.history.push(today);
        st.history = st.history.slice(-90);
      }
      save();
      render();
    });

    render();
    rollover();
    setInterval(rollover, 60 * 1000);
    window.addEventListener("focus", rollover);
    document.addEventListener("visibilitychange", rollover);
  }

  // ================= Build the cards =================
  const WIDGETS = [
    { id: "tracker", title: "Internship tracker", build: buildTracker, cls: "wide" },
    { id: "gym", title: "Gym split", build: buildGym },
  ];

  WIDGETS.forEach((w) => {
    const panel = el("section", "panel" + (w.cls ? " " + w.cls : ""));
    panel.id = "w-" + w.id;
    const head = el("div", "panel-head");
    head.draggable = true;
    head.appendChild(el("h2", "", w.title));
    const tools = el("div", "head-tools");
    head.appendChild(tools);
    const body = el("div", "widget-body");
    panel.append(head, body);
    board.appendChild(panel);
    w.build(body, tools);
  });

  // Daily tasks live in the lower half of the Notes card
  const notepad = document.getElementById("notepad");
  if (notepad) {
    const section = el("div", "tasks-section");
    const sub = el("div", "sub-head");
    sub.appendChild(el("h3", "", "Daily tasks"));
    const tools = el("div", "head-tools");
    sub.appendChild(tools);
    const body = el("div", "widget-body");
    section.append(sub, body);
    notepad.appendChild(section);
    buildTasks(body, tools);
  }

  applyBoardOrder();
  setRowHeight();
})();
