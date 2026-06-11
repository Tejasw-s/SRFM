// ===== FRONT-END STATE =====
const state = {
  user: null,
  godowns: [],
  entries: [],
  activePage: 'dashboard',
  theme: 'light'
};

// ===== TOAST UTILITY =====
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.innerText = message;
  toast.className = `toast show ${type}`;
  setTimeout(() => {
    toast.className = 'toast';
  }, 3000);
}

// ===== AUTHENTICATION =====
async function doLogin() {
  const emailInput = document.getElementById('login-email').value;
  const passInput = document.getElementById('login-pass').value;
  const errDiv = document.getElementById('login-err');
  const spinner = document.getElementById('login-spinner');
  const btnText = document.getElementById('login-btn-text');

  if (!emailInput || !passInput) {
    errDiv.innerText = 'Please fill out email/username and password.';
    errDiv.style.display = 'block';
    return;
  }

  errDiv.style.display = 'none';
  spinner.style.display = 'inline-block';
  btnText.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: emailInput, password: passInput })
    });

    const data = await res.json();
    if (data.success) {
      state.user = data.user;
      sessionStorage.setItem('auditUser', JSON.stringify(data.user));
      
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      
      document.getElementById('topbar-user').innerText = state.user.email;
      document.getElementById('acc-email').innerText = state.user.email;
      
      showToast('Login successful!', 'success');
      
      // Load user database resources
      await loadAppData();
      showPage('dashboard');
    } else {
      errDiv.innerText = data.message || ('Invalid credentials.');
      errDiv.style.display = 'block';
    }
  } catch (err) {
    console.error('Login request failed', err);
    errDiv.innerText = 'Could not connect to the server.';
    errDiv.style.display = 'block';
  } finally {
    spinner.style.display = 'none';
    btnText.style.display = 'inline-block';
  }
}

function doLogout() {
  state.user = null;
  state.godowns = [];
  state.entries = [];
  sessionStorage.removeItem('auditUser');
  document.getElementById('app').style.display = 'none';
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('login-email').value = '';
  document.getElementById('login-pass').value = '';
  document.getElementById('login-err').style.display = 'none';
  showToast('Logged out.', 'info');
}

async function changePassword() {
  const newPass = document.getElementById('new-pass').value;
  if (!newPass || newPass.length < 4) {
    showToast('Password must be at least 4 characters.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, newPassword: newPass })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Password updated successfully!', 'success');
      document.getElementById('new-pass').value = '';
    } else {
      showToast(data.message || 'Error', 'error');
    }
  } catch (err) {
    console.error('Change pass error', err);
    showToast('Failed to change password.', 'error');
  }
}

// ===== STATE SYNCHRONIZATION =====
async function loadAppData() {
  if (!state.user) return;
  
  try {
    // 1. Fetch godowns
    const gRes = await fetch(`/api/godowns?userId=${state.user.id}`);
    state.godowns = await gRes.json();

    // 2. Fetch entries
    const eRes = await fetch(`/api/entries?userId=${state.user.id}`);
    state.entries = await eRes.json();

    // 3. Populate settings readonly view
    document.getElementById('sett-host').value = 'gateway01.ap-southeast-1.prod.alicloud.tidbcloud.com';
    document.getElementById('sett-user').value = '4E6XwBiHdpn7Khe.root';
    document.getElementById('sett-db').value = 'test';

    // Populate dropdown selectors
    populateDropdowns();
    renderOpStockForm();
  } catch (err) {
    console.error('Error fetching data from API', err);
    showToast('Unable to load data.', 'error');
  }
}

function populateDropdowns() {
  const dropFields = ['f-godown', 'fi-gd', 'ri-gd', 'e-gd'];
  
  dropFields.forEach(fieldId => {
    const select = document.getElementById(fieldId);
    if (!select) return;
    
    // Clear and build options
    select.innerHTML = '';
    
    if (fieldId === 'fi-gd') {
      const allOpt = document.createElement('option');
      allOpt.value = '';
      allOpt.innerText = 'All Godowns';
      select.appendChild(allOpt);
    }
    
    state.godowns.forEach(g => {
      const opt = document.createElement('option');
      opt.value = g.id;
      opt.innerText = g.name;
      select.appendChild(opt);
    });
  });
}

