// Punch List v1.2.0 — Firebase-backed app logic. See CHANGELOG.md.
// Firestore holds projects/items/allowedUsers; Storage holds item photos.
// See README.md for the one-time Firebase project setup this depends on.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, signOut
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { firebaseConfig } from "./firebase-config.js";

const APP_VERSION = "1.2.0";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const storage = getStorage(fbApp);

const TRADES = ["Electrical","Plumbing","HVAC","Drywall & Paint","Flooring","Carpentry & Millwork",
  "Doors & Hardware","Roofing","Concrete & Masonry","Site & Landscaping","Fire & Life Safety","General / Punch"];
const STATUSES = ["Open","In Progress","Ready for Review","Closed"];
const STATUS_CLASS = {"Open":"status-Open","In Progress":"status-In-Progress","Ready for Review":"status-Ready-for-Review","Closed":"status-Closed"};
const STATUS_KEY = {"Open":"open","In Progress":"progress","Ready for Review":"review","Closed":"done"};

// Explicit JS-name -> DOM-id map (the HTML mixes camelCase and kebab-case
// ids, so this is clearer and safer than trying to derive one from the other).
var ID_MAP = {
  loginScreen:"loginScreen", pendingScreen:"pendingScreen", app:"app",
  googleSignInBtn:"googleSignInBtn", emailAuthForm:"emailAuthForm",
  authEmail:"auth-email", authPassword:"auth-password", emailAuthSubmit:"emailAuthSubmit",
  toggleAuthModeBtn:"toggleAuthModeBtn", forgotPasswordBtn:"forgotPasswordBtn",
  authError:"authError", pendingEmail:"pendingEmail", copyPendingEmailBtn:"copyPendingEmailBtn",
  pendingSignOutBtn:"pendingSignOutBtn",

  projectSelect:"projectSelect", manageProjectsBtn:"manageProjectsBtn", teamBtn:"teamBtn",
  userChip:"userChip", userChipName:"userChipName", signOutBtn:"signOutBtn", addItemBtn:"addItemBtn",
  connBanner:"connBanner", connBannerText:"connBannerText", statsRow:"statsRow",
  searchInput:"searchInput", tradeFilter:"tradeFilter", assigneeFilter:"assigneeFilter",
  floorFilter:"floorFilter", roomFilter:"roomFilter",
  viewCardsBtn:"viewCardsBtn", viewRoomsBtn:"viewRoomsBtn",
  itemGrid:"itemGrid", emptyState:"emptyState", emptyTitle:"emptyTitle", emptyBody:"emptyBody",
  emptyAddBtn:"emptyAddBtn",

  itemModal:"itemModal", itemModalTitle:"itemModalTitle", itemModalClose:"itemModalClose",
  itemForm:"itemForm", fTitle:"f-title", fTrade:"f-trade", fPriority:"f-priority",
  fRoom:"f-room", roomHint:"roomHint", fLocation:"f-location", fDue:"f-due", fAssignee:"f-assignee", fStatus:"f-status",
  photoPreviewImg:"photoPreviewImg", photoPreviewEmpty:"photoPreviewEmpty",
  photoAddLabel:"photoAddLabel", photoRemoveBtn:"photoRemoveBtn", photoInput:"photoInput",
  photoHint:"photoHint", deleteItemBtn:"deleteItemBtn", cancelItemBtn:"cancelItemBtn",
  saveItemBtn:"saveItemBtn",

  projectModal:"projectModal", projectModalClose:"projectModalClose",
  projectListWrap:"projectListWrap", npName:"np-name", npBrand:"np-brand",
  npLocation:"np-location", addProjectBtn:"addProjectBtn",

  reportBtn:"reportBtn", reportModal:"reportModal", reportModalClose:"reportModalClose",
  rpScope:"rp-scope", rpTrade:"rp-trade", rpTradeWrap:"rpTradeWrap", rpClosed:"rp-closed",
  rpPhotos:"rp-photos", rpTo:"rp-to", rpSubject:"rp-subject", rpNote:"rp-note",
  rpPreview:"rp-preview", rpSummary:"rpSummary", rpWarn:"rpWarn",
  rpCopyBtn:"rpCopyBtn", rpPrintBtn:"rpPrintBtn", rpEmailBtn:"rpEmailBtn",

  roomsModal:"roomsModal", roomsModalTitle:"roomsModalTitle", roomsModalClose:"roomsModalClose",
  roomsListWrap:"roomsListWrap", rmInput:"rm-input", addRoomsBtn:"addRoomsBtn",

  teamModal:"teamModal", teamModalClose:"teamModalClose", teamListWrap:"teamListWrap",
  ntEmail:"nt-email", ntName:"nt-name", addTeamBtn:"addTeamBtn",

  toast:"toast"
};
Array.prototype.forEach.call(document.querySelectorAll(".js-version"), function(n){ n.textContent = "Punch List v" + APP_VERSION; });
var els = {};
Object.keys(ID_MAP).forEach(function(key){ els[key] = document.getElementById(ID_MAP[key]); });

var state = {
  user: null,
  member: null, // {role, name} from allowedUsers, once resolved
  authMode: "signin", // or "signup"
  projects: [],
  items: [],
  currentProjectId: null,
  unsubItems: null,
  unsubProjects: null,
  statusFilter: "all",
  viewMode: "cards", // or "rooms"
  roomsProjectId: null,
  rpAutoTo: "",
  rpAutoSubject: "",
  report: null, // {text, groups, meta} for the open report modal
  editingItemId: null,
  photoFile: null,
  photoRemoved: false,
  existingPhoto: null // {url, path}
};

// ---------- utils ----------
function toast(msg, ms){
  els.toast.textContent = msg;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function(){ els.toast.hidden = true; }, ms || 2600);
}
function esc(s){
  return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
  });
}
function todayISO(){ return new Date().toISOString().slice(0,10); }
function fmtDate(iso){
  if(!iso) return "";
  var d = new Date(iso + "T00:00:00");
  if(isNaN(d)) return iso;
  return d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
}
function describeErr(err){
  if(!err) return "unknown error";
  var code = err.code || "";
  if(code.indexOf("permission-denied") !== -1) return "you don't have access to make this change";
  if(code === "auth/wrong-password" || code === "auth/invalid-credential") return "wrong email or password";
  if(code === "auth/email-already-in-use") return "that email already has an account — try signing in instead";
  if(code === "auth/weak-password") return "password needs to be at least 6 characters";
  if(code === "auth/user-not-found") return "no account with that email — try creating one";
  if(code === "auth/popup-closed-by-user") return "sign-in was closed before finishing";
  return err.message || code || "unknown error";
}
function slugify(s){
  return (s||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"").slice(0,40);
}

