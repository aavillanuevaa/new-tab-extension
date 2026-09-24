// ---------- Greeting + clock ----------
const weekday = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const monthName = ["January","February","March","April","May","June","July","August","September","October","November","December"];
let NAME = localStorage.getItem("mc_name") || "Angelo";

function tick() {
  const now = new Date();
  const h = now.getHours();
  const greet = h < 12 ? "Good Morning" : h < 18 ? "Good Afternoon" : "Good Evening";
  document.getElementById("greeting").textContent = `${greet}, ${NAME}`;
  document.getElementById("subtitle").textContent =
    `${weekday[now.getDay()]}, ${monthName[now.getMonth()]} ${now.getDate()}`;
  const hr = (h % 12 || 12).toString().padStart(2, "0");
  const mi = now.getMinutes().toString().padStart(2, "0");
  const se = now.getSeconds().toString().padStart(2, "0");
  document.getElementById("clock").textContent = `${hr}:${mi}:${se}`;
}
tick();
setInterval(tick, 1000);

// ---------- Notepad (same "note" key as the classic page) ----------
const area = document.getElementById("area");
const saveState = document.getElementById("saveState");
const saved = localStorage.getItem("note");
area.value = saved === null || saved === "No note saved" ? "" : saved;

let saveTimer;
function saveNote() {
  localStorage.setItem("note", area.value);
  saveState.textContent = "Saved";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => (saveState.textContent = ""), 1500);
}
area.addEventListener("input", () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNote, 500); // autosave shortly after typing stops
});
document.getElementById("save").addEventListener("click", saveNote);
document.getElementById("clear").addEventListener("click", () => {
  area.value = "";
  saveNote();
});

// ---------- Bookmarks ----------
const grid = document.getElementById("grid");
const empty = document.getElementById("empty");
const folderSelect = document.getElementById("folderSelect");
const editToggle = document.getElementById("editToggle");
const editHint = document.getElementById("editHint");

const hasBookmarks = typeof chrome !== "undefined" && chrome.bookmarks;
const FOLDER_KEY = "mc_folder";
const ORDER_KEY = "mc_order";

let editing = false;
let dragId = null;

function getOrder() {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY)) || {}; } catch { return {}; }
}
function saveOrder(folderId, ids) {
  const all = getOrder();
  all[folderId] = ids;
  localStorage.setItem(ORDER_KEY, JSON.stringify(all));
}

function faviconUrl(pageUrl) {
  return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
}

function currentFolder() {
  return localStorage.getItem(FOLDER_KEY) || "1"; // "1" = Bookmarks bar
}

// Fill the folder dropdown from the whole bookmark tree
async function loadFolders() {
  const tree = await chrome.bookmarks.getTree();
  const folders = [];
  (function walk(nodes, depth) {
    for (const n of nodes) {
      if (!n.url) {
        if (n.id !== "0") folders.push({ id: n.id, title: n.title || "(untitled)", depth });
        if (n.children) walk(n.children, n.id === "0" ? depth : depth + 1);
      }
    }
  })(tree, 0);

  const cur = currentFolder();
  folderSelect.innerHTML = "";
  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = "  ".repeat(f.depth) + f.title;
    if (f.id === cur) opt.selected = true;
    folderSelect.appendChild(opt);
  }
}

async function render() {
  if (!hasBookmarks) {
    empty.hidden = false;
    empty.textContent = "Bookmarks are only available when loaded as a Chrome extension.";
    return;
  }
  const folderId = currentFolder();
  let children;
  try {
    children = await chrome.bookmarks.getChildren(folderId);
  } catch {
    localStorage.removeItem(FOLDER_KEY); // folder was deleted; fall back
    if (folderId !== "1") return render();
    children = [];
  }
  const items = children.filter((b) => b.url);

  // Apply saved order; new bookmarks go to the end, removed ones drop out
  const order = getOrder()[folderId] || [];
  const byId = new Map(items.map((b) => [b.id, b]));
  const sorted = order.filter((id) => byId.has(id)).map((id) => byId.get(id));
  for (const b of items) if (!order.includes(b.id)) sorted.push(b);

  grid.innerHTML = "";
  for (const b of sorted) grid.appendChild(makeTile(b));
  empty.hidden = sorted.length > 0;
}

function makeTile(b) {
  const a = document.createElement("a");
  a.className = "tile";
  a.href = b.url;
  a.dataset.id = b.id;
  a.title = b.title || b.url;
  a.draggable = editing;

  const img = document.createElement("img");
  img.src = faviconUrl(b.url);
  img.alt = "";
  const label = document.createElement("span");
  label.textContent = b.title || new URL(b.url).hostname;
  a.append(img, label);
  return a;
}

// Drag & drop reorder (only active in edit mode)
grid.addEventListener("click", (e) => {
  if (editing && e.target.closest(".tile")) e.preventDefault();
});
grid.addEventListener("dragstart", (e) => {
  const t = e.target.closest(".tile");
  if (!editing || !t) return;
  dragId = t.dataset.id;
  t.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragId);
});
grid.addEventListener("dragover", (e) => {
  if (!editing || !dragId) return;
  e.preventDefault();
  grid.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
  const t = e.target.closest(".tile");
  if (t && t.dataset.id !== dragId) t.classList.add("over");
});
grid.addEventListener("drop", (e) => {
  if (!editing || !dragId) return;
  e.preventDefault();
  const dragged = grid.querySelector(`.tile[data-id="${dragId}"]`);
  const target = e.target.closest(".tile");
  if (dragged && target && target !== dragged) {
    const tiles = [...grid.children];
    // dropping onto a later tile goes after it, onto an earlier tile goes before
    if (tiles.indexOf(dragged) < tiles.indexOf(target)) target.after(dragged);
    else target.before(dragged);
  } else if (dragged && !target) {
    grid.appendChild(dragged);
  }
  saveOrder(currentFolder(), [...grid.children].map((t) => t.dataset.id));
});
grid.addEventListener("dragend", () => {
  dragId = null;
  grid.querySelectorAll(".dragging, .over").forEach((x) => x.classList.remove("dragging", "over"));
});