// ===== AUTO-CALCULATION SYSTEM =====
// Retrieves the closest entry chronologically before entryDate for godownId.
// If none exists, falls back to the opening stock of the godown.
function getPrevClosing(godownId, beforeDateStr, excludeId = null) {
  // Sort entries chronologically: latest first
  const priorEntries = state.entries
    .filter(e => e.godownId === godownId && e.date <= beforeDateStr && e.id !== excludeId)
    .sort((a, b) => {
      if (a.date !== b.date) {
        return a.date > b.date ? -1 : 1;
      }
      // If dates are identical, use insertion order (usually we can't tell, but we can do a secondary check on ID or creation order if needed, but date is fine for business logic)
      return a.id > b.id ? -1 : 1;
    });

  if (priorEntries.length > 0) {
    return {
      bags: parseFloat(priorEntries[0].closBags) || 0,
      qty: parseFloat(priorEntries[0].closQty) || 0
    };
  }

  const gdObj = state.godowns.find(g => g.id === godownId);
  if (gdObj && gdObj.opDate) {
    const opDateStr = gdObj.opDate.substring(0, 10);
    // If we are asking for balance BEFORE the opening date, return 0.
    if (beforeDateStr < opDateStr) return { bags: 0, qty: 0 };
  }

  return {
    bags: gdObj ? parseFloat(gdObj.opBags) || 0 : 0,
    qty: gdObj ? parseFloat(gdObj.opQty) || 0 : 0
  };
}

// Calculate the closing stock for the form
function autoCalcClosing() {
  const dateVal = document.getElementById('f-date').value;
  const godownId = document.getElementById('f-godown').value;
  
  if (!dateVal || !godownId) return;

  const issB = parseFloat(document.getElementById('f-iss-b').value) || 0;
  const issQ = parseFloat(document.getElementById('f-iss-q').value) || 0;
  const recvB = parseFloat(document.getElementById('f-recv-b').value) || 0;
  const recvQ = parseFloat(document.getElementById('f-recv-q').value) || 0;

  const prev = getPrevClosing(godownId, dateVal);

  const closB = prev.bags + recvB - issB;
  const closQ = prev.qty + recvQ - issQ;

  document.getElementById('f-clos-b').value = Math.max(0, closB);
  document.getElementById('f-clos-q').value = Math.max(0, closQ).toFixed(3);
}

function refreshAutoCalc() {
  autoCalcClosing();
}

// Calculate the closing stock for the edit modal
function editAutoCalc() {
  const dateVal = document.getElementById('e-dt').value;
  const godownId = document.getElementById('e-gd').value;
  const excludeId = document.getElementById('e-id').value;

  if (!dateVal || !godownId) return;

  const issB = parseFloat(document.getElementById('e-ib').value) || 0;
  const issQ = parseFloat(document.getElementById('e-iq').value) || 0;
  const recvB = parseFloat(document.getElementById('e-rb').value) || 0;
  const recvQ = parseFloat(document.getElementById('e-rq').value) || 0;

  const prev = getPrevClosing(godownId, dateVal, excludeId);

  const closB = prev.bags + recvB - issB;
  const closQ = prev.qty + recvQ - issQ;

  document.getElementById('e-cb').value = Math.max(0, closB);
  document.getElementById('e-cq').value = Math.max(0, closQ).toFixed(3);
}

// ===== PAGE ROUTING / TABS =====
function showPage(pageId) {
  state.activePage = pageId;
  
  // Update UI sections
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.querySelectorAll('.bnav-btn').forEach(b => b.classList.remove('active'));
  
  const pageElement = document.getElementById(`page-${pageId}`);
  if (pageElement) pageElement.classList.add('active');

  // Activate menu items
  const sbItem = document.getElementById(`sb-${pageId}`);
  if (sbItem) sbItem.classList.add('active');

  const bnMap = {
    'dashboard': 'bn-dash',
    'entry': 'bn-entry',
    'records': 'bn-records',
    'report': 'bn-report',
    'godowns': 'bn-godowns'
  };
  const bnBtn = document.getElementById(bnMap[pageId]);
  if (bnBtn) bnBtn.classList.add('active');

  // Initialize specific tab logic
  if (pageId === 'dashboard') {
    renderDashboard();
  } else if (pageId === 'entry') {
    // Default entry date to today
    if (!document.getElementById('f-date').value) {
      document.getElementById('f-date').value = new Date().toISOString().split('T')[0];
    }
    autoCalcClosing();
  } else if (pageId === 'records') {
    renderRecords();
  } else if (pageId === 'report') {
    // Default dates to current month range
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    document.getElementById('ri-fr').value = `${y}-${m}-01`;
    document.getElementById('ri-to').value = new Date().toISOString().split('T')[0];
    renderReport();
  } else if (pageId === 'godowns') {
    renderGodownsList();
  }
}