// ---------- rooms ----------
// A project's rooms are stored as a plain array of names on the project doc,
// e.g. ["101","102",...,"Lobby","Laundry"]. Guest rooms (3-4 digits, optional
// letter) are grouped by floor (first digits of the number); anything else
// is a "Common area".
var COMMON_LABEL = "Common areas";
var NO_ROOM_LABEL = "No room assigned";
var NO_ROOM_VALUE = "__none__";
function isGuestRoom(name){ return /^\d{3,4}[A-Za-z]?$/.test(String(name||"")); }
function floorNum(name){ return Math.floor(parseInt(String(name),10) / 100); }
function floorLabelOf(name){
  if(!name) return NO_ROOM_LABEL;
  return isGuestRoom(name) ? "Floor " + floorNum(name) : COMMON_LABEL;
}
function roomLabel(name){ return isGuestRoom(name) ? "Room " + name : name; }
function compareRooms(a, b){
  var ga = isGuestRoom(a), gb = isGuestRoom(b);
  if(ga && gb){
    var fa = floorNum(a), fb = floorNum(b);
    if(fa !== fb) return fa - fb;
    return String(a).localeCompare(String(b), undefined, {numeric:true});
  }
  if(ga !== gb) return ga ? -1 : 1;
  return String(a).localeCompare(String(b), undefined, {numeric:true});
}
function compareFloorLabels(a, b){
  function rank(l){ return l === NO_ROOM_LABEL ? 3 : l === COMMON_LABEL ? 2 : 1; }
  var ra = rank(a), rb = rank(b);
  if(ra !== rb) return ra - rb;
  return String(a).localeCompare(String(b), undefined, {numeric:true});
}
// "101-130, 201, Lobby" -> ["101",...,"130","201","Lobby"]
function parseRoomInput(text){
  var out = [];
  String(text||"").split(/[,\n;]+/).forEach(function(tok){
    tok = tok.trim();
    if(!tok) return;
    var m = tok.match(/^(\d+)\s*(?:-|to|–)\s*(\d+)$/i);
    if(m){
      var a = parseInt(m[1],10), b = parseInt(m[2],10);
      if(a > b){ var t = a; a = b; b = t; }
      if(b - a > 600) b = a + 600;
      for(var n = a; n <= b; n++) out.push(String(n));
    } else {
      out.push(tok);
    }
  });
  return out;
}
function currentProject(){
  return state.projects.find(function(p){ return p.id === state.currentProjectId; }) || null;
}
function roomsOf(project){
  return (project && Array.isArray(project.rooms)) ? project.rooms.slice().sort(compareRooms) : [];
}
// Rooms to offer for the current project, plus any room named on an item that is no longer in the list.
function knownRoomsForCurrent(){
  var set = {};
  roomsOf(currentProject()).forEach(function(r){ set[r] = true; });
  state.items.forEach(function(i){ if(i.room) set[i.room] = true; });
  return Object.keys(set).sort(compareRooms);
}

// ================= AUTH =================

function showScreen(name){
  els.loginScreen.hidden = name !== "login";
  els.pendingScreen.hidden = name !== "pending";
  els.app.hidden = name !== "app";
}

els.toggleAuthModeBtn.addEventListener("click", function(){
  state.authMode = state.authMode === "signin" ? "signup" : "signin";
  els.emailAuthSubmit.textContent = state.authMode === "signin" ? "Sign in" : "Create account";
  els.toggleAuthModeBtn.textContent = state.authMode === "signin" ? "Need an account? Create one" : "Have an account? Sign in";
  els.authError.hidden = true;
});

els.googleSignInBtn.addEventListener("click", async function(){
  els.authError.hidden = true;
  try{
    await signInWithPopup(auth, new GoogleAuthProvider());
  }catch(err){
    els.authError.textContent = describeErr(err);
    els.authError.hidden = false;
  }
});

els.emailAuthForm.addEventListener("submit", async function(e){
  e.preventDefault();
  els.authError.hidden = true;
  var email = els.authEmail.value.trim();
  var pw = els.authPassword.value;
  els.emailAuthSubmit.disabled = true;
  try{
    if(state.authMode === "signup"){
      await createUserWithEmailAndPassword(auth, email, pw);
    } else {
      await signInWithEmailAndPassword(auth, email, pw);
    }
  }catch(err){
    els.authError.textContent = describeErr(err);
    els.authError.hidden = false;
  }finally{
    els.emailAuthSubmit.disabled = false;
  }
});

els.forgotPasswordBtn.addEventListener("click", async function(){
  var email = els.authEmail.value.trim();
  if(!email){ toast("Enter your email above first."); return; }
  try{
    await sendPasswordResetEmail(auth, email);
    toast("Password reset email sent.");
  }catch(err){
    toast("Couldn't send reset email — " + describeErr(err));
  }
});

els.signOutBtn.addEventListener("click", function(){ signOut(auth); });
els.pendingSignOutBtn.addEventListener("click", function(){ signOut(auth); });

els.copyPendingEmailBtn.addEventListener("click", async function(){
  var email = els.pendingEmail.textContent;
  try{
    await navigator.clipboard.writeText(email);
    toast("Copied");
  }catch(e){
    toast("Select the email above to copy it manually.");
  }
});

onAuthStateChanged(auth, async function(user){
  teardownSubscriptions();
  state.user = user;
  state.member = null;
  if(!user){
    showScreen("login");
    return;
  }
  try{
    var memberSnap = await getDoc(doc(db, "allowedUsers", user.email));
    if(!memberSnap.exists()){
      els.pendingEmail.textContent = user.email;
      showScreen("pending");
      return;
    }
    state.member = memberSnap.data();
    els.userChipName.textContent = state.member.name || user.email;
    els.teamBtn.hidden = state.member.role !== "owner";
    showScreen("app");
    boot();
  }catch(err){
    console.error(err);
    showScreen("login");
    els.authError.textContent = "Couldn't check access — " + describeErr(err);
    els.authError.hidden = false;
  }
});

function teardownSubscriptions(){
  if(state.unsubItems){ state.unsubItems(); state.unsubItems = null; }
  if(state.unsubProjects){ state.unsubProjects(); state.unsubProjects = null; }
}

// ================= APP BOOT =================

var booted = false;
function boot(){
  if(booted) return;
  booted = true;
  populateStaticSelects();
  subscribeProjects();
}

function populateStaticSelects(){
  els.fTrade.innerHTML = TRADES.map(function(t){ return '<option value="'+esc(t)+'">'+esc(t)+'</option>'; }).join("");
  els.tradeFilter.innerHTML = '<option value="">All trades</option>' + TRADES.map(function(t){
    return '<option value="'+esc(t)+'">'+esc(t)+'</option>';
  }).join("");
}

// ---------- projects ----------
function subscribeProjects(){
  var q = query(collection(db, "projects"), orderBy("order", "asc"));
  state.unsubProjects = onSnapshot(q, function(snap){
    var list = [];
    snap.forEach(function(d){
      var data = d.data();
      if(!data || data.archived) return;
      list.push(Object.assign({id:d.id}, data));
    });
    state.projects = list;
    renderProjectSelect();
    renderProjectManageList();
    renderRoomFilters();
    renderRoomsModal();
    if(!state.currentProjectId && list.length){
      selectProject(list[0].id);
    } else if(state.currentProjectId && !list.some(function(p){return p.id===state.currentProjectId;}) && list.length){
      selectProject(list[0].id);
    } else if(!list.length){
      state.currentProjectId = null;
      renderItems();
    }
  }, function(err){
    console.error("projects", err);
    showBanner("Couldn't load projects — " + describeErr(err));
  });
}