editToggle.addEventListener("click", () => {
  editing = !editing;
  document.body.classList.toggle("editing", editing);
  editToggle.classList.toggle("active", editing);
  editToggle.textContent = editing ? "Done" : "Edit";
  editHint.hidden = !editing;
  grid.querySelectorAll(".tile").forEach((t) => (t.draggable = editing));
});

folderSelect.addEventListener("change", () => {
  localStorage.setItem(FOLDER_KEY, folderSelect.value);
  render();
});

// Live updates whenever bookmarks change in Chrome
if (hasBookmarks) {
  let pending;
  const refresh = () => {
    clearTimeout(pending);
    pending = setTimeout(() => { loadFolders(); render(); }, 100);
  };
  ["onCreated", "onRemoved", "onChanged", "onMoved", "onChildrenReordered", "onImportEnded"]
    .forEach((ev) => chrome.bookmarks[ev] && chrome.bookmarks[ev].addListener(refresh));
  loadFolders();
}
render();

// ---------- Background image ----------
const BG_KEY = "mc_bg";
const bgFile = document.getElementById("bgFile");
const bgReset = document.getElementById("bgReset");

function applyBg() {
  const data = localStorage.getItem(BG_KEY);
  document.body.classList.toggle("has-bg", !!data);
  document.body.style.backgroundImage = data ? `url("${data}")` : "";
  bgReset.hidden = !data;
}

// Downscale before storing so it fits in localStorage
function shrinkImage(file, maxW = 1920) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

document.getElementById("bgChange").addEventListener("click", () => bgFile.click());
bgFile.addEventListener("change", async () => {
  const file = bgFile.files[0];
  if (!file) return;
  try {
    localStorage.setItem(BG_KEY, await shrinkImage(file));
    applyBg();
  } catch {
    alert("Couldn't use that image. Try a smaller one.");
  }
  bgFile.value = "";
});
bgReset.addEventListener("click", () => {
  localStorage.removeItem(BG_KEY);
  applyBg();
});
applyBg();

// ---------- Settings menu ----------
const settingsBtn = document.getElementById("settingsBtn");
const settingsMenu = document.getElementById("settingsMenu");
const nameInput = document.getElementById("nameInput");

function setMenu(open) {
  settingsMenu.hidden = !open;
  settingsBtn.setAttribute("aria-expanded", open);
  settingsBtn.classList.toggle("active", open);
}
settingsBtn.addEventListener("click", () => setMenu(settingsMenu.hidden));
document.addEventListener("click", (e) => {
  if (!e.target.closest("#settings")) setMenu(false);
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

nameInput.value = NAME;
nameInput.addEventListener("input", () => {
  NAME = nameInput.value.trim() || "Angelo";
  localStorage.setItem("mc_name", NAME);
  tick();
});

// ---------- Rearrange cards (drag by the card header) ----------
const board = document.getElementById("board");
const BOARD_KEY = "mc_board_order";
let dragCard = null;

try {
  const saved = JSON.parse(localStorage.getItem(BOARD_KEY) || "[]");
  saved.forEach((id) => { const el = document.getElementById(id); if (el && el.parentNode === board) board.appendChild(el); });
} catch {}

board.querySelectorAll(".panel-head").forEach((h) => (h.draggable = true));

board.addEventListener("dragstart", (e) => {
  const head = e.target.closest && e.target.closest(".panel-head");
  if (!head) return;
  dragCard = head.closest(".panel");
  dragCard.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragCard.id);
  e.dataTransfer.setDragImage(dragCard, 20, 20);
});
board.addEventListener("dragover", (e) => {
  if (!dragCard) return;
  e.preventDefault();
  board.querySelectorAll(".over").forEach((x) => x.classList.remove("over"));
  const t = e.target.closest("#board > .panel");
  if (t && t !== dragCard) t.classList.add("over");
});
board.addEventListener("drop", (e) => {
  if (!dragCard) return;
  e.preventDefault();
  const t = e.target.closest("#board > .panel");
  if (t && t !== dragCard) {
    const cards = [...board.children];
    if (cards.indexOf(dragCard) < cards.indexOf(t)) t.after(dragCard); else t.before(dragCard);
    localStorage.setItem(BOARD_KEY, JSON.stringify([...board.children].map((c) => c.id)));
  }
});
board.addEventListener("dragend", () => {
  dragCard = null;
  board.querySelectorAll(".dragging, .over").forEach((x) => x.classList.remove("dragging", "over"));
});

// ---------- Outline glint follows the cursor inside a card ----------
document.addEventListener("pointermove", (e) => {
  const p = e.target.closest && e.target.closest(".panel");
  if (!p) return;
  const r = p.getBoundingClientRect();
  p.style.setProperty("--mx", e.clientX - r.left + "px");
  p.style.setProperty("--my", e.clientY - r.top + "px");
});