// ===== DASHBOARD RENDERING =====
function renderDashboard() {
  const fr = document.getElementById('dash-fr') ? document.getElementById('dash-fr').value : '';
  const to = document.getElementById('dash-to') ? document.getElementById('dash-to').value : '';
  
  let dFr = fr || '0000-01-01';
  let dTo = to || '9999-12-31';

  // Get date before from date
  let dayBeforeFr = '0000-01-01';
  if (fr) {
    const dObj = new Date(fr);
    dObj.setDate(dObj.getDate() - 1);
    dayBeforeFr = dObj.toISOString().split('T')[0];
  } else {
    // If no from date is provided, we want the opening stock of the godown as it originally was.
    // getPrevClosing with 0000-01-01 will return 0 if the godown has an opDate.
    // So we need to handle this below.
  }

  // Filter entries for the date range
  const dashEntries = state.entries.filter(e => e.date >= dFr && e.date <= dTo);

  // Aggregate stats
  let totalIssB = 0;
  let totalIssQ = 0;
  let totalRecvB = 0;
  let totalRecvQ = 0;

  dashEntries.forEach(e => {
    totalIssB += parseFloat(e.issBags) || 0;
    totalIssQ += parseFloat(e.issQty) || 0;
    totalRecvB += parseFloat(e.recvBags) || 0;
    totalRecvQ += parseFloat(e.recvQty) || 0;
  });

  // Render godown-wise table
  const tbody = document.getElementById('dash-gd-tbody');
  tbody.innerHTML = '';
  
  let currentClosB = 0;
  let currentClosQ = 0;
  
  state.godowns.forEach(g => {
    // Op. Bags for the table
    let opBags = parseFloat(g.opBags) || 0;
    let opQty = parseFloat(g.opQty) || 0;
    
    if (fr) {
      const prev = getPrevClosing(g.id, dayBeforeFr);
      opBags = prev.bags;
      opQty = prev.qty;
    }

    // Filter entries for this godown in range
    const gEntries = dashEntries.filter(e => e.godownId === g.id);
    
    let issB = 0, issQ = 0, recvB = 0, recvQ = 0;
    gEntries.forEach(e => {
      issB += parseFloat(e.issBags) || 0;
      issQ += parseFloat(e.issQty) || 0;
      recvB += parseFloat(e.recvBags) || 0;
      recvQ += parseFloat(e.recvQty) || 0;
    });

    const cb = opBags + recvB - issB;
    const cq = opQty + recvQ - issQ;

    currentClosB += cb;
    currentClosQ += cq;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="font-weight: 600; color: var(--text)">${g.name}</td>
      <td class="num">${opBags.toLocaleString('en-IN')}</td>
      <td class="num">${opQty.toFixed(3)}</td>
      <td class="num" style="color: var(--saffron)">${issB.toLocaleString('en-IN')}</td>
      <td class="num" style="color: var(--saffron)">${issQ.toFixed(3)}</td>
      <td class="num" style="color: var(--green)">${recvB.toLocaleString('en-IN')}</td>
      <td class="num" style="color: var(--green)">${recvQ.toFixed(3)}</td>
      <td class="num" style="font-weight: 700; color: var(--primary)">${cb.toLocaleString('en-IN')}</td>
      <td class="num" style="font-weight: 700; color: var(--primary)">${cq.toFixed(3)}</td>
    `;
    tbody.appendChild(tr);
  });

  // Write values to cards
  document.getElementById('mv-iss-b').innerText = totalIssB.toLocaleString('en-IN');
  document.getElementById('mv-iss-q').innerText = totalIssQ.toFixed(3);
  document.getElementById('mv-recv-b').innerText = totalRecvB.toLocaleString('en-IN');
  document.getElementById('mv-recv-q').innerText = totalRecvQ.toFixed(3);
  document.getElementById('mv-clos-b').innerText = currentClosB.toLocaleString('en-IN');
  document.getElementById('mv-clos-q').innerText = currentClosQ.toFixed(3);


  // Recent 10 entries
  const recentTbody = document.getElementById('recent-tbody');
  const recentEmpty = document.getElementById('recent-empty');
  recentTbody.innerHTML = '';
  
  // Sort entries descending
  const sorted = [...state.entries].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 10);
  
  if (sorted.length === 0) {
    recentEmpty.style.display = 'block';
    recentEmpty.innerText = 'No records match search parameters.';
  } else {
    recentEmpty.style.display = 'none';
    sorted.forEach(e => {
      const g = state.godowns.find(gd => gd.id === e.godownId);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issQty).toFixed(3)}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvQty).toFixed(3)}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closBags).toLocaleString('en-IN')}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closQty).toFixed(3)}</td>
      `;
      recentTbody.appendChild(tr);
    });
  }

  // Pre-fill printable metadata
  document.getElementById('print-date-d').innerText = `${'Printed Date'}: ${new Date().toLocaleString()}`;
}