function showBanner(msg){
  els.connBannerText.textContent = msg;
  els.connBanner.hidden = false;
}

function renderProjectSelect(){
  if(!state.projects.length){
    els.projectSelect.innerHTML = '<option value="">No projects yet</option>';
    return;
  }
  els.projectSelect.innerHTML = state.projects.map(function(p){
    return '<option value="'+esc(p.id)+'"'+(p.id===state.currentProjectId?" selected":"")+'>'+esc(p.name)+'</option>';
  }).join("");
}

function selectProject(id){
  state.currentProjectId = id;
  els.projectSelect.value = id;
  els.floorFilter.value = "";
  els.roomFilter.value = "";
  renderRoomFilters();
  subscribeItems();
}

function renderProjectManageList(){
  if(!state.projects.length){
    els.projectListWrap.innerHTML = '<div class="field-hint">No projects yet — add your first one below.</div>';
    return;
  }
  els.projectListWrap.innerHTML = state.projects.map(function(p){
    return '<div class="team-row">'
      + '<div class="who"><span class="name">'+esc(p.name)+'</span>'
      + '<span class="email">'+esc([p.brand,p.location].filter(Boolean).join(" · "))+'</span></div>'
      + '<div style="display:flex;gap:6px;">'
      + '<button class="btn btn-ghost" data-rooms="'+esc(p.id)+'" style="font-size:12px;padding:6px 10px;">Rooms ('+roomsOf(p).length+')</button>'
      + '<button class="btn btn-ghost" data-archive="'+esc(p.id)+'" style="font-size:12px;padding:6px 10px;">Archive</button>'
      + '</div>'
      + '</div>';
  }).join("");
  Array.prototype.forEach.call(els.projectListWrap.querySelectorAll("[data-rooms]"), function(btn){
    btn.addEventListener("click", function(){
      els.projectModal.hidden = true;
      openRoomsModal(btn.getAttribute("data-rooms"));
    });
  });
  Array.prototype.forEach.call(els.projectListWrap.querySelectorAll("[data-archive]"), function(btn){
    btn.addEventListener("click", async function(){
      var id = btn.getAttribute("data-archive");
      try{
        await updateDoc(doc(db, "projects", id), {archived:true});
      }catch(e){ toast("Couldn't archive — " + describeErr(e)); }
    });
  });
}

els.manageProjectsBtn.addEventListener("click", function(){
  renderProjectManageList();
  els.projectModal.hidden = false;
});
els.projectModalClose.addEventListener("click", function(){ els.projectModal.hidden = true; });
els.projectModal.addEventListener("click", function(e){ if(e.target === els.projectModal) els.projectModal.hidden = true; });

els.addProjectBtn.addEventListener("click", async function(){
  var name = els.npName.value.trim();
  if(!name){ els.npName.focus(); return; }
  els.addProjectBtn.disabled = true;
  try{
    await addDoc(collection(db, "projects"), {
      name: name,
      brand: els.npBrand.value.trim(),
      location: els.npLocation.value.trim(),
      order: Date.now(),
      archived: false,
      createdAt: new Date().toISOString(),
      createdBy: state.user.email
    });
    els.npName.value = ""; els.npBrand.value = ""; els.npLocation.value = "";
    toast("Project added");
  }catch(err){
    toast("Couldn't add project — " + describeErr(err));
  }finally{
    els.addProjectBtn.disabled = false;
  }
});

els.projectSelect.addEventListener("change", function(){ selectProject(els.projectSelect.value); });

// ---------- items ----------
function subscribeItems(){
  if(state.unsubItems){ state.unsubItems(); state.unsubItems = null; }
  els.itemGrid.innerHTML = "";
  if(!state.currentProjectId){ state.items = []; renderItems(); return; }
  var q = query(collection(db, "items"), where("projectId", "==", state.currentProjectId));
  state.unsubItems = onSnapshot(q, function(snap){
    var list = [];
    snap.forEach(function(d){
      var data = d.data();
      if(!data) return;
      list.push(Object.assign({id:d.id}, data));
    });
    list.sort(function(a,b){
      var order = {"Open":0,"In Progress":1,"Ready for Review":2,"Closed":3};
      var oa = order[a.status] == null ? 0 : order[a.status];
      var ob = order[b.status] == null ? 0 : order[b.status];
      if(oa !== ob) return oa - ob;
      return (b.createdAt||"").localeCompare(a.createdAt||"");
    });
    state.items = list;
    renderAssigneeFilter();
    renderRoomFilters();
    renderStats();
    renderItems();
  }, function(err){
    console.error("items", err);
    showBanner("Couldn't load items — " + describeErr(err));
  });
}

function renderAssigneeFilter(){
  var names = Array.from(new Set(state.items.map(function(i){return i.assignedTo;}).filter(Boolean))).sort();
  var cur = els.assigneeFilter.value;
  els.assigneeFilter.innerHTML = '<option value="">Everyone</option>' + names.map(function(n){
    return '<option value="'+esc(n)+'">'+esc(n)+'</option>';
  }).join("");
  if(names.indexOf(cur) !== -1) els.assigneeFilter.value = cur;
}

function renderStats(){
  var counts = {open:0,progress:0,review:0,done:0};
  state.items.forEach(function(i){
    var k = STATUS_KEY[i.status] || "open";
    counts[k] = (counts[k]||0) + 1;
  });
  var total = state.items.length;
  var defs = [
    {k:"all", label:"All items", n:total},
    {k:"open", label:"Open", n:counts.open},
    {k:"progress", label:"In progress", n:counts.progress},
    {k:"review", label:"For review", n:counts.review},
    {k:"done", label:"Closed", n:counts.done}
  ];
  els.statsRow.innerHTML = defs.map(function(d){
    return '<button class="stat-chip'+(state.statusFilter===d.k?" active":"")+'" data-k="'+d.k+'">'
      + '<span class="n">'+d.n+'</span><span>'+esc(d.label)+'</span></button>';
  }).join("");
  Array.prototype.forEach.call(els.statsRow.querySelectorAll(".stat-chip"), function(btn){
    btn.addEventListener("click", function(){
      state.statusFilter = btn.getAttribute("data-k");
      renderStats();
      renderItems();
    });
  });
}

