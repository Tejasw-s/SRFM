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
  const dropFields = ['f-godown', 'fi-gd', 'ri-gd', 'e-gd', 'ed-fi-gd'];
  
  dropFields.forEach(fieldId => {
    const select = document.getElementById(fieldId);
    if (!select) return;
    
    // Clear and build options
    select.innerHTML = '';
    
    if (fieldId === 'fi-gd' || fieldId === 'ed-fi-gd' || fieldId === 'ri-gd') {
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
    'godowns': 'bn-godowns',
    'production': 'bn-production'
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
  } else if (pageId === 'production') {
    initProductionPage();
  } else if (pageId === 'report') {
    // Default dates to current month range
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    document.getElementById('ri-fr').value = `${y}-${m}-01`;
    document.getElementById('ri-to').value = new Date().toISOString().split('T')[0];
    renderReport();
  } else if (pageId === 'edit-data') {
    if (!document.getElementById('ed-fi-date').value) {
      document.getElementById('ed-fi-date').value = new Date().toISOString().split('T')[0];
    }
    renderExcelData();
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
  const sorted = [...dashEntries].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 10);
  
  if (sorted.length === 0) {
    recentEmpty.style.display = 'block';
    recentEmpty.innerText = 'No records match search parameters.';
  } else {
    recentEmpty.style.display = 'none';
    sorted.forEach(e => {
      const g = state.godowns.find(gd => gd.id === e.godownId);
      const dObj = new Date(e.date + 'T00:00:00');
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][dObj.getDay()];
      
      const rowOpBags = parseFloat(e.closBags) + parseFloat(e.issBags) - parseFloat(e.recvBags);
      const rowOpQty = parseFloat(e.closQty) + parseFloat(e.issQty) - parseFloat(e.recvQty);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td style="font-size: 13px; color: var(--text-muted)">${dayName}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num">${rowOpBags.toLocaleString('en-IN')}</td>
        <td class="num">${rowOpQty.toFixed(3)}</td>
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
  
  // Calculate final closing stock for footer based on filters
  let finalClosB = 0;
  let finalClosQ = 0;
  
  const toDateCalc = fiTo || '9999-12-31';

  if (fiGd) {
    const fs = getPrevClosing(fiGd, toDateCalc);
    finalClosB = fs.bags;
    finalClosQ = fs.qty;
  } else {
    state.godowns.forEach(g => {
      const fs = getPrevClosing(g.id, toDateCalc);
      finalClosB += fs.bags;
      finalClosQ += fs.qty;
    });
  }

  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.innerText = 'No records match search parameters.';
    
    // Clear footer totals for issued/recv
    document.getElementById('tf-ib').innerText = '0';
    document.getElementById('tf-iq').innerText = '0.000';
    document.getElementById('tf-rb').innerText = '0';
    document.getElementById('tf-rq').innerText = '0.000';
    
    // But keep the actual calculated closing stock
    document.getElementById('tf-cb').innerText = finalClosB.toLocaleString('en-IN');
    document.getElementById('tf-cq').innerText = finalClosQ.toFixed(3);
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

      const rowOpBags = parseFloat(e.closBags) + parseFloat(e.issBags) - parseFloat(e.recvBags);
      const rowOpQty = parseFloat(e.closQty) + parseFloat(e.issQty) - parseFloat(e.recvQty);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td style="font-size: 13px; color: var(--text-muted)">${dayName}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num">${rowOpBags.toLocaleString('en-IN')}</td>
        <td class="num">${rowOpQty.toFixed(3)}</td>
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

  if (state.godowns.length === 0) {
    document.getElementById('rep-empty').style.display = 'block';
    document.getElementById('rep-empty').innerText = 'No godowns found. Please add a godown first.';
    return;
  }

  // Filter entries for selected godown in date range
  let filtered = state.entries;
  if (riGd) filtered = filtered.filter(e => e.godownId === riGd);
  if (riFr) filtered = filtered.filter(e => e.date >= riFr);
  if (riTo) filtered = filtered.filter(e => e.date <= riTo);

  // Sort chronologically ascending for ledger ledger flow
  filtered.sort((a, b) => a.date.localeCompare(b.date));

  const tbody = document.getElementById('rep-tbody');
  const empty = document.getElementById('rep-empty');
  tbody.innerHTML = '';
  empty.style.display = 'none';

  let totIssB = 0, totIssQ = 0, totRecvB = 0, totRecvQ = 0;

  // Calculate opening balance before the filtered start date
  let dayBeforeFr = '0000-01-01';
  if (riFr) {
    const dObj = new Date(riFr);
    dObj.setDate(dObj.getDate() - 1);
    dayBeforeFr = dObj.toISOString().split('T')[0];
  }
  
  let finalB = 0;
  let finalQ = 0;

  if (riGd) {
    const prev = getPrevClosing(riGd, dayBeforeFr);
    finalB = prev.bags;
    finalQ = prev.qty;
  } else {
    // If All Godowns, calculate sum of opening balances
    state.godowns.forEach(g => {
      const p = getPrevClosing(g.id, dayBeforeFr);
      finalB += p.bags;
      finalQ += p.qty;
    });
  }

  // Always show the Opening Balance row for ledger clarity
  const trOp = document.createElement('tr');
  trOp.innerHTML = `
    <td style="font-weight: 600">${riFr ? formatDateString(riFr) : 'Opening'}</td>
    <td>${riGd ? (state.godowns.find(g => g.id === riGd)?.name || 'Unknown') : 'All Godowns'}</td>
    <td><em>Opening Balance</em></td>
    <td class="num" style="color: var(--saffron)">0</td>
    <td class="num" style="color: var(--saffron)">0.000</td>
    <td class="num" style="color: var(--green)">0</td>
    <td class="num" style="color: var(--green)">0.000</td>
    <td class="num" style="font-weight: 600">${finalB.toLocaleString('en-IN')}</td>
    <td class="num" style="font-weight: 600">${finalQ.toFixed(3)}</td>
  `;
  tbody.appendChild(trOp);

  if (filtered.length === 0) {
    empty.style.display = 'block';
    empty.innerText = 'No records match search parameters.';
  } else {
    let currentBalB = finalB;
    let currentBalQ = finalQ;

    filtered.forEach(e => {
      const g = state.godowns.find(gd => gd.id === e.godownId);
      const issB = parseFloat(e.issBags) || 0;
      const issQ = parseFloat(e.issQty) || 0;
      const recvB = parseFloat(e.recvBags) || 0;
      const recvQ = parseFloat(e.recvQty) || 0;

      totIssB += issB;
      totIssQ += issQ;
      totRecvB += recvB;
      totRecvQ += recvQ;

      let rowClosB, rowClosQ;
      if (riGd) {
        rowClosB = parseFloat(e.closBags) || 0;
        rowClosQ = parseFloat(e.closQty) || 0;
        currentBalB = rowClosB;
        currentBalQ = rowClosQ;
      } else {
        currentBalB = currentBalB + recvB - issB;
        currentBalQ = currentBalQ + recvQ - issQ;
        rowClosB = currentBalB;
        rowClosQ = currentBalQ;
      }

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: 600">${formatDateString(e.date)}</td>
        <td>${g ? g.name : 'Unknown'}</td>
        <td>${e.particulers || '—'}</td>
        <td class="num" style="color: var(--saffron)">${issB.toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--saffron)">${issQ.toFixed(3)}</td>
        <td class="num" style="color: var(--green)">${recvB.toLocaleString('en-IN')}</td>
        <td class="num" style="color: var(--green)">${recvQ.toFixed(3)}</td>
        <td class="num" style="font-weight: 600">${rowClosB.toLocaleString('en-IN')}</td>
        <td class="num" style="font-weight: 600">${rowClosQ.toFixed(3)}</td>
      `;
      tbody.appendChild(tr);
    });

    finalB = currentBalB;
    finalQ = currentBalQ;
  }

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

window.editOpeningStockRecord = function(godownId) {
  showPage('entry');
  const input = document.getElementById('op-n-' + godownId);
  if (input) {
    input.focus();
    input.parentElement.parentElement.style.transition = 'background 0.5s';
    input.parentElement.parentElement.style.background = 'var(--blue-light)';
    setTimeout(() => {
      input.parentElement.parentElement.style.background = 'transparent';
    }, 1500);
  } else {
    // If not rendered yet, wait a tiny bit
    setTimeout(() => {
      const retryInput = document.getElementById('op-n-' + godownId);
      if (retryInput) {
        retryInput.focus();
        retryInput.parentElement.parentElement.style.transition = 'background 0.5s';
        retryInput.parentElement.parentElement.style.background = 'var(--blue-light)';
        setTimeout(() => retryInput.parentElement.parentElement.style.background = 'transparent', 1500);
      }
    }, 200);
  }
};

function renderOpStockForm() {
  const container = document.getElementById('op-form');
  container.innerHTML = '';
  
  if (state.godowns.length === 0) {
    container.innerHTML = `<p style="color:var(--text-secondary);font-size:14px">${'No godowns configured.'}</p>`;
    return;
  }

  // Pre-fill the common date input
  const commonDateInput = document.getElementById('common-op-date');
  if (commonDateInput) {
    // Look for any existing opDate among godowns, fallback to today
    const existingDate = state.godowns.find(g => g.opDate);
    if (existingDate && existingDate.opDate) {
      commonDateInput.value = existingDate.opDate.substring(0, 10);
    } else if (!commonDateInput.value) {
      commonDateInput.value = new Date().toISOString().split('T')[0];
    }
  }

  state.godowns.forEach(g => {
    const div = document.createElement('div');
    div.style.display = 'grid';
    div.style.gridTemplateColumns = '1.2fr 1.5fr 1fr 1fr';
    div.style.gap = '10px';
    div.style.marginBottom = '12px';
    div.style.alignItems = 'center';

    const opNameVal = g.opName || '';
    
    // Remove .00 and .000 by formatting to string after parseFloat
    const bFloat = parseFloat(g.opBags);
    const bagsStr = (bFloat === 0 || isNaN(bFloat)) ? '0' : bFloat.toString();
    
    const qFloat = parseFloat(g.opQty);
    const qtyStr = (qFloat === 0 || isNaN(qFloat)) ? '0' : qFloat.toString();

    div.innerHTML = `
      <div style="font-weight:600; font-size:14px; color: var(--text-secondary)">${g.name}</div>
      <div>
        <input type="text" id="op-n-${g.id}" value="${opNameVal}" placeholder="Particulers" style="padding: 6px 10px;">
      </div>
      <div>
        <input type="number" id="op-b-${g.id}" value="${bagsStr}" placeholder="Bags" min="0" style="padding: 6px 10px;">
      </div>
      <div>
        <input type="number" id="op-q-${g.id}" value="${qtyStr}" step="0.001" placeholder="Qty M.T." min="0" style="padding: 6px 10px;">
      </div>
    `;
    container.appendChild(div);
  });
}

function updateAllOpDates() {
  const commonDate = document.getElementById('common-op-date').value;
  if (!commonDate) return;

  const dObj = new Date(commonDate);
  dObj.setDate(dObj.getDate() - 1);
  const dayBefore = dObj.toISOString().split('T')[0];

  state.godowns.forEach(g => {
    let targetBags = 0;
    let targetQty = 0;
    
    const gOpDate = g.opDate ? g.opDate.substring(0, 10) : '';
    
    if (commonDate === gOpDate) {
      targetBags = parseFloat(g.opBags) || 0;
      targetQty = parseFloat(g.opQty) || 0;
    } else {
      const prev = getPrevClosing(g.id, dayBefore);
      targetBags = prev.bags;
      targetQty = prev.qty;
    }
    
    const bInput = document.getElementById(`op-b-${g.id}`);
    const qInput = document.getElementById(`op-q-${g.id}`);
    
    if (bInput) bInput.value = targetBags === 0 ? '0' : targetBags.toString();
    if (qInput) qInput.value = targetQty === 0 ? '0' : targetQty.toString();
  });
}

async function saveOpStock() {
  const opStock = {};
  const commonDateInput = document.getElementById('common-op-date');
  const commonDate = commonDateInput ? commonDateInput.value : '';
  
  if (!commonDate) {
    showToast('Please select a common opening date.', 'error');
    return;
  }
  
  state.godowns.forEach(g => {
    const name = document.getElementById(`op-n-${g.id}`).value.trim();
    const bags = parseFloat(document.getElementById(`op-b-${g.id}`).value) || 0;
    const qty = parseFloat(document.getElementById(`op-q-${g.id}`).value) || 0;
    opStock[g.id] = { bags, qty, date: commonDate, name };
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

// ===== EXCEL DATA EDITOR =====
function clearExcelFilters() {
  document.getElementById('ed-fi-gd').value = '';
  document.getElementById('ed-fi-date').value = '';
  document.getElementById('ed-fi-search').value = '';
  renderExcelData();
}

function renderExcelData() {
  const fiGd = document.getElementById('ed-fi-gd').value;
  const fiDate = document.getElementById('ed-fi-date').value;
  const fiSearch = document.getElementById('ed-fi-search').value.toLowerCase().trim();

  let filtered = [...state.entries];
  if (fiGd) filtered = filtered.filter(e => e.godownId === fiGd);
  if (fiDate) filtered = filtered.filter(e => e.date === fiDate);
  if (fiSearch) filtered = filtered.filter(e => (e.particulers || '').toLowerCase().includes(fiSearch));

  // Sort descending
  filtered.sort((a, b) => b.date.localeCompare(a.date));

  const tbody = document.getElementById('excel-tbody');
  tbody.innerHTML = '';

  filtered.forEach(e => {
    let godownOptions = state.godowns.map(g => `<option value="${g.id}" ${g.id === e.godownId ? 'selected' : ''}>${g.name}</option>`).join('');
    const tr = document.createElement('tr');
    tr.id = `erow-${e.id}`;
    tr.innerHTML = `
      <td><input type="date" id="ed-dt-${e.id}" value="${e.date}"></td>
      <td><select id="ed-gd-${e.id}">${godownOptions}</select></td>
      <td><input type="text" id="ed-pt-${e.id}" value="${e.particulers}"></td>
      <td><input type="number" id="ed-ib-${e.id}" value="${e.issBags}" class="num"></td>
      <td><input type="number" id="ed-iq-${e.id}" value="${e.issQty}" step="0.001" class="num"></td>
      <td><input type="number" id="ed-rb-${e.id}" value="${e.recvBags}" class="num"></td>
      <td><input type="number" id="ed-rq-${e.id}" value="${e.recvQty}" step="0.001" class="num"></td>
      <td><input type="number" id="ed-cb-${e.id}" value="${e.closBags}" class="num"></td>
      <td><input type="number" id="ed-cq-${e.id}" value="${e.closQty}" step="0.001" class="num"></td>
      <td><input type="text" id="ed-rm-${e.id}" value="${e.remarks}"></td>
      <td class="actions">
        <button class="btn btn-primary btn-sm" onclick="saveExcelRow('${e.id}')" style="padding:4px 8px; font-size:11px;">Save</button>
        <button class="btn btn-danger btn-sm" onclick="deleteExcelRow('${e.id}')" style="padding:4px 8px; font-size:11px;">Del</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Add "New Row" at the bottom
  let godownOptionsNew = state.godowns.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  // Use filter date if available, otherwise today
  const defaultDate = fiDate || new Date().toISOString().split('T')[0];
  const trNew = document.createElement('tr');
  trNew.id = `erow-new`;
  trNew.style.backgroundColor = 'rgba(0, 200, 100, 0.05)';
  trNew.innerHTML = `
    <td><input type="date" id="ed-dt-new" value="${defaultDate}"></td>
    <td><select id="ed-gd-new"><option value="">Select Godown...</option>${godownOptionsNew}</select></td>
    <td><input type="text" id="ed-pt-new" placeholder="New Particulars..."></td>
    <td><input type="number" id="ed-ib-new" placeholder="0" class="num"></td>
    <td><input type="number" id="ed-iq-new" placeholder="0.000" step="0.001" class="num"></td>
    <td><input type="number" id="ed-rb-new" placeholder="0" class="num"></td>
    <td><input type="number" id="ed-rq-new" placeholder="0.000" step="0.001" class="num"></td>
    <td><input type="number" id="ed-cb-new" placeholder="0" class="num"></td>
    <td><input type="number" id="ed-cq-new" placeholder="0.000" step="0.001" class="num"></td>
    <td><input type="text" id="ed-rm-new" placeholder="Remarks..."></td>
    <td class="actions">
      <button class="btn btn-secondary btn-sm" onclick="addExcelRow()" style="padding:4px 8px; font-size:11px; width:100%;">Add</button>
    </td>
  `;
  tbody.appendChild(trNew);
}

async function saveExcelRow(id) {
  const godownId = document.getElementById('ed-gd-'+id).value;
  const dateVal = document.getElementById('ed-dt-'+id).value;
  const partVal = document.getElementById('ed-pt-'+id).value.trim();
  const issB = parseFloat(document.getElementById('ed-ib-'+id).value) || 0;
  const issQ = parseFloat(document.getElementById('ed-iq-'+id).value) || 0;
  const recvB = parseFloat(document.getElementById('ed-rb-'+id).value) || 0;
  const recvQ = parseFloat(document.getElementById('ed-rq-'+id).value) || 0;
  const closB = parseFloat(document.getElementById('ed-cb-'+id).value) || 0;
  const closQ = parseFloat(document.getElementById('ed-cq-'+id).value) || 0;
  const remVal = document.getElementById('ed-rm-'+id).value.trim();

  const payload = {
    godownId, date: dateVal, particulers: partVal,
    issBags: issB, issQty: issQ, recvBags: recvB, recvQty: recvQ,
    closBags: closB, closQty: closQ, remarks: remVal
  };

  try {
    const res = await fetch(`/api/entries/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Row updated successfully!', 'success');
      await loadAppData();
      renderExcelData();
    } else {
      showToast(data.error || 'Error updating', 'error');
    }
  } catch (err) {
    console.error('Update entry error', err);
    showToast('Failed to update entry.', 'error');
  }
}

async function addExcelRow() {
  const godownId = document.getElementById('ed-gd-new').value;
  const dateVal = document.getElementById('ed-dt-new').value;
  if(!godownId || !dateVal) {
    showToast('Godown and Date are required', 'error');
    return;
  }
  const partVal = document.getElementById('ed-pt-new').value.trim();
  const issB = parseFloat(document.getElementById('ed-ib-new').value) || 0;
  const issQ = parseFloat(document.getElementById('ed-iq-new').value) || 0;
  const recvB = parseFloat(document.getElementById('ed-rb-new').value) || 0;
  const recvQ = parseFloat(document.getElementById('ed-rq-new').value) || 0;
  const closB = parseFloat(document.getElementById('ed-cb-new').value) || 0;
  const closQ = parseFloat(document.getElementById('ed-cq-new').value) || 0;
  const remVal = document.getElementById('ed-rm-new').value.trim();

  const payload = {
    userId: state.user.id, godownId, date: dateVal, particulers: partVal,
    issBags: issB, issQty: issQ, recvBags: recvB, recvQty: recvQ,
    closBags: closB, closQty: closQ, remarks: remVal
  };

  try {
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast('Row added successfully!', 'success');
      await loadAppData();
      renderExcelData();
    } else {
      showToast(data.error || 'API Error', 'error');
    }
  } catch (err) {
    console.error('Save entry API error', err);
    showToast('Failed to add entry.', 'error');
  }
}

async function deleteExcelRow(entryId) {
  if (!confirm('Are you sure you want to delete this row?')) return;
  try {
    const res = await fetch(`/api/entries/${entryId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Row deleted.', 'success');
      await loadAppData();
      renderExcelData();
    } else {
      showToast(data.error || 'Error deleting', 'error');
    }
  } catch (err) {
    console.error('Delete entry error', err);
    showToast('Failed to delete row.', 'error');
  }
}

// ===== PRODUCTION & KOTHA MANAGEMENT =====
const productionProducts = [
  { name: 'MAIDA V GOLD 50 KGS', multiplier: 50 },
  { name: 'MAIDA VETRILAI 50 KGS', multiplier: 50 },
  { name: 'MAIDA 90 KGS', multiplier: 90 },
  { name: 'MAIDA MPM BOPP 50 KGS', multiplier: 50 },
  { name: 'MAIDA MPM YELLOW 50 KGS', multiplier: 50 },
  { name: 'MAIDA KRISHNA 50 KGS', multiplier: 50 },
  { name: 'MAIDA SKY 50 KGS', multiplier: 50 },
  { name: 'SOOJI 50 KGS', multiplier: 50 },
  { name: 'SOOJI 30 KGS', multiplier: 30 },
  { name: 'SOOJI 90 KGS', multiplier: 90 },
  { name: 'ATTA 90 KGS', multiplier: 90 },
  { name: 'ATTA 50 KGS', multiplier: 50 },
  { name: 'ATTA 30 KGS', multiplier: 30 },
  { name: 'SUPER FINE BRAN', multiplier: 1 },
  { name: 'R\\B FINE BRAN', multiplier: 1 },
  { name: 'FALEX 34 KGS', multiplier: 34 },
  { name: 'REFRACTION', multiplier: 1 }
];

let prodRuns = [];

function initProductionPage() {
  const dateInput = document.getElementById('prod-date');
  if (!dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  // Populate source godown dropdown
  const select = document.getElementById('prod-source-gd');
  select.innerHTML = '<option value="">-- Choose Godown (Wheat Stock) --</option>';
  state.godowns.forEach(gd => {
    select.innerHTML += `<option value="${gd.id}">${gd.name}</option>`;
  });

  document.getElementById('prod-source-stock-info').innerText = 'Select a godown and click Send to Kotha';

  renderProductionProductsTable();
  loadProductionHistory();
}

function renderProductionProductsTable() {
  const tbody = document.getElementById('prod-tbody');
  tbody.innerHTML = '';

  productionProducts.forEach((prod, index) => {
    const row = document.createElement('tr');
    
    // Product Name
    const tdName = document.createElement('td');
    tdName.innerText = prod.name;
    tdName.style.fontWeight = '600';
    row.appendChild(tdName);

    // Pack Size
    const tdPack = document.createElement('td');
    tdPack.innerText = prod.multiplier > 1 ? `${prod.multiplier} Kgs` : '—';
    tdPack.style.color = 'var(--text-muted)';
    row.appendChild(tdPack);

    // Bags Input
    const tdBags = document.createElement('td');
    const inputBags = document.createElement('input');
    inputBags.type = 'number';
    inputBags.className = 'excel-input num';
    inputBags.id = `prod-bags-${index}`;
    inputBags.placeholder = '0';
    inputBags.oninput = () => {
      // Auto-compute Kgs
      const bags = parseFloat(inputBags.value) || 0;
      const inputKgs = document.getElementById(`prod-kgs-${index}`);
      if (prod.multiplier > 1) {
        inputKgs.value = bags * prod.multiplier;
      }
      calcProdBalances();
    };
    tdBags.appendChild(inputBags);
    row.appendChild(tdBags);

    // Kgs Input
    const tdKgs = document.createElement('td');
    const inputKgs = document.createElement('input');
    inputKgs.type = 'number';
    inputKgs.className = 'excel-input num';
    inputKgs.id = `prod-kgs-${index}`;
    inputKgs.placeholder = '0';
    inputKgs.oninput = () => {
      calcProdBalances();
    };
    tdKgs.appendChild(inputKgs);
    row.appendChild(tdKgs);

    // Action (Clear)
    const tdAction = document.createElement('td');
    tdAction.style.textAlign = 'center';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-outline btn-sm';
    clearBtn.style.padding = '2px 8px';
    clearBtn.innerHTML = '✕';
    clearBtn.onclick = (e) => {
      e.preventDefault();
      inputBags.value = '';
      inputKgs.value = '';
      calcProdBalances();
    };
    tdAction.appendChild(clearBtn);
    row.appendChild(tdAction);

    tbody.appendChild(row);
  });

  calcProdBalances();
}

function onProdSourceGodownChange() {
  const godownId = document.getElementById('prod-source-gd').value;
  const dateVal = document.getElementById('prod-date').value;
  const infoEl = document.getElementById('prod-source-stock-info');

  if (!godownId) {
    infoEl.innerText = 'Select a godown and click Send to Kotha';
    return;
  }

  const stock = getGodownClosingAtDate(godownId, dateVal);
  const gd = state.godowns.find(g => g.id === godownId);
  infoEl.innerHTML = `<strong style="color:var(--saffron);">${gd.name}</strong> Closing Stock: <strong>${Math.round(stock.bags).toLocaleString()}</strong> Bags / <strong>${parseFloat(stock.qty).toFixed(3)}</strong> M.T.`;
}

function getGodownClosingAtDate(godownId, dateStr) {
  const gd = state.godowns.find(g => g.id === godownId);
  if (!gd) return { bags: 0, qty: 0 };
  
  const relevant = state.entries.filter(e => e.godownId === godownId && e.date <= dateStr);
  if (relevant.length === 0) {
    return { bags: parseFloat(gd.opBags) || 0, qty: parseFloat(gd.opQty) || 0 };
  }
  
  // Sort relevant entries chronologically to find the last one.
  relevant.sort((a, b) => b.date.localeCompare(a.date));
  
  return {
    bags: parseFloat(relevant[0].closBags) || 0,
    qty: parseFloat(relevant[0].closQty) || 0
  };
}

function sendGodownToKotha() {
  const godownId = document.getElementById('prod-source-gd').value;
  const dateVal = document.getElementById('prod-date').value;

  if (!godownId) {
    showToast('Please select a Source Godown first.', 'error');
    return;
  }

  const stock = getGodownClosingAtDate(godownId, dateVal);
  // 1 M.T. = 1000 Kgs
  const kgsStock = stock.qty * 1000;
  
  document.getElementById('prod-kotha-stock').value = Math.round(kgsStock);
  showToast(`Loaded ${Math.round(kgsStock).toLocaleString()} Kgs from Godown Closing Stock.`, 'success');
  
  calcProdBalances();
}

function calcProdBalances() {
  let totalKgs = 0;

  productionProducts.forEach((prod, index) => {
    const inputKgs = document.getElementById(`prod-kgs-${index}`);
    if (inputKgs) {
      totalKgs += parseFloat(inputKgs.value) || 0;
    }
  });

  const kothaStock = parseFloat(document.getElementById('prod-kotha-stock').value) || 0;
  const balKotha = kothaStock - totalKgs;

  document.getElementById('prod-total-val').innerText = Math.round(totalKgs).toLocaleString() + ' KGS';
  
  const balValEl = document.getElementById('prod-bal-val');
  balValEl.innerText = Math.round(balKotha).toLocaleString() + ' KGS';
  
  if (balKotha < 0) {
    balValEl.style.color = 'var(--red-dark)';
  } else {
    balValEl.style.color = 'var(--text)';
  }
}

function clearProdForm() {
  document.getElementById('prod-kotha-stock').value = '0';
  document.getElementById('prod-source-gd').value = '';
  document.getElementById('prod-source-stock-info').innerText = 'Select a godown and click Send to Kotha';

  productionProducts.forEach((prod, index) => {
    const bagsInput = document.getElementById(`prod-bags-${index}`);
    const kgsInput = document.getElementById(`prod-kgs-${index}`);
    if (bagsInput) bagsInput.value = '';
    if (kgsInput) kgsInput.value = '';
  });

  calcProdBalances();
}

async function submitProductionRun() {
  const userId = state.user.id;
  const runDate = document.getElementById('prod-date').value;
  const kothaStock = parseFloat(document.getElementById('prod-kotha-stock').value) || 0;
  const sourceGodownId = document.getElementById('prod-source-gd').value;

  if (!runDate) {
    showToast('Please select a production date.', 'error');
    return;
  }

  // Build items list
  const items = [];
  let productionTotal = 0;

  productionProducts.forEach((prod, index) => {
    const bags = parseFloat(document.getElementById(`prod-bags-${index}`).value) || 0;
    const kgs = parseFloat(document.getElementById(`prod-kgs-${index}`).value) || 0;

    if (bags > 0 || kgs > 0) {
      items.push({
        productName: prod.name,
        bags,
        kgs
      });
      productionTotal += kgs;
    }
  });

  if (items.length === 0) {
    showToast('Please enter production quantities.', 'error');
    return;
  }

  const balanceKotha = kothaStock - productionTotal;

  try {
    const res = await fetch('/api/production', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        runDate,
        kothaStock,
        productionTotal,
        balanceKotha,
        items,
        sourceGodownId: sourceGodownId || null
      })
    });

    const data = await res.json();
    if (data.success) {
      showToast('Production Run recorded successfully!', 'success');
      clearProdForm();
      
      // Reload app data so that any auto-generated wheat consumption entries show up in the main ledger
      await loadAppData();
      
      // Refresh active page or lists
      if (document.getElementById('page-records').classList.contains('active')) {
        renderRecords();
      }
      
      loadProductionHistory();
    } else {
      showToast(data.error || 'Failed to save production run.', 'error');
    }
  } catch (err) {
    console.error('Submit production error', err);
    showToast('Server error processing production.', 'error');
  }
}

async function loadProductionHistory() {
  const tbody = document.getElementById('prod-history-tbody');
  if (!tbody) return;

  try {
    const res = await fetch(`/api/production?userId=${state.user.id}`);
    prodRuns = await res.json();

    tbody.innerHTML = '';
    if (prodRuns.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted)">No production runs recorded.</td></tr>`;
      return;
    }

    prodRuns.forEach(run => {
      const row = document.createElement('tr');
      
      // Date (formatted dd/mm/yyyy)
      const d = new Date(run.runDate);
      const dateStr = d.toLocaleDateString('en-GB'); // dd/mm/yyyy
      
      // Tooltip/Expanded detail of items
      const itemsDetail = run.items.map(it => `${it.productName}: ${Math.round(it.bags)} Bags (${Math.round(it.kgs).toLocaleString()} Kgs)`).join('\n');

      row.innerHTML = `
        <td style="font-weight:600; cursor:help;" title="${itemsDetail}">${dateStr} ℹ️</td>
        <td class="num">${Math.round(run.kothaStock).toLocaleString()} KGS</td>
        <td class="num" style="color:var(--saffron); font-weight:700;">${Math.round(run.productionTotal).toLocaleString()} KGS</td>
        <td class="num" style="font-weight:600;">${Math.round(run.balanceKotha).toLocaleString()} KGS</td>
        <td style="text-align:center;">
          <button class="btn btn-danger btn-sm" onclick="deleteProdRun('${run.id}')" style="padding: 2px 8px;">Delete</button>
        </td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    console.error('Load production history error', err);
  }
}

async function deleteProdRun(runId) {
  if (!confirm('Are you sure you want to delete this production run? This will NOT delete any auto-generated ledger entries.')) return;

  try {
    const res = await fetch(`/api/production/${runId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('Production run deleted.', 'success');
      loadProductionHistory();
    } else {
      showToast(data.error || 'Failed to delete.', 'error');
    }
  } catch (err) {
    console.error('Delete production run error', err);
    showToast('Failed to delete.', 'error');
  }
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