// ===== RECORD MANAGEMENT & FILTERING =====
function renderRecords() {
  const fiGd = document.getElementById('fi-gd').value;
  const fiFr = document.getElementById('fi-fr').value;
  const fiTo = document.getElementById('fi-to').value;
  const fiDy = document.getElementById('fi-dy').value;
  const fiPt = document.getElementById('fi-pt').value.toLowerCase().trim();

  let filtered = [...state.entries];

  // Apply filters
  if (fiGd) filtered = filtered.filter(e => e.godownId === fiGd);
  if (fiFr) filtered = filtered.filter(e => e.date >= fiFr);
  if (fiTo) filtered = filtered.filter(e => e.date <= fiTo);
  
  if (fiDy !== '') {
    const dayIndex = parseInt(fiDy);
    filtered = filtered.filter(e => {
      const d = new Date(e.date + 'T00:00:00');
      return d.getDay() === dayIndex;
    });
  }
  
  if (fiPt) {
    filtered = filtered.filter(e => (e.particulers || '').toLowerCase().includes(fiPt));
  }

  // Sort descending
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('rec-tbody');
  const empty = document.getElementById('rec-empty');
  tbody.innerHTML = '';

  let totalIssB = 0, totalIssQ = 0, totalRecvB = 0, totalRecvQ = 0;

  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.innerText = 'No records match search parameters.';
    
    // Clear footer totals
    document.getElementById('tf-ib').innerText = '0';
    document.getElementById('tf-iq').innerText = '0.000';
    document.getElementById('tf-rb').innerText = '0';
    document.getElementById('tf-rq').innerText = '0.000';
    document.getElementById('tf-cb').innerText = '0';
    document.getElementById('tf-cq').innerText = '0.000';
  } else {
    empty.style.display = 'none';
    filtered.forEach(e => {
      const g = state.godowns.find(gd => gd.id === e.godownId);
      const dObj = new Date(e.date + 'T00:00:00');
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dObj.getDay()];

      totalIssB += parseFloat(e.issBags) || 0;
      totalIssQ += parseFloat(e.issQty) || 0;
      totalRecvB += parseFloat(e.recvBags) || 0;
      totalRecvQ += parseFloat(e.recvQty) || 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td style="font-size: 13px; color: var(--text-muted)">${dayName}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issQty).toFixed(3)}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvQty).toFixed(3)}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closBags).toLocaleString('en-IN')}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closQty).toFixed(3)}</td>
        <td class="no-print">
          <div class="row-actions">
            <button class="action-btn" onclick="openEditModal('${e.id}')" title="Edit">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
            </button>
            <button class="action-btn del" onclick="deleteEntry('${e.id}')" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // Update footer totals
    document.getElementById('tf-ib').innerText = totalIssB.toLocaleString('en-IN');
    document.getElementById('tf-iq').innerText = totalIssQ.toFixed(3);
    document.getElementById('tf-rb').innerText = totalRecvB.toLocaleString('en-IN');
    document.getElementById('tf-rq').innerText = totalRecvQ.toFixed(3);
    
    // For closing stock in footer, show final current closing stock of matching godowns
    let finalClosB = 0;
    let finalClosQ = 0;
    
    if (fiGd) {
      const fs = getPrevClosing(fiGd, '9999-12-31');
      finalClosB = fs.bags;
      finalClosQ = fs.qty;
    } else {
      // Sum closing stock of all godowns
      state.godowns.forEach(g => {
        const fs = getPrevClosing(g.id, '9999-12-31');
        finalClosB += fs.bags;
        finalClosQ += fs.qty;
      });
    }
    document.getElementById('tf-cb').innerText = finalClosB.toLocaleString('en-IN');
    document.getElementById('tf-cq').innerText = finalClosQ.toFixed(3);
  }
}