function filteredItems(){
  var q = (els.searchInput.value||"").trim().toLowerCase();
  var trade = els.tradeFilter.value;
  var assignee = els.assigneeFilter.value;
  var floor = els.floorFilter.value;
  var room = els.roomFilter.value;
  var statusMap = {open:"Open",progress:"In Progress",review:"Ready for Review",done:"Closed"};
  return state.items.filter(function(i){
    if(state.statusFilter !== "all" && i.status !== statusMap[state.statusFilter]) return false;
    if(trade && i.trade !== trade) return false;
    if(assignee && i.assignedTo !== assignee) return false;
    if(floor && floorLabelOf(i.room) !== floor) return false;
    if(room){
      if(room === NO_ROOM_VALUE){ if(i.room) return false; }
      else if(i.room !== room) return false;
    }
    if(q){
      var hay = [i.title,i.room,i.location,i.assignedTo,i.trade].filter(Boolean).join(" ").toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  });
}

function cardHTML(i, today){
  var overdue = i.dueDate && i.dueDate < today && i.status !== "Closed";
  var thumb = i.photoURL
    ? '<img class="card-thumb" src="'+esc(i.photoURL)+'" alt="">'
    : '<div class="card-thumb-placeholder">📷</div>';
  var statusOptions = STATUSES.map(function(s){
    return '<option value="'+s+'"'+(i.status===s?" selected":"")+'>'+s+'</option>';
  }).join("");
  return '<article class="card" data-id="'+esc(i.id)+'">'
    + '<div class="card-priority" style="background:var(--p-'+ (i.priority||"Normal").toLowerCase() +')"></div>'
    + '<div class="card-body">'
    +   '<div class="card-top">'
    +     '<div class="card-title">'+esc(i.title)+'</div>'
    +     thumb
    +   '</div>'
    +   '<div class="badge-row">'
    +     (i.room ? '<span class="badge badge-room">'+esc(roomLabel(i.room))+'</span>' : '')
    +     '<span class="badge">'+esc(i.trade||"General / Punch")+'</span>'
    +     (i.priority && i.priority !== "Normal" ? '<span class="badge badge-priority-'+esc(i.priority)+'">'+esc(i.priority)+'</span>' : '')
    +   '</div>'
    +   '<div class="meta-row">'
    +     (i.location ? '<span><span class="lbl">'+(i.room?'Spot':'Where')+'</span> '+esc(i.location)+'</span>' : '')
    +     (i.assignedTo ? '<span><span class="lbl">Assigned</span> '+esc(i.assignedTo)+'</span>' : '')
    +     (i.dueDate ? '<span class="'+(overdue?"due-overdue":"")+'"><span class="lbl">Due</span> '+esc(fmtDate(i.dueDate))+'</span>' : '')
    +   '</div>'
    +   '<div class="card-footer">'
    +     '<select class="status-pill-select '+STATUS_CLASS[i.status]+'" data-quick-status="'+esc(i.id)+'">'+statusOptions+'</select>'
    +     '<span class="card-edit-hint">Tap to edit</span>'
    +   '</div>'
    + '</div>'
    + '</article>';
}

// Floor heading > room heading (with open count) > that room's cards.
function groupedHTML(list, today){
  var byFloor = {};
  list.forEach(function(i){
    var f = floorLabelOf(i.room);
    var key = i.room || "";
    byFloor[f] = byFloor[f] || {};
    (byFloor[f][key] = byFloor[f][key] || []).push(i);
  });
  return Object.keys(byFloor).sort(compareFloorLabels).map(function(f){
    var rooms = Object.keys(byFloor[f]).sort(compareRooms);
    var floorItems = rooms.reduce(function(n, r){ return n + byFloor[f][r].length; }, 0);
    var floorOpen = rooms.reduce(function(n, r){
      return n + byFloor[f][r].filter(function(i){ return i.status !== "Closed"; }).length;
    }, 0);
    return '<div class="floor-head"><span>'+esc(f)+'</span>'
      + '<span class="sub">'+floorOpen+' open · '+floorItems+' total</span></div>'
      + rooms.map(function(r){
          var items = byFloor[f][r];
          var open = items.filter(function(i){ return i.status !== "Closed"; }).length;
          // items with no room already sit under the "No room assigned" floor heading
          var head = r
            ? '<div class="room-head"><span class="room-name">'+esc(roomLabel(r))+'</span>'
              + '<span class="room-count">'+(open ? '<span class="room-open">'+open+' open</span> · ' : 'all closed · ')+items.length+' total</span></div>'
            : '';
          return head
            + '<div class="room-cards">'+items.map(function(i){ return cardHTML(i, today); }).join("")+'</div>';
        }).join("");
  }).join("");
}

// Floor + room dropdowns follow the current project's rooms.
function renderRoomFilters(){
  var rooms = knownRoomsForCurrent();
  var floors = [];
  rooms.forEach(function(r){ var f = floorLabelOf(r); if(floors.indexOf(f) === -1) floors.push(f); });
  floors.sort(compareFloorLabels);

  var curFloor = els.floorFilter.value;
  els.floorFilter.innerHTML = '<option value="">All floors</option>' + floors.map(function(f){
    return '<option value="'+esc(f)+'">'+esc(f)+'</option>';
  }).join("");
  if(floors.indexOf(curFloor) !== -1) els.floorFilter.value = curFloor;

  var selFloor = els.floorFilter.value;
  var curRoom = els.roomFilter.value;
  var shown = rooms.filter(function(r){ return !selFloor || floorLabelOf(r) === selFloor; });
  els.roomFilter.innerHTML = '<option value="">All rooms</option>'
    + (selFloor ? '' : '<option value="'+NO_ROOM_VALUE+'">'+esc(NO_ROOM_LABEL)+'</option>')
    + shown.map(function(r){ return '<option value="'+esc(r)+'">'+esc(roomLabel(r))+'</option>'; }).join("");
  var valid = shown.indexOf(curRoom) !== -1 || (!selFloor && curRoom === NO_ROOM_VALUE);
  if(valid) els.roomFilter.value = curRoom;
}

function renderItems(){
  var list = filteredItems();
  if(!state.currentProjectId){
    els.itemGrid.innerHTML = "";
    els.emptyState.hidden = false;
    els.emptyTitle.textContent = state.projects.length ? "Pick a project" : "No projects yet";
    els.emptyBody.textContent = state.projects.length ? "Choose a project above to see its punch list." : "Add your first hotel project to start a punch list.";
    els.emptyAddBtn.hidden = true;
    return;
  }
  if(!list.length){
    els.itemGrid.innerHTML = "";
    els.emptyState.hidden = false;
    var hasAny = state.items.length > 0;
    els.emptyTitle.textContent = hasAny ? "No items match" : "No items yet";
    els.emptyBody.textContent = hasAny ? "Try clearing filters or search." : "Add the first punch list item for this project.";
    els.emptyAddBtn.hidden = hasAny;
    return;
  }
  els.emptyState.hidden = true;
  var today = todayISO();
  els.itemGrid.classList.toggle("grouped", state.viewMode === "rooms");
  if(state.viewMode === "rooms"){
    els.itemGrid.innerHTML = groupedHTML(list, today);
  } else {
    els.itemGrid.innerHTML = list.map(function(i){ return cardHTML(i, today); }).join("");
  }

  Array.prototype.forEach.call(els.itemGrid.querySelectorAll(".card"), function(card){
    card.addEventListener("click", function(e){
      if(e.target.closest("[data-quick-status]")) return;
      openItemModal(card.getAttribute("data-id"));
    });
  });
  Array.prototype.forEach.call(els.itemGrid.querySelectorAll("[data-quick-status]"), function(sel){
    sel.addEventListener("click", function(e){ e.stopPropagation(); });
    sel.addEventListener("change", async function(e){
      e.stopPropagation();
      var id = sel.getAttribute("data-quick-status");
      var newStatus = sel.value;
      sel.className = "status-pill-select " + STATUS_CLASS[newStatus];
      try{
        await updateDoc(doc(db, "items", id), {status:newStatus, updatedAt:new Date().toISOString()});
      }catch(err){
        toast("Couldn't update status — " + describeErr(err));
      }
    });
  });
}

// ---------- item modal ----------
function fillRoomSelect(selected){
  var rooms = roomsOf(currentProject());
  var all = rooms.slice();
  var notInList = selected && rooms.indexOf(selected) === -1;
  var groups = {};
  rooms.forEach(function(r){ var f = floorLabelOf(r); (groups[f] = groups[f] || []).push(r); });
  var html = '<option value="">— No room —</option>';
  Object.keys(groups).sort(compareFloorLabels).forEach(function(f){
    html += '<optgroup label="'+esc(f)+'">' + groups[f].map(function(r){
      return '<option value="'+esc(r)+'">'+esc(roomLabel(r))+'</option>';
    }).join("") + '</optgroup>';
  });
  if(notInList) html += '<optgroup label="Not in room list"><option value="'+esc(selected)+'">'+esc(roomLabel(selected))+'</option></optgroup>';
  els.fRoom.innerHTML = html;
  els.fRoom.value = selected || "";
  if(!all.length){
    els.roomHint.textContent = "No rooms set up for this project yet. Add them under the + button, then Rooms.";
    els.roomHint.hidden = false;
  } else {
    els.roomHint.hidden = true;
  }
}

function openItemModal(id){
  state.editingItemId = id || null;
  state.photoFile = null;
  state.photoRemoved = false;
  state.existingPhoto = null;
  els.itemForm.reset();
  els.photoPreviewImg.hidden = true;
  els.photoPreviewEmpty.hidden = false;
  els.photoRemoveBtn.hidden = true;
  els.photoHint.textContent = "";

  if(id){
    var item = state.items.find(function(i){ return i.id === id; });
    if(!item) return;
    els.itemModalTitle.textContent = "Edit item";
    fillRoomSelect(item.room || "");
    els.fTitle.value = item.title || "";
    els.fTrade.value = item.trade || TRADES[TRADES.length-1];
    els.fPriority.value = item.priority || "Normal";
    els.fLocation.value = item.location || "";
    els.fDue.value = item.dueDate || "";
    els.fAssignee.value = item.assignedTo || "";
    els.fStatus.value = item.status || "Open";
    if(item.photoURL){
      state.existingPhoto = {url:item.photoURL, path:item.photoPath};
      els.photoPreviewImg.src = item.photoURL;
      els.photoPreviewImg.hidden = false;
      els.photoPreviewEmpty.hidden = true;
      els.photoRemoveBtn.hidden = false;
    }
    els.deleteItemBtn.hidden = false;
  } else {
    els.itemModalTitle.textContent = "New item";
    // remember the last room used / currently filtered room to speed up walking a floor
    var pre = els.roomFilter.value && els.roomFilter.value !== NO_ROOM_VALUE ? els.roomFilter.value : "";
    fillRoomSelect(pre);
    els.fStatus.value = "Open";
    els.fPriority.value = "Normal";
    els.deleteItemBtn.hidden = true;
  }
  els.itemModal.hidden = false;
}

function closeItemModal(){
  els.itemModal.hidden = true;
  state.editingItemId = null;
}

els.addItemBtn.addEventListener("click", function(){ openItemModal(null); });
els.emptyAddBtn.addEventListener("click", function(){ openItemModal(null); });
els.itemModalClose.addEventListener("click", closeItemModal);
els.cancelItemBtn.addEventListener("click", closeItemModal);
els.itemModal.addEventListener("click", function(e){ if(e.target === els.itemModal) closeItemModal(); });

els.photoInput.addEventListener("change", function(){
  var f = els.photoInput.files && els.photoInput.files[0];
  if(!f) return;
  state.photoFile = f;
  state.photoRemoved = false;
  var reader = new FileReader();
  reader.onload = function(){
    els.photoPreviewImg.src = reader.result;
    els.photoPreviewImg.hidden = false;
    els.photoPreviewEmpty.hidden = true;
    els.photoRemoveBtn.hidden = false;
  };
  reader.readAsDataURL(f);
});
els.photoRemoveBtn.addEventListener("click", function(){
  state.photoFile = null;
  state.photoRemoved = true;
  els.photoInput.value = "";
  els.photoPreviewImg.hidden = true;
  els.photoPreviewEmpty.hidden = false;
  els.photoRemoveBtn.hidden = true;
});

els.itemForm.addEventListener("submit", async function(e){
  e.preventDefault();
  if(!state.currentProjectId){ toast("Pick a project first."); return; }
  var title = els.fTitle.value.trim();
  if(!title){ els.fTitle.focus(); return; }

  els.saveItemBtn.disabled = true;
  els.saveItemBtn.textContent = "Saving…";
  try{
    var photoURL = state.existingPhoto ? state.existingPhoto.url : null;
    var photoPath = state.existingPhoto ? state.existingPhoto.path : null;

    if(state.photoFile){
      var path = "punchlist-photos/" + state.currentProjectId + "/" + Date.now() + "-" + state.photoFile.name.replace(/[^a-zA-Z0-9._-]/g,"_");
      var sref = ref(storage, path);
      await uploadBytes(sref, state.photoFile);
      photoURL = await getDownloadURL(sref);
      photoPath = path;
      // clean up the old photo once the new one is safely stored
      if(state.existingPhoto && state.existingPhoto.path){
        deleteObject(ref(storage, state.existingPhoto.path)).catch(function(){});
      }
    } else if(state.photoRemoved){
      if(state.existingPhoto && state.existingPhoto.path){
        deleteObject(ref(storage, state.existingPhoto.path)).catch(function(){});
      }
      photoURL = null;
      photoPath = null;
    }

    var now = new Date().toISOString();
    var data = {
      projectId: state.currentProjectId,
      title: title,
      trade: els.fTrade.value,
      priority: els.fPriority.value,
      room: els.fRoom.value || "",
      location: els.fLocation.value.trim(),
      dueDate: els.fDue.value || "",
      assignedTo: els.fAssignee.value.trim(),
      status: els.fStatus.value,
      photoURL: photoURL || null,
      photoPath: photoPath || null,
      updatedAt: now,
      updatedBy: state.user.email
    };
    if(state.editingItemId){
      await updateDoc(doc(db, "items", state.editingItemId), data);
      toast("Item updated");
    } else {
      data.createdAt = now;
      data.createdBy = state.user.email;
      data.reporter = state.member.name || state.user.email;
      await addDoc(collection(db, "items"), data);
      toast("Item added");
    }
    closeItemModal();
  }catch(err){
    toast("Couldn't save — " + describeErr(err));
  }finally{
    els.saveItemBtn.disabled = false;
    els.saveItemBtn.textContent = "Save item";
  }
});

els.deleteItemBtn.addEventListener("click", async function(){
  if(!state.editingItemId) return;
  var id = state.editingItemId;
  var item = state.items.find(function(i){ return i.id === id; });
  els.deleteItemBtn.disabled = true;
  try{
    await deleteDoc(doc(db, "items", id));
    if(item && item.photoPath){
      deleteObject(ref(storage, item.photoPath)).catch(function(){});
    }
    toast("Item deleted");
    closeItemModal();
  }catch(err){
    toast("Couldn't delete — " + describeErr(err));
  }finally{
    els.deleteItemBtn.disabled = false;
  }
});

els.searchInput.addEventListener("input", renderItems);
els.tradeFilter.addEventListener("change", renderItems);
els.assigneeFilter.addEventListener("change", renderItems);
els.floorFilter.addEventListener("change", function(){ renderRoomFilters(); renderItems(); });
els.roomFilter.addEventListener("change", renderItems);

function setViewMode(mode){
  state.viewMode = mode;
  els.viewCardsBtn.classList.toggle("active", mode === "cards");
  els.viewRoomsBtn.classList.toggle("active", mode === "rooms");
  try{ localStorage.setItem("punchlist-view", mode); }catch(e){}
  renderItems();
}
els.viewCardsBtn.addEventListener("click", function(){ setViewMode("cards"); });
els.viewRoomsBtn.addEventListener("click", function(){ setViewMode("rooms"); });
try{
  var savedView = localStorage.getItem("punchlist-view");
  if(savedView === "rooms" || savedView === "cards"){
    state.viewMode = savedView;
    els.viewCardsBtn.classList.toggle("active", savedView === "cards");
    els.viewRoomsBtn.classList.toggle("active", savedView === "rooms");
  }
}catch(e){}

// ---------- rooms modal ----------
function openRoomsModal(projectId){
  state.roomsProjectId = projectId;
  els.rmInput.value = "";
  renderRoomsModal();
  els.roomsModal.hidden = false;
}
function closeRoomsModal(){
  els.roomsModal.hidden = true;
  state.roomsProjectId = null;
}
function renderRoomsModal(){
  if(!state.roomsProjectId || els.roomsModal.hidden) return;
  var p = state.projects.find(function(x){ return x.id === state.roomsProjectId; });
  if(!p){ closeRoomsModal(); return; }
  els.roomsModalTitle.textContent = "Rooms — " + p.name;
  var rooms = roomsOf(p);
  if(!rooms.length){
    els.roomsListWrap.innerHTML = '<div class="field-hint" style="margin-bottom:12px;">No rooms yet. Add some below.</div>';
    return;
  }
  var groups = {};
  rooms.forEach(function(r){ var f = floorLabelOf(r); (groups[f] = groups[f] || []).push(r); });
  var html = '<div class="rooms-summary">'+rooms.length+' rooms and areas</div>';
  Object.keys(groups).sort(compareFloorLabels).forEach(function(f){
    html += '<div class="rooms-floor"><div class="rooms-floor-title">'+esc(f)+' · '+groups[f].length+'</div><div class="room-chips">'
      + groups[f].map(function(r){
          return '<span class="room-chip">'+esc(r)+'<button type="button" title="Remove" data-remove-room="'+esc(r)+'">&times;</button></span>';
        }).join("")
      + '</div></div>';
  });
  els.roomsListWrap.innerHTML = html;
  Array.prototype.forEach.call(els.roomsListWrap.querySelectorAll("[data-remove-room]"), function(btn){
    btn.addEventListener("click", async function(){
      var name = btn.getAttribute("data-remove-room");
      var inUse = state.currentProjectId === p.id && state.items.some(function(i){ return i.room === name; });
      if(inUse && !confirm(name + " has punch list items. Remove it from the list anyway? The items keep their room name.")) return;
      try{
        await updateDoc(doc(db, "projects", p.id), {rooms: roomsOf(p).filter(function(r){ return r !== name; })});
      }catch(err){ toast("Couldn't remove — " + describeErr(err)); }
    });
  });
}
els.roomsModalClose.addEventListener("click", closeRoomsModal);
els.roomsModal.addEventListener("click", function(e){ if(e.target === els.roomsModal) closeRoomsModal(); });
els.addRoomsBtn.addEventListener("click", async function(){
  var p = state.projects.find(function(x){ return x.id === state.roomsProjectId; });
  if(!p) return;
  var incoming = parseRoomInput(els.rmInput.value);
  if(!incoming.length){ els.rmInput.focus(); return; }
  var existing = roomsOf(p);
  var seen = {};
  existing.forEach(function(r){ seen[r.toLowerCase()] = true; });
  var added = 0;
  incoming.forEach(function(r){
    if(!seen[r.toLowerCase()]){ seen[r.toLowerCase()] = true; existing.push(r); added++; }
  });
  els.addRoomsBtn.disabled = true;
  try{
    await updateDoc(doc(db, "projects", p.id), {rooms: existing.sort(compareRooms)});
    els.rmInput.value = "";
    toast(added ? added + " added" : "Already in the list");
  }catch(err){
    toast("Couldn't add — " + describeErr(err));
  }finally{
    els.addRoomsBtn.disabled = false;
  }
});

// ---------- reports: email / print ----------
var MAILTO_LIMIT = 1900; // many desktop mail apps drop links longer than ~2000 characters

function todayLabel(){ return new Date().toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }

function anyScreenFilter(){
  return state.statusFilter !== "all" || els.tradeFilter.value || els.assigneeFilter.value
    || els.floorFilter.value || els.roomFilter.value || (els.searchInput.value||"").trim();
}

function reportItems(){
  var scope = els.rpScope.value;
  if(scope === "filters") return filteredItems();
  var list = state.items.slice();
  if(scope === "trade") list = list.filter(function(i){ return i.trade === els.rpTrade.value; });
  if(!els.rpClosed.checked) list = list.filter(function(i){ return i.status !== "Closed"; });
  return list;
}

function reportScopeLabel(){
  var scope = els.rpScope.value;
  var closed = els.rpClosed.checked;
  if(scope === "project") return closed ? "All items" : "All open items";
  if(scope === "trade") return els.rpTrade.value + (closed ? "" : " — open items");
  var statusNames = {open:"Open items",progress:"In progress",review:"Ready for review",done:"Closed items"};
  var parts = [];
  if(state.statusFilter !== "all") parts.push(statusNames[state.statusFilter]);
  if(els.tradeFilter.value) parts.push(els.tradeFilter.value);
  if(els.assigneeFilter.value) parts.push(els.assigneeFilter.value);
  if(els.floorFilter.value) parts.push(els.floorFilter.value);
  if(els.roomFilter.value) parts.push(els.roomFilter.value === NO_ROOM_VALUE ? NO_ROOM_LABEL : roomLabel(els.roomFilter.value));
  var q = (els.searchInput.value||"").trim();
  if(q) parts.push('matching "'+q+'"');
  return parts.length ? parts.join(" · ") : "All items";
}

// Where a remembered recipient is kept: per trade or assignee, so each sub's address is a one-time entry.
function recipientKey(){
  var scope = els.rpScope.value;
  if(scope === "trade") return "trade:" + els.rpTrade.value;
  if(scope === "filters"){
    if(els.assigneeFilter.value) return "assignee:" + els.assigneeFilter.value;
    if(els.tradeFilter.value) return "trade:" + els.tradeFilter.value;
  }
  return "";
}
function loadRecipient(){
  var k = recipientKey();
  if(!k) return "";
  try{ return localStorage.getItem("punchlist-to:" + k) || ""; }catch(e){ return ""; }
}
function saveRecipient(){
  var k = recipientKey();
  var v = els.rpTo.value.trim();
  if(!k || !v) return;
  try{ localStorage.setItem("punchlist-to:" + k, v); }catch(e){}
}

var PRIORITY_RANK = {"Critical":0,"High":1,"Normal":2,"Low":3};
var STATUS_RANK = {"Open":0,"In Progress":1,"Ready for Review":2,"Closed":3};
function groupForReport(list){
  var floors = {};
  list.forEach(function(i){
    var f = floorLabelOf(i.room), k = i.room || "";
    floors[f] = floors[f] || {};
    (floors[f][k] = floors[f][k] || []).push(i);
  });
  return Object.keys(floors).sort(compareFloorLabels).map(function(f){
    return {
      floor: f,
      rooms: Object.keys(floors[f]).sort(compareRooms).map(function(r){
        return {
          room: r,
          items: floors[f][r].slice().sort(function(a,b){
            var sa = STATUS_RANK[a.status], sb = STATUS_RANK[b.status];
            if(sa !== sb) return (sa==null?0:sa) - (sb==null?0:sb);
            var pa = PRIORITY_RANK[a.priority], pb = PRIORITY_RANK[b.priority];
            if(pa !== pb) return (pa==null?2:pa) - (pb==null?2:pb);
            return (a.dueDate||"9999").localeCompare(b.dueDate||"9999");
          })
        };
      })
    };
  });
}

function itemMetaParts(i){
  var parts = [];
  if(i.trade) parts.push(i.trade);
  if(i.priority && i.priority !== "Normal") parts.push(i.priority + " priority");
  if(i.dueDate) parts.push("Due " + fmtDate(i.dueDate));
  parts.push("Status: " + (i.status || "Open"));
  return parts;
}

function buildReportText(groups, o){
  var L = [], n = 0;
  if(o.note){ L.push(o.note, ""); }
  L.push("PUNCH LIST — " + o.projectName);
  L.push(o.scopeLabel + " · " + o.total + " item" + (o.total === 1 ? "" : "s") + " · " + o.dateStr);
  L.push("");
  groups.forEach(function(g){
    L.push("=== " + g.floor.toUpperCase() + " ===");
    g.rooms.forEach(function(r){
      if(r.room) L.push(roomLabel(r.room).toUpperCase() + " (" + r.items.length + ")");
      r.items.forEach(function(i){
        n++;
        L.push(" " + n + ". " + i.title);
        L.push("    " + itemMetaParts(i).join(" | "));
        if(i.location) L.push("    Spot: " + i.location);
        if(i.assignedTo) L.push("    Assigned: " + i.assignedTo);
        if(o.photos && i.photoURL) L.push("    Photo: " + i.photoURL);
      });
      L.push("");
    });
  });
  L.push("Thanks,");
  if(o.sender) L.push(o.sender);
  return L.join("\n");
}

function mailtoUrl(to, subject, body){
  return "mailto:" + to + "?subject=" + encodeURIComponent(subject)
    + "&body=" + encodeURIComponent(body.replace(/\n/g, "\r\n"));
}

async function copyText(text){
  try{
    await navigator.clipboard.writeText(text);
    return true;
  }catch(e){
    try{
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    }catch(e2){ return false; }
  }
}

function refreshReport(){
  var p = currentProject();
  if(!p) return;
  var scope = els.rpScope.value;
  els.rpTradeWrap.hidden = scope !== "trade";
  els.rpClosed.disabled = scope === "filters";

  var list = reportItems();
  var label = reportScopeLabel();
  var groups = groupForReport(list);
  var meta = {
    projectName: p.name, scopeLabel: label, total: list.length, dateStr: todayLabel(),
    photos: els.rpPhotos.checked, note: els.rpNote.value.trim(),
    sender: (state.member && state.member.name) || ""
  };
  var text = buildReportText(groups, meta);
  state.report = {text: text, groups: groups, meta: meta, count: list.length};

  // keep auto-filled fields in step unless the person has typed their own value
  var newSubject = "Punch list — " + p.name + " — " + label;
  if(!els.rpSubject.value || els.rpSubject.value === state.rpAutoSubject) els.rpSubject.value = newSubject;
  state.rpAutoSubject = newSubject;
  var newTo = loadRecipient();
  if(!els.rpTo.value || els.rpTo.value === state.rpAutoTo) els.rpTo.value = newTo;
  state.rpAutoTo = newTo;

  els.rpPreview.textContent = list.length ? text : "No items match this selection.";
  els.rpSummary.textContent = list.length + " item" + (list.length === 1 ? "" : "s") + " · " + label;
  var tooLong = mailtoUrl(els.rpTo.value.replace(/\s+/g,""), els.rpSubject.value, text).length > MAILTO_LIMIT;
  els.rpWarn.hidden = !(list.length && tooLong);
  if(list.length && tooLong){
    els.rpWarn.textContent = "This list is too long to fit in an email link. Open email app will copy the list for you, then just paste it into the email body (Ctrl+V).";
  }
  els.rpEmailBtn.disabled = !list.length;
  els.rpCopyBtn.disabled = !list.length;
  els.rpPrintBtn.disabled = !list.length;
}

function openReportModal(){
  if(!currentProject()){ toast("Pick a project first."); return; }
  els.rpTrade.innerHTML = TRADES.map(function(t){ return '<option value="'+esc(t)+'">'+esc(t)+'</option>'; }).join("");
  els.rpTrade.value = els.tradeFilter.value || TRADES[0];
  els.rpScope.value = anyScreenFilter() ? "filters" : "project";
  els.rpClosed.checked = false;
  els.rpNote.value = "";
  els.rpTo.value = ""; els.rpSubject.value = "";
  state.rpAutoTo = ""; state.rpAutoSubject = "";
  refreshReport();
  els.reportModal.hidden = false;
}
function closeReportModal(){ els.reportModal.hidden = true; }

els.reportBtn.addEventListener("click", openReportModal);
els.reportModalClose.addEventListener("click", closeReportModal);
els.reportModal.addEventListener("click", function(e){ if(e.target === els.reportModal) closeReportModal(); });
["change","input"].forEach(function(evt){
  [els.rpScope, els.rpTrade, els.rpClosed, els.rpPhotos, els.rpNote, els.rpTo, els.rpSubject].forEach(function(el){
    el.addEventListener(evt, refreshReport);
  });
});

els.rpCopyBtn.addEventListener("click", async function(){
  if(!state.report) return;
  toast((await copyText(state.report.text)) ? "Copied. Paste it into an email or text." : "Couldn't copy. Select the preview text instead.");
});

els.rpEmailBtn.addEventListener("click", async function(){
  if(!state.report || !state.report.count) return;
  var to = els.rpTo.value.replace(/\s+/g, "");
  var subject = els.rpSubject.value;
  var url = mailtoUrl(to, subject, state.report.text);
  if(url.length > MAILTO_LIMIT){
    var ok = await copyText(state.report.text);
    url = mailtoUrl(to, subject, "[Paste the punch list here with Ctrl+V]");
    toast(ok ? "List copied. Paste it into the email (Ctrl+V)." : "Couldn't copy the list. Use Copy text first.", 5000);
  }
  saveRecipient();
  var a = document.createElement("a");
  a.href = url;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

function buildReportHTML(r){
  var m = r.meta, n = 0;
  var body = r.groups.map(function(g){
    return '<h2>'+esc(g.floor)+'</h2>' + g.rooms.map(function(rm){
      return (rm.room ? '<h3>'+esc(roomLabel(rm.room))+' <span>('+rm.items.length+')</span></h3>' : '')
        + rm.items.map(function(i){
          n++;
          return '<div class="it"><div class="num">'+n+'</div><div class="main">'
            + '<div class="t">'+esc(i.title)+'</div>'
            + '<div class="m">'+esc(itemMetaParts(i).join(" · "))+'</div>'
            + (i.location ? '<div class="m">Spot: '+esc(i.location)+'</div>' : '')
            + (i.assignedTo ? '<div class="m">Assigned: '+esc(i.assignedTo)+'</div>' : '')
            + '</div>'
            + (m.photos && i.photoURL ? '<img src="'+esc(i.photoURL)+'" alt="">' : '')
            + '</div>';
        }).join("");
    }).join("");
  }).join("");
  return '<!doctype html><html><head><meta charset="utf-8"><title>Punch list — '+esc(m.projectName)+'</title><style>'
    + 'body{font:14px/1.45 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111;margin:28px;max-width:820px}'
    + 'h1{font-size:22px;margin:0 0 2px}.sub{color:#555;margin-bottom:14px}.note{white-space:pre-wrap;border-left:4px solid #c85a12;padding:6px 12px;margin:0 0 16px;background:#faf3ee}'
    + 'h2{font-size:15px;text-transform:uppercase;letter-spacing:.04em;border-bottom:2px solid #ccc;padding-bottom:3px;margin:22px 0 6px}'
    + 'h3{font-size:14px;margin:14px 0 4px}h3 span{color:#777;font-weight:400}'
    + '.it{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #e5e5e5;break-inside:avoid}'
    + '.num{flex:none;width:26px;font-weight:700;color:#c85a12}.main{flex:1}.t{font-weight:600}.m{color:#555;font-size:12.5px}'
    + 'img{flex:none;width:130px;height:100px;object-fit:cover;border-radius:6px;border:1px solid #ccc}'
    + '.foot{margin-top:22px;color:#777;font-size:11px}'
    + '@media print{body{margin:14mm}}'
    + '</style></head><body>'
    + '<h1>Punch list — '+esc(m.projectName)+'</h1>'
    + '<div class="sub">'+esc(m.scopeLabel)+' · '+m.total+' item'+(m.total===1?'':'s')+' · '+esc(m.dateStr)+'</div>'
    + (m.note ? '<div class="note">'+esc(m.note)+'</div>' : '')
    + body
    + '<div class="foot">Punch List v'+APP_VERSION+(m.sender ? ' · from '+esc(m.sender) : '')+'</div>'
    + '<script>window.addEventListener("load",function(){setTimeout(function(){window.print()},400)})<\/script>'
    + '</body></html>';
}

els.rpPrintBtn.addEventListener("click", function(){
  if(!state.report || !state.report.count) return;
  var w = window.open("", "_blank");
  if(!w){ toast("Your browser blocked the report window. Allow pop-ups for this site and try again."); return; }
  w.document.open();
  w.document.write(buildReportHTML(state.report));
  w.document.close();
});

// ---------- team modal (owner only) ----------
els.teamBtn.addEventListener("click", async function(){
  await renderTeamList();
  els.teamModal.hidden = false;
});
els.teamModalClose.addEventListener("click", function(){ els.teamModal.hidden = true; });
els.teamModal.addEventListener("click", function(e){ if(e.target === els.teamModal) els.teamModal.hidden = true; });

async function renderTeamList(){
  els.teamListWrap.innerHTML = '<div class="field-hint">Loading…</div>';
  try{
    var snap = await getDocs(collection(db, "allowedUsers"));
    var rows = [];
    snap.forEach(function(d){ rows.push(Object.assign({email:d.id}, d.data())); });
    if(!rows.length){
      els.teamListWrap.innerHTML = '<div class="field-hint">Nobody listed yet.</div>';
      return;
    }
    els.teamListWrap.innerHTML = rows.map(function(r){
      return '<div class="team-row">'
        + '<div class="who"><span class="name">'+esc(r.name || r.email)+'</span>'
        + '<span class="email">'+esc(r.email)+'</span></div>'
        + '<div style="display:flex;align-items:center;gap:8px;">'
        + '<span class="role-badge">'+esc(r.role||"member")+'</span>'
        + (r.email !== state.user.email ? '<button class="btn btn-ghost" data-remove="'+esc(r.email)+'" style="font-size:12px;padding:6px 10px;">Remove</button>' : '')
        + '</div></div>';
    }).join("");
    Array.prototype.forEach.call(els.teamListWrap.querySelectorAll("[data-remove]"), function(btn){
      btn.addEventListener("click", async function(){
        try{
          await deleteDoc(doc(db, "allowedUsers", btn.getAttribute("data-remove")));
          toast("Removed");
          renderTeamList();
        }catch(err){ toast("Couldn't remove — " + describeErr(err)); }
      });
    });
  }catch(err){
    els.teamListWrap.innerHTML = '<div class="field-hint">Couldn\'t load — ' + esc(describeErr(err)) + '</div>';
  }
}

els.addTeamBtn.addEventListener("click", async function(){
  var email = els.ntEmail.value.trim();
  if(!email){ els.ntEmail.focus(); return; }
  els.addTeamBtn.disabled = true;
  try{
    await setDoc(doc(db, "allowedUsers", email), {
      name: els.ntName.value.trim(),
      role: "member",
      addedAt: new Date().toISOString(),
      addedBy: state.user.email
    });
    els.ntEmail.value = ""; els.ntName.value = "";
    toast("Added");
    renderTeamList();
  }catch(err){
    toast("Couldn't add — " + describeErr(err));
  }finally{
    els.addTeamBtn.disabled = false;
  }
});
