// Punch List — Firebase-backed app logic.
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
  itemGrid:"itemGrid", emptyState:"emptyState", emptyTitle:"emptyTitle", emptyBody:"emptyBody",
  emptyAddBtn:"emptyAddBtn",

  itemModal:"itemModal", itemModalTitle:"itemModalTitle", itemModalClose:"itemModalClose",
  itemForm:"itemForm", fTitle:"f-title", fTrade:"f-trade", fPriority:"f-priority",
  fLocation:"f-location", fDue:"f-due", fAssignee:"f-assignee", fStatus:"f-status",
  photoPreviewImg:"photoPreviewImg", photoPreviewEmpty:"photoPreviewEmpty",
  photoAddLabel:"photoAddLabel", photoRemoveBtn:"photoRemoveBtn", photoInput:"photoInput",
  photoHint:"photoHint", deleteItemBtn:"deleteItemBtn", cancelItemBtn:"cancelItemBtn",
  saveItemBtn:"saveItemBtn",

  projectModal:"projectModal", projectModalClose:"projectModalClose",
  projectListWrap:"projectListWrap", npName:"np-name", npBrand:"np-brand",
  npLocation:"np-location", addProjectBtn:"addProjectBtn",

  teamModal:"teamModal", teamModalClose:"teamModalClose", teamListWrap:"teamListWrap",
  ntEmail:"nt-email", ntName:"nt-name", addTeamBtn:"addTeamBtn",

  toast:"toast"
};
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
      + '<button class="btn btn-ghost" data-archive="'+esc(p.id)+'" style="font-size:12px;padding:6px 10px;">Archive</button>'
      + '</div>';
  }).join("");
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
  var statusMap = {open:"Open",progress:"In Progress",review:"Ready for Review",done:"Closed"};
  return state.items.filter(function(i){
    if(state.statusFilter !== "all" && i.status !== statusMap[state.statusFilter]) return false;
    if(trade && i.trade !== trade) return false;
    if(assignee && i.assignedTo !== assignee) return false;
    if(q){
      var hay = [i.title,i.location,i.assignedTo,i.trade].filter(Boolean).join(" ").toLowerCase();
      if(hay.indexOf(q) === -1) return false;
    }
    return true;
  });
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
  els.itemGrid.innerHTML = list.map(function(i){
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
      +     '<span class="badge">'+esc(i.trade||"General / Punch")+'</span>'
      +     (i.priority && i.priority !== "Normal" ? '<span class="badge badge-priority-'+esc(i.priority)+'">'+esc(i.priority)+'</span>' : '')
      +   '</div>'
      +   '<div class="meta-row">'
      +     (i.location ? '<span><span class="lbl">Where</span> '+esc(i.location)+'</span>' : '')
      +     (i.assignedTo ? '<span><span class="lbl">Assigned</span> '+esc(i.assignedTo)+'</span>' : '')
      +     (i.dueDate ? '<span class="'+(overdue?"due-overdue":"")+'"><span class="lbl">Due</span> '+esc(fmtDate(i.dueDate))+'</span>' : '')
      +   '</div>'
      +   '<div class="card-footer">'
      +     '<select class="status-pill-select '+STATUS_CLASS[i.status]+'" data-quick-status="'+esc(i.id)+'">'+statusOptions+'</select>'
      +     '<span class="card-edit-hint">Tap to edit</span>'
      +   '</div>'
      + '</div>'
      + '</article>';
  }).join("");

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