function clearFilters() {
  document.getElementById('fi-gd').value = '';
  document.getElementById('fi-fr').value = '';
  document.getElementById('fi-to').value = '';
  document.getElementById('fi-dy').value = '';
  document.getElementById('fi-pt').value = '';
  renderRecords();
}

// ===== SAVE / CREATE ENTRY =====
async function saveEntry() {
  const godownId = document.getElementById('f-godown').value;
  const dateVal = document.getElementById('f-date').value;
  const partVal = document.getElementById('f-part').value.trim();
  const issB = parseFloat(document.getElementById('f-iss-b').value) || 0;
  const issQ = parseFloat(document.getElementById('f-iss-q').value) || 0;
  const recvB = parseFloat(document.getElementById('f-recv-b').value) || 0;
  const recvQ = parseFloat(document.getElementById('f-recv-q').value) || 0;
  const closB = parseFloat(document.getElementById('f-clos-b').value) || 0;
  const closQ = parseFloat(document.getElementById('f-clos-q').value) || 0;
  const remVal = document.getElementById('f-rem').value.trim();

  if (!godownId) {
    showToast('Please create a godown first.', 'error');
    return;
  }
  if (!dateVal) {
    showToast('Please choose a date.', 'error');
    return;
  }

  const payload = {
    userId: state.user.id,
    godownId,
    date: dateVal,
    particulers: partVal,
    issBags: issB,
    issQty: issQ,
    recvBags: recvB,
    recvQty: recvQ,
    closBags: closB,
    closQty: closQ,
    remarks: remVal
  };

  try {
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Entry saved successfully!', 'success');
      clearForm();
      await loadAppData(); // Reload state
    } else {
      showToast(data.error || 'API Error', 'error');
    }
  } catch (err) {
    console.error('Save entry API error', err);
    showToast('Failed to save entry to database.', 'error');
  }
}

function clearForm() {
  document.getElementById('f-part').value = '';
  document.getElementById('f-iss-b').value = '';
  document.getElementById('f-iss-q').value = '';
  document.getElementById('f-recv-b').value = '';
  document.getElementById('f-recv-q').value = '';
  document.getElementById('f-rem').value = '';
  autoCalcClosing();
}

// ===== EDIT MODAL LOGIC =====
function openEditModal(entryId) {
  const entry = state.entries.find(e => e.id === entryId);
  if (!entry) return;

  document.getElementById('e-id').value = entry.id;
  document.getElementById('e-dt').value = entry.date;
  document.getElementById('e-gd').value = entry.godownId;
  document.getElementById('e-pt').value = entry.particulers;
  document.getElementById('e-ib').value = entry.issBags;
  document.getElementById('e-iq').value = entry.issQty;
  document.getElementById('e-rb').value = entry.recvBags;
  document.getElementById('e-rq').value = entry.recvQty;
  document.getElementById('e-cb').value = entry.closBags;
  document.getElementById('e-cq').value = entry.closQty;
  document.getElementById('e-rm').value = entry.remarks;

  document.getElementById('edit-modal').classList.add('open');
}

function closeModal() {
  document.getElementById('edit-modal').classList.remove('open');
}

async function saveEdit() {
  const id = document.getElementById('e-id').value;
  const godownId = document.getElementById('e-gd').value;
  const dateVal = document.getElementById('e-dt').value;
  const partVal = document.getElementById('e-pt').value.trim();
  const issB = parseFloat(document.getElementById('e-ib').value) || 0;
  const issQ = parseFloat(document.getElementById('e-iq').value) || 0;
  const recvB = parseFloat(document.getElementById('e-rb').value) || 0;
  const recvQ = parseFloat(document.getElementById('e-rq').value) || 0;
  const closB = parseFloat(document.getElementById('e-cb').value) || 0;
  const closQ = parseFloat(document.getElementById('e-cq').value) || 0;
  const remVal = document.getElementById('e-rm').value.trim();

  const payload = {
    godownId,
    date: dateVal,
    particulers: partVal,
    issBags: issB,
    issQty: issQ,
    recvBags: recvB,
    recvQty: recvQ,
    closBags: closB,
    closQty: closQ,
    remarks: remVal
  };

  try {
    const res = await fetch(`/api/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Entry updated successfully!', 'success');
      closeModal();
      await loadAppData();
      renderRecords();
    } else {
      showToast(data.error || 'Error updating', 'error');
    }
  } catch (err) {
    console.error('Update entry error', err);
    showToast('Failed to update entry.', 'error');
  }
}

async function deleteEntry(entryId) {
  const msg = 'Are you sure you want to delete this entry?';
  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/entries/${entryId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Entry deleted.', 'success');
      await loadAppData();
      renderRecords();
    } else {
      showToast(data.error || 'Error deleting', 'error');
    }
  } catch (err) {
    console.error('Delete entry error', err);
    showToast('Failed to delete entry.', 'error');
  }
}

// ===== REPORT GENERATION =====
function renderReport() {
  const riGd = document.getElementById('ri-gd').value;
  const riFr = document.getElementById('ri-fr').value;
  const riTo = document.getElementById('ri-to').value;

  if (!riGd) {
    document.getElementById('rep-empty').style.display = 'block';
    document.getElementById('rep-empty').innerText = 'No godowns found. Please add a godown first.';
    return;
  }

  // Filter entries for selected godown in date range
  let filtered = state.entries.filter(e => e.godownId === riGd);
  if (riFr) filtered = filtered.filter(e => e.date >= riFr);
  if (riTo) filtered = filtered.filter(e => e.date <= riTo);

  // Sort chronologically ascending for ledger ledger flow
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  const tbody = document.getElementById('rep-tbody');
  const empty = document.getElementById('rep-empty');
  tbody.innerHTML = '';

  let totIssB = 0, totIssQ = 0, totRecvB = 0, totRecvQ = 0;

  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.innerText = 'No records match search parameters.';
    
    // Reset report metrics
    document.getElementById('rmv-ib').innerText = '0';
    document.getElementById('rmv-iq').innerText = '0.000';
    document.getElementById('rmv-rb').innerText = '0';
    document.getElementById('rmv-rq').innerText = '0.000';
    document.getElementById('rmv-cb').innerText = '0';
    document.getElementById('rmv-cq').innerText = '0.000';
    
    // Reset footer
    document.getElementById('rptf-ib').innerText = '0';
    document.getElementById('rptf-iq').innerText = '0.000';
    document.getElementById('rptf-rb').innerText = '0';
    document.getElementById('rptf-rq').innerText = '0.000';
    document.getElementById('rptf-cb').innerText = '0';
    document.getElementById('rptf-cq').innerText = '0.000';
  } else {
    empty.style.display = 'none';

    filtered.forEach(e => {
      const g = state.godowns.find(gd => gd.id === e.godownId);
      totIssB += parseFloat(e.issBags) || 0;
      totIssQ += parseFloat(e.issQty) || 0;
      totRecvB += parseFloat(e.recvBags) || 0;
      totRecvQ += parseFloat(e.recvQty) || 0;

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--saffron)">${parseFloat(e.issQty).toFixed(3)}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvBags).toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--green)">${parseFloat(e.recvQty).toFixed(3)}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closBags).toLocaleString('en-IN')}</td>
        <td class="num" style="font-weight: 600">${parseFloat(e.closQty).toFixed(3)}</td>
      `;
      tbody.appendChild(tr);
    });

    const lastEntry = filtered[filtered.length - 1];
    const finalB = lastEntry.closBags;
    const finalQ = lastEntry.closQty;

    // Set metrics
    document.getElementById('rmv-ib').innerText = totIssB.toLocaleString('en-IN');
    document.getElementById('rmv-iq').innerText = totIssQ.toFixed(3);
    document.getElementById('rmv-rb').innerText = totRecvB.toLocaleString('en-IN');
    document.getElementById('rmv-rq').innerText = totRecvQ.toFixed(3);
    document.getElementById('rmv-cb').innerText = finalB.toLocaleString('en-IN');
    document.getElementById('rmv-cq').innerText = finalQ.toFixed(3);

    // Set footer
    document.getElementById('rptf-ib').innerText = totIssB.toLocaleString('en-IN');
    document.getElementById('rptf-iq').innerText = totIssQ.toFixed(3);
    document.getElementById('rptf-rb').innerText = totRecvB.toLocaleString('en-IN');
    document.getElementById('rptf-rq').innerText = totRecvQ.toFixed(3);
    document.getElementById('rptf-cb').innerText = finalB.toLocaleString('en-IN');
    document.getElementById('rptf-cq').innerText = finalQ.toFixed(3);
  }

  // Pre-fill printable metadata
  document.getElementById('print-date-r').innerText = `${'Printed Date'}: ${new Date().toLocaleString()}`;
}

// ===== GODOWN MANAGEMENT =====
async function addGodown() {
  const input = document.getElementById('new-gd-name');
  const name = input.value.trim();
  if (!name) {
    showToast('Please enter a godown name.', 'error');
    return;
  }

  try {
    const res = await fetch('/api/godowns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, name })
    });
    const data = await res.json();
    if (data.success) {
      showToast('New godown added!', 'success');
      input.value = '';
      await loadAppData();
      renderGodownsList();
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (err) {
    console.error('Add godown error', err);
    showToast('Failed to add godown.', 'error');
  }
}

function renderGodownsList() {
  const container = document.getElementById('gd-list');
  const empty = document.getElementById('gd-empty');
  container.innerHTML = '';

  if (state.godowns.length === 0) {
    empty.style.display = 'block';
    empty.innerText = 'No godowns found. Please add a godown first.';
  } else {
    empty.style.display = 'none';
    state.godowns.forEach(g => {
      const item = document.createElement('div');
      item.className = 'gd-list-item';
      
      const opBags = parseFloat(g.opBags) || 0;
      const opQty = parseFloat(g.opQty) || 0;

      item.innerHTML = `
        <div class="gd-info">
          <h4>${g.name}</h4>
          <p>${'Opening stock'}: ${opBags.toLocaleString('en-IN')} Bags / ${opQty.toFixed(3)} M.T.</p>
        </div>
        <div class="row-actions">
          <button class="action-btn" onclick="openRenameModal('${g.id}', '${g.name}')" title="Rename">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z"/></svg>
          </button>
          <button class="action-btn del" onclick="deleteGodown('${g.id}')" title="Delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;
      container.appendChild(item);
    });
  }
}

function openRenameModal(id, currentName) {
  document.getElementById('ren-id').value = id;
  document.getElementById('ren-input').value = currentName;
  document.getElementById('rename-modal').classList.add('open');
}

async function saveRename() {
  const id = document.getElementById('ren-id').value;
  const newName = document.getElementById('ren-input').value.trim();
  if (!newName) return;

  try {
    const res = await fetch(`/api/godowns/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Godown name updated!', 'success');
      document.getElementById('rename-modal').classList.remove('open');
      await loadAppData();
      renderGodownsList();
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (err) {
    console.error('Rename godown error', err);
    showToast('Failed to rename godown.', 'error');
  }
}

async function deleteGodown(godownId) {
  const msg = 'Are you sure you want to delete this godown? All entries in this godown will also be permanently deleted!';
  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/godowns/${godownId}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast('Godown deleted.', 'success');
      await loadAppData();
      renderGodownsList();
    } else {
      showToast(data.error || 'Error', 'error');
    }
  } catch (err) {
    console.error('Delete godown error', err);
    showToast('Failed to delete godown.', 'error');
  }
}

// ===== OPENING STOCK EDITING =====
function renderOpStockForm() {
  const container = document.getElementById('op-form');
  container.innerHTML = '';
  
  if (state.godowns.length === 0) {
    container.innerHTML = `<p style="color:var(--t3);font-size:14px">${'No godowns configured.'}</p>`;
    return;
  }

  state.godowns.forEach(g => {
    const div = document.createElement('div');
    div.style.display = 'grid';
    div.style.gridTemplateColumns = '1fr 1.5fr 1fr 1fr 1fr';
    div.style.gap = '10px';
    div.style.marginBottom = '12px';
    div.style.alignItems = 'center';

    const opDateVal = g.opDate ? g.opDate.substring(0, 10) : '';
    const opNameVal = g.opName || '';

    div.innerHTML = `
      <div style="font-weight:600; font-size:14px; color: var(--text-secondary)">${g.name}</div>
      <div>
        <input type="date" id="op-d-${g.id}" value="${opDateVal}" style="padding: 6px 10px;">
      </div>
      <div>
        <input type="text" id="op-n-${g.id}" value="${opNameVal}" placeholder="Particulers" style="padding: 6px 10px;">
      </div>
      <div>
        <input type="number" id="op-b-${g.id}" value="${g.opBags}" placeholder="Bags" min="0" style="padding: 6px 10px;">
      </div>
      <div>
        <input type="number" id="op-q-${g.id}" value="${g.opQty}" step="0.001" placeholder="Qty M.T." min="0" style="padding: 6px 10px;">
      </div>
    `;
    container.appendChild(div);
  });
}

async function saveOpStock() {
  const opStock = {};
  
  state.godowns.forEach(g => {
    const date = document.getElementById(`op-d-${g.id}`).value;
    const name = document.getElementById(`op-n-${g.id}`).value.trim();
    const bags = parseFloat(document.getElementById(`op-b-${g.id}`).value) || 0;
    const qty = parseFloat(document.getElementById(`op-q-${g.id}`).value) || 0;
    opStock[g.id] = { bags, qty, date, name };
  });

  try {
    const res = await fetch('/api/opstock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: state.user.id, opStock })
    });
    const data = await res.json();
    if (data.success) {
      showToast('Opening stock saved successfully!', 'success');
      await loadAppData();
      if (state.activePage === 'dashboard') renderDashboard();
    } else {
      showToast(data.error || 'Error saving stock', 'error');
    }
  } catch (err) {
    console.error('Save op stock error', err);
    showToast('Failed to save opening stock.', 'error');
  }
}

// ===== THEME TOGGLE (LIGHT / DARK) =====
function toggleTheme() {
  const body = document.body;
  const isDark = body.classList.contains('dark-theme');
  
  if (isDark) {
    body.classList.remove('dark-theme');
    body.classList.add('light-theme');
    state.theme = 'light';
    document.querySelector('.theme-icon-dark').style.display = 'none';
    document.querySelector('.theme-icon-light').style.display = 'block';
  } else {
    body.classList.remove('light-theme');
    body.classList.add('dark-theme');
    state.theme = 'dark';
    document.querySelector('.theme-icon-light').style.display = 'none';
    document.querySelector('.theme-icon-dark').style.display = 'block';
  }
}

// ===== FORMATTING UTILITY =====
function formatDateString(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`; // DD/MM/YYYY
  }
  return dateStr;
}

// ===== INITIAL STARTUP =====
window.addEventListener('DOMContentLoaded', async () => {
  // Check if session exists
  const savedUser = sessionStorage.getItem('auditUser');
  if (savedUser) {
    try {
      state.user = JSON.parse(savedUser);
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      document.getElementById('topbar-user').innerText = state.user.email;
      document.getElementById('acc-email').innerText = state.user.email;
      await loadAppData();
      
      showPage('dashboard');
    } catch (e) {
      console.error('Session user parse failed', e);
      sessionStorage.removeItem('auditUser');
      
    }
  } else {
    
  }
});
