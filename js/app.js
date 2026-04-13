// ===================== FIREBASE INIT =====================
const firebaseConfig = {
    databaseURL: "https://loanitol-default-rtdb.firebaseio.com/"
};
firebase.initializeApp(firebaseConfig);
const rtdb = firebase.database();
const leadsRef = rtdb.ref('leads');
const usersRef = rtdb.ref('users');
const remindersRef = rtdb.ref('reminders');
const tasksRef = rtdb.ref('tasks');
const escalationsRef = rtdb.ref('escalations');
const loanTypesRef = rtdb.ref('loanTypes');

// ===================== GLOBAL VARIABLES =====================
let leads = [], users = [], reminders = [], tasks = [], escalations = [];
let loanTypes = [];
let currentUser = null;
let currentPage = 'dashboard';
let searchQuery = '';
let dashboardFilter = null;
let loanTypeFilter = null;
let leadPageFilter = null;
let currentLeadId = null, currentTab = 'details';
let chartInstance = null;
let employeeChartInstance = null;
let leadStageChart = null;

// Status definitions (unchanged)
const STATUSES = [
    { k: 'new', l: 'New Lead', c: 'b-new' },
    { k: 'hotlead', l: 'Hot Lead', c: 'b-hotlead' },
    { k: 'profiling', l: 'Primary Profiling', c: 'b-profiling' },
    { k: 'bankfin', l: 'Bank Finalizing', c: 'b-bankfin' },
    { k: 'docs', l: 'Documentation', c: 'b-docs' },
    { k: 'financial', l: 'Financial Analysis', c: 'b-financial' },
    { k: 'legal', l: 'Legal Checking', c: 'b-legal' },
    { k: 'tech', l: 'Technical Evaluation', c: 'b-tech' },
    { k: 'other', l: 'Other Stage', c: 'b-other' },
    { k: 'secbank', l: 'Secondary Profile', c: 'b-secbank' },
    { k: 'login', l: 'Login', c: 'b-login' },
    { k: 'sanction', l: 'Sanction', c: 'b-sanction' },
    { k: 'disbursed', l: 'Disbursed', c: 'b-disbursed' },
    { k: 'followup', l: 'Follow Up', c: 'b-followup' },
    { k: 'hold', l: 'On Hold', c: 'b-hold' },
    { k: 'dump', l: 'Dump', c: 'b-dump' }
];

const TAT = { bankfin: 2, secbank: 2, login: 2, sanction: 7, docs: 7, financial: 2, legal: 3, tech: 3, other: 3, profiling: 1, hotlead: 1 };
const STAGE_WARNING_HOURS = 3;
const STAGE_BREACH_HOURS = 5;

const MENU_PAGES = ['dashboard', 'all-leads', 'new-leads', 'processing', 'tat-breach', 'tat-warning', 'reminders', 'monitor', 'tasks', 'escalations', 'reports', 'pipeline', 'workflow', 'admin-panel'];
const DEFAULT_PAGE_ACCESS = ['dashboard', 'all-leads', 'new-leads', 'processing', 'tat-breach', 'tat-warning', 'reminders', 'monitor', 'tasks', 'escalations', 'reports', 'pipeline', 'workflow'];

function getStat(k) {
    return STATUSES.find(s => s.k === k) || { k, l: k, c: 'b-dump' };
}

function badge(k) {
    return `<span class="badge ${getStat(k).c}">${getStat(k).l}</span>`;
}

function formatDurationMs(ms) {
    if (!Number.isFinite(ms)) return '0m';
    const totalMinutes = Math.round(Math.abs(ms) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || !parts.length) parts.push(`${minutes}m`);
    return parts.join(' ');
}

function parseHistoryTimestamp(entry) {
    const raw = entry.d || entry.date || entry.created || entry.createdAt;
    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function getLeadStageDurations(lead) {
    const history = (lead.history || [])
        .map(entry => ({ ...entry, time: parseHistoryTimestamp(entry) }))
        .filter(entry => entry.time !== null)
        .sort((a, b) => a.time - b.time);

    if (!history.length) return [];
    return history.map((entry, index) => {
        const next = history[index + 1];
        const endTime = next ? next.time : Date.now();
        const durationMs = Math.max(0, endTime - entry.time);
        return {
            stage: entry.s || entry.status || 'unknown',
            label: getStat(entry.s || entry.status || 'unknown').l,
            start: entry.time,
            end: next ? next.time : null,
            durationMs,
            hours: durationMs / 3600000,
            isCurrent: index === history.length - 1
        };
    });
}

function getCurrentStageDurationMs(lead) {
    const current = getLeadStageDurations(lead).find(s => s.isCurrent);
    return current ? current.durationMs : 0;
}

function getCurrentStageDurationHours(lead) {
    const current = getLeadStageDurations(lead).find(s => s.isCurrent);
    return current ? current.hours : 0;
}

function getLeadDuration(lead) {
    const current = getLeadStageDurations(lead).find(s => s.isCurrent);
    if (current) return formatDurationMs(current.durationMs);
    if (lead.created) {
        const created = new Date(lead.created);
        if (!isNaN(created.getTime())) {
            return formatDurationMs(Date.now() - created.getTime());
        }
    }
    return '0m';
}

function getLeadTotalDuration(lead) {
    return getLeadStageDurations(lead).reduce((sum, item) => sum + item.durationMs, 0);
}

function getLeadStageBadgeClass(lead) {
    const hours = getCurrentStageDurationHours(lead);
    if (hours >= STAGE_BREACH_HOURS) return 'tat-breach';
    if (hours >= STAGE_WARNING_HOURS) return 'tat-warning';
    return 'tat-ok';
}

function isTatBreach(lead) {
    return getCurrentStageDurationHours(lead) >= STAGE_BREACH_HOURS;
}

function isTatWarning(lead) {
    const hours = getCurrentStageDurationHours(lead);
    return hours >= STAGE_WARNING_HOURS && hours < STAGE_BREACH_HOURS;
}

function formatDueStatus(dateStr) {
    if (!dateStr) return 'No due date';
    const due = new Date(dateStr);
    if (isNaN(due.getTime())) return dateStr;
    const diff = due.getTime() - Date.now();
    if (diff >= 0) return `Due in ${formatDurationMs(diff)}`;
    return `Overdue by ${formatDurationMs(diff)}`;
}

// ===================== HELPER FUNCTIONS =====================
function toast(msg, type = 'success') {
    const toastDiv = document.createElement('div');
    toastDiv.className = `toast ${type}`;
    toastDiv.innerText = msg;
    document.getElementById('toasts').appendChild(toastDiv);
    setTimeout(() => toastDiv.remove(), 3000);
}

function closeModal() {
    document.getElementById('overlay').classList.remove('open');
}

function closeOverlay(e) {
    if (e.target === document.getElementById('overlay')) closeModal();
}

function openModal(title, body, footer) {
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalBody').innerHTML = body;
    document.getElementById('modalFoot').innerHTML = footer || '';
    document.getElementById('overlay').classList.add('open');
}

// ===================== DATA VISIBILITY =====================
function getVisibleLeads() {
    if (!currentUser) return [];
    if (!canViewLeads()) return [];
    const allLeads = Array.isArray(leads) ? leads : [];
    const isAssigned = (lead) => Array.isArray(lead.assignedCSOs) && lead.assignedCSOs.includes(currentUser.userId);
    const isCreator = (lead) => lead.createdBy === currentUser.userId;

    if (currentUser.role === 'admin') {
        return allLeads;
    }

    if (currentUser.role === 'cso') {
        return allLeads.filter(lead => isCreator(lead) || isAssigned(lead));
    }

    if (currentUser.role === 'cse') {
        return allLeads.filter(lead => isCreator(lead) || isAssigned(lead));
    }

    if (currentUser.role === 'msme_head') {
        return allLeads.filter(lead => lead.category === 'MSME' || isCreator(lead) || isAssigned(lead));
    }

    if (currentUser.role === 'retail_head') {
        return allLeads.filter(lead => lead.category === 'Retail' || isCreator(lead) || isAssigned(lead));
    }

    if (currentUser.role === 'bank_follow_officer') {
        return allLeads.filter(lead => ['MSME', 'Retail'].includes(lead.category) || isCreator(lead) || isAssigned(lead));
    }

    if (currentUser.role === 'legal_officer') {
        return allLeads.filter(lead => lead.status === 'legal' || isCreator(lead) || isAssigned(lead));
    }

    return allLeads.filter(lead => isCreator(lead) || isAssigned(lead) || lead.visibleTo?.includes(currentUser.userId));
}

function filteredLeads() {
    let list = getVisibleLeads();
    if (dashboardFilter === 'new') list = list.filter(l => l.status === 'new');
    if (dashboardFilter === 'allocated') list = list.filter(l => Array.isArray(l.assignedCSOs) && l.assignedCSOs.length);
    if (leadPageFilter === 'allocated') list = list.filter(l => Array.isArray(l.assignedCSOs) && l.assignedCSOs.includes(currentUser.userId));
    if (leadPageFilter === 'new') list = list.filter(l => l.status === 'new');
    if (leadPageFilter === 'tat-warning') list = list.filter(isTatWarning);
    if (leadPageFilter === 'tat-breach') list = list.filter(isTatBreach);
    if (loanTypeFilter && loanTypeFilter !== 'All') list = list.filter(l => l.loanType === loanTypeFilter);
    if (searchQuery) {
        const q = searchQuery.toLowerCase();
        list = list.filter(l =>
            l.name.toLowerCase().includes(q) ||
            l.phone.toLowerCase().includes(q) ||
            l.loanType.toLowerCase().includes(q) ||
            l.status.toLowerCase().includes(q) ||
            getStat(l.status).l.toLowerCase().includes(q)
        );
    }
    return list;
}

function getUserDisplayName(userId) {
    const user = users.find(u => u.userId === userId);
    return user ? user.displayName : userId || 'Unknown';
}

function getVisibleReminders() {
    if (!currentUser) return [];
    return reminders.filter(r => {
        if (currentUser.role === 'admin') return true;
        if (r.createdBy === currentUser.userId) return true;
        const assignedTo = Array.isArray(r.assignedTo) ? r.assignedTo : r.assignedTo ? [r.assignedTo] : [];
        const cc = Array.isArray(r.cc) ? r.cc : r.cc ? [r.cc] : [];
        if (assignedTo.includes(currentUser.userId)) return true;
        if (cc.includes(currentUser.userId)) return true;
        if (r.type === 'department') {
            const dept = (r.department || '').toLowerCase();
            if (currentUser.role === 'bank_follow_officer') {
                return ['msme', 'retail'].includes(dept);
            }
            return dept === (currentUser.department || '').toLowerCase();
        }
        return false;
    });
}

function getVisibleEscalations() {
    if (!currentUser) return [];
    return escalations.filter(e => {
        if (currentUser.role === 'admin') return true;
        if (e.createdBy === currentUser.userId) return true;
        if (e.assignedTo === currentUser.userId) return true;
        const lead = leads.find(l => l.id === e.leadId);
        return lead?.createdBy === currentUser.userId;
    });
}

function getDefaultPermissions(role) {
    return {
        canViewLeads: role !== 'visitor',
        pageAccess: role === 'admin' ? [...DEFAULT_PAGE_ACCESS, 'admin-panel'] : [...DEFAULT_PAGE_ACCESS]
    };
}

function normalizeUser(user) {
    const permissions = { ...getDefaultPermissions(user.role), ...(user.permissions || {}) };
    return { ...user, permissions };
}

function canViewPage(page) {
    if (!currentUser) return false;
    if (page === 'admin-panel') return currentUser.role === 'admin';
    if (currentUser.role === 'admin') return true;
    const access = currentUser.permissions?.pageAccess;
    if (!Array.isArray(access)) return page !== 'admin-panel';
    return access.includes(page);
}

function canViewLeads() {
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    return currentUser.permissions?.canViewLeads !== false;
}

function updateBadges() {
    const remCount = getVisibleReminders().length;
    const taskCount = tasks.filter(t => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return t.status !== 'completed';
        return (t.assignedTo === currentUser.userId || t.createdBy === currentUser.userId) && t.status !== 'completed';
    }).length;
    const escCount = leads.filter(l => {
        const lim = TAT[l.status] || 99;
        return l.tat >= lim && l.status !== 'disbursed';
    }).length;
    const remBadge = document.getElementById('nb-rem');
    const taskBadge = document.getElementById('nb-tasks');
    const escBadge = document.getElementById('nb-esc');
    if (remBadge) remBadge.innerText = remCount;
    if (taskBadge) taskBadge.innerText = taskCount;
    if (escBadge) escBadge.innerText = escCount;
}

// ===================== PAGE LOADING & RENDERING =====================
async function loadPage(page) {
    currentPage = page;
    document.getElementById('pageTitle').innerText = page.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
    if (!canViewPage(page)) {
        document.getElementById('appContent').innerHTML = `
            <div class="panel">
                <div class="panel-header">Access Restricted</div>
                <div class="panel-body">You do not have permission to access this page. Please contact your administrator.</div>
            </div>
        `;
        updateSidebarActive();
        return;
    }
    const response = await fetch(`../pages/${page}.html`);
    const html = await response.text();
    document.getElementById('appContent').innerHTML = html;

    // After loading the page structure, call the specific render function
    switch (page) {
        case 'dashboard': renderDashboard(); break;
        case 'all-leads': renderAllLeads(); break;
        case 'new-leads': renderNewLeads(); break;
        case 'processing': renderProcessing(); break;
        case 'tat-breach': renderTatBreach(); break;
        case 'tat-warning': renderTatWarning(); break;
        case 'reminders': renderReminders(); break;
        case 'monitor': renderMonitor(); break;
        case 'tasks': renderTasks(); break;
        case 'escalations': renderEscalations(); break;
        case 'reports': renderReports(); break;
        case 'pipeline': renderPipeline(); break;
        case 'admin-panel': renderAdminPanel(); break;
        case 'workflow': /* nothing dynamic */ break;
        default: break;
    }

    updateSidebarActive();
}

function renderDashboard() {
    const visible = getVisibleLeads();
    const total = visible.length;
    const tatBreach = visible.filter(isTatBreach).length;
    const remindersCount = getVisibleReminders().length;
    const tasksCount = tasks.filter(t => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return t.status !== 'completed';
        return (t.assignedTo === currentUser.userId || t.createdBy === currentUser.userId) && t.status !== 'completed';
    }).length;
    const escalations = tatBreach;

    document.getElementById('dashboard-stats').innerHTML = `
        <div class="stat-card" onclick="setDashboardFilter('total')">
            <div class="stat-card-label">Total Leads</div>
            <div class="stat-card-value">${total}</div>
        </div>
        <div class="stat-card" onclick="navToPage('tat-breach')">
            <div class="stat-card-label">TAT Breach</div>
            <div class="stat-card-value" style="color:var(--red2)">${tatBreach}</div>
        </div>
        <div class="stat-card" onclick="navToPage('reminders')">
            <div class="stat-card-label">Reminders</div>
            <div class="stat-card-value">${remindersCount}</div>
        </div>
        <div class="stat-card" onclick="navToPage('tasks')">
            <div class="stat-card-label">Tasks</div>
            <div class="stat-card-value">${tasksCount}</div>
        </div>
        <div class="stat-card" onclick="navToPage('escalations')">
            <div class="stat-card-label">Escalations</div>
            <div class="stat-card-value" style="color:var(--orange)">${escalations}</div>
        </div>
    `;
}

function renderAllLeads() { renderLeadTable(filteredLeads(), 'all-leads'); }
function renderNewLeads() { renderLeadTable(filteredLeads().filter(l => l.status === 'new' && (l.assignedCSOs?.includes(currentUser.userId) || l.createdBy === currentUser.userId)), 'new-leads'); }
function renderProcessing() { renderLeadTable(filteredLeads().filter(l => !['disbursed', 'dump', 'hold'].includes(l.status)), 'processing'); }
function renderTatBreach() { renderLeadTable(filteredLeads().filter(isTatBreach), 'tat-breach'); }
function renderTatWarning() { renderLeadTable(filteredLeads().filter(isTatWarning), 'tat-warning'); }

function renderLeadFilters(page) {
    const container = document.getElementById('leadFilterBar');
    if (!container) return;
    const filterButtons = [
        { key: 'all', label: 'All Leads' },
        { key: 'new', label: 'New Leads' },
        { key: 'allocated', label: 'Allocated to Me' },
        { key: 'tat-warning', label: 'TAT Warning' },
        { key: 'tat-breach', label: 'TAT Breach' }
    ];
    const statusButtons = filterButtons.map(f => `
        <button class="filter-chip ${leadPageFilter === f.key || (!leadPageFilter && page === 'all-leads' && f.key === 'all') ? 'active' : ''}"
                onclick="setLeadPageFilter('${f.key}')">${f.label}</button>
    `).join('');
    const loanButtonLabel = loanTypeFilter || 'All';
    const loanItems = ['All', ...loanTypes].map(type => `
        <button class="filter-dropdown-item ${(loanTypeFilter === type || (!loanTypeFilter && type === 'All')) ? 'active' : ''}"
                onclick="setLoanTypeFilter('${type}')">${type}</button>
    `).join('');
    const clearFilterItem = loanTypeFilter ? `
        <button class="filter-dropdown-item filter-clear-item" onclick="setLoanTypeFilter('All')">Clear filter</button>
    ` : '';
    container.innerHTML = `
        <div class="lead-filter-row">
            <div class="lead-filter-group"><strong>View:</strong> ${statusButtons}</div>
        </div>
        <div class="lead-filter-row">
            <div class="lead-filter-group">
                <strong>Loan Type:</strong>
                <div class="filter-dropdown" id="loanTypeDropdown" onclick="toggleLoanTypeDropdown(event)">
                    <button class="filter-chip filter-dropdown-button">${loanButtonLabel} <i class="fas fa-caret-down"></i></button>
                    <div class="filter-dropdown-menu" onclick="event.stopPropagation()">
                        ${clearFilterItem}
                        <input id="loanTypeSearch" class="filter-search" placeholder="Search loan types..." oninput="filterLoanTypeDropdown()">
                        <div class="filter-dropdown-list">${loanItems}</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function toggleLoanTypeDropdown(event) {
    event.stopPropagation();
    const dropdown = document.getElementById('loanTypeDropdown');
    if (!dropdown) return;
    dropdown.classList.toggle('show');
}

function filterLoanTypeDropdown() {
    const query = document.getElementById('loanTypeSearch')?.value.toLowerCase() || '';
    document.querySelectorAll('#loanTypeDropdown .filter-dropdown-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(query) ? 'block' : 'none';
    });
}

function closeAllDropdowns() {
    document.querySelectorAll('.filter-dropdown.show').forEach(dd => dd.classList.remove('show'));
}

function setLeadPageFilter(filter) {
    leadPageFilter = filter === 'all' ? null : filter;
    if (currentPage === 'all-leads') renderAllLeads();
    else if (currentPage === 'new-leads') renderNewLeads();
    else if (currentPage === 'processing') renderProcessing();
    else if (currentPage === 'tat-breach') renderTatBreach();
    else if (currentPage === 'tat-warning') renderTatWarning();
}

function setLoanTypeFilter(type) {
    loanTypeFilter = type === 'All' ? null : type;
    closeAllDropdowns();
    if (currentPage === 'all-leads') renderAllLeads();
    else if (currentPage === 'new-leads') renderNewLeads();
    else if (currentPage === 'processing') renderProcessing();
    else if (currentPage === 'tat-breach') renderTatBreach();
    else if (currentPage === 'tat-warning') renderTatWarning();
}

function renderLeadTable(list, page) {
    renderLeadFilters(page);
    const tbody = document.getElementById('leads-table-body');
    if (!tbody) return;
    tbody.innerHTML = list.map(l => {
        const assignedNames = Array.isArray(l.assignedCSOs) && l.assignedCSOs.length
            ? l.assignedCSOs.map(getUserDisplayName).join(', ')
            : 'Unassigned';
        return `
        <tr>
            <td>
                <div>
                    <strong>${l.name}</strong><br>
                    <small>${l.phone}</small><br>
                    <small class="lead-allocated">Allocated to: ${assignedNames}</small>
                </div>
            </td>
            <td>${l.loanType}</td>
            <td>${badge(l.status)}</td>
            <td class="${getLeadStageBadgeClass(l)}">${getLeadDuration(l)}</td>
            <td>
                <button class="btn btn-sm btn-info" onclick="viewLead('${l.id}')">View</button>
                ${currentUser?.role === 'head' || currentUser?.role === 'admin' ? `<button class="btn btn-sm btn-primary" onclick="openReassignModal('${l.id}')">Reassign</button>` : ''}
            </td>
        </tr>
    `;
    }).join('');
}

function renderReminders() {
    const container = document.getElementById('reminders-list');
    if (!container) return;
    const myReminders = getVisibleReminders();
    container.innerHTML = `
        <div style="margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <button class="btn btn-info" onclick="navToPage('monitor')">View CC Monitor</button>
            <div style="flex:1; min-width:220px; color:var(--text2);">Search for reminders by title, lead, or assignee using top search.</div>
        </div>
    ` + (myReminders.map(r => `
        <div class="rem-item">
            <strong>${r.title}</strong><br>
            ${r.desc}<br>
            ${r.leadName ? `<small>Lead: ${r.leadName}</small><br>` : ''}
            <small>${formatDueStatus(r.due)}</small><br>
            <small>Created by: ${getUserDisplayName(r.createdBy)}</small><br>
            ${r.assignedTo ? `<small>Assigned to: ${Array.isArray(r.assignedTo) ? r.assignedTo.map(getUserDisplayName).join(', ') : getUserDisplayName(r.assignedTo)}</small><br>` : ''}
            ${r.cc?.length ? `<small>CC: ${r.cc.map(getUserDisplayName).join(', ')}</small><br>` : ''}
            ${r.type === 'department' ? `<small>Department: ${r.department}</small><br>` : ''}
            ${Array.isArray(r.cc) && r.cc.includes(currentUser.userId) ? `<small style="color:var(--gold);">You are CC'd on this reminder</small><br>` : ''}
            <button class="btn btn-sm btn-primary" onclick="completeReminder('${r.id}')">Mark Done</button>
        </div>
    `).join('') || '<div>No reminders</div>');
}

function renderTasks() {
    const pendingContainer = document.getElementById('pending-tasks');
    const completedContainer = document.getElementById('completed-tasks');
    if (!pendingContainer) return;

    const myTasks = tasks.filter(t => {
        if (!currentUser) return false;
        if (currentUser.role === 'admin') return true;
        return t.assignedTo === currentUser.userId || t.createdBy === currentUser.userId;
    });

    const pending = myTasks.filter(t => t.status !== 'completed');
    const completed = myTasks.filter(t => t.status === 'completed');

    pendingContainer.innerHTML = pending.map(t => `
        <div class="task-item">
            <strong>${t.title}</strong><br>
            ${t.desc}<br>
            <small>${formatDueStatus(t.due)}</small><br>
            ${t.createdAt ? `<small>Created: ${formatDurationMs(Date.now() - t.createdAt)}</small><br>` : ''}
            <small>Assigned to: ${getUserDisplayName(t.assignedTo)}</small><br>
            <small>Created by: ${getUserDisplayName(t.createdBy)}</small><br>
            <button class="btn btn-sm btn-primary" onclick="completeTask('${t.id}')">Complete</button>
        </div>
    `).join('') || 'None';

    completedContainer.innerHTML = completed.map(t => `
        <div class="task-item">
            ✅ <strong>${t.title}</strong><br>
            ${t.desc}<br>
            <small>${formatDueStatus(t.due)}</small><br>
            ${t.createdAt ? `<small>Created: ${formatDurationMs(Date.now() - t.createdAt)}</small><br>` : ''}
            <small>Assigned to: ${getUserDisplayName(t.assignedTo)}</small><br>
            <small>Created by: ${getUserDisplayName(t.createdBy)}</small>
        </div>
    `).join('') || 'None';
}

function renderMonitor() {
    const container = document.getElementById('monitor-list');
    if (!container) return;
    const monitorReminders = reminders.filter(r => Array.isArray(r.cc) && r.cc.includes(currentUser.userId));
    const monitorTasks = tasks.filter(t => Array.isArray(t.cc) && t.cc.includes(currentUser.userId));
    const monitorLeads = leads.filter(l => Array.isArray(l.cc) && l.cc.includes(currentUser.userId));
    
    const remindersHtml = monitorReminders.length ? `
        <h4>CC Reminders</h4>
        ${monitorReminders.map(r => `
            <div class="rem-item">
                <strong>${r.title}</strong><br>
                ${r.desc}<br>
                ${r.leadName ? `<small>Lead: ${r.leadName}</small><br>` : ''}
                <small>${formatDueStatus(r.due)}</small><br>
                <small>Created by: ${getUserDisplayName(r.createdBy)}</small><br>
                ${r.assignedTo ? `<small>Assigned to: ${Array.isArray(r.assignedTo) ? r.assignedTo.map(getUserDisplayName).join(', ') : getUserDisplayName(r.assignedTo)}</small><br>` : ''}
                ${r.cc?.length ? `<small>CC: ${r.cc.map(getUserDisplayName).join(', ')}</small><br>` : ''}
                ${r.type === 'department' ? `<small>Department: ${r.department}</small><br>` : ''}
                <button class="btn btn-sm btn-primary" onclick="completeReminder('${r.id}')">Mark Done</button>
            </div>
        `).join('')}
    ` : '';
    
    const tasksHtml = monitorTasks.length ? `
        <h4>CC Tasks</h4>
        ${monitorTasks.map(t => `
            <div class="rem-item">
                <strong>${t.title}</strong><br>
                ${t.desc}<br>
                <small>Due: ${t.due ? new Date(t.due).toLocaleDateString() : 'No due date'}</small><br>
                <small>Assigned to: ${getUserDisplayName(t.assignedTo)}</small><br>
                <small>Created by: ${getUserDisplayName(t.createdBy)}</small><br>
                ${t.cc?.length ? `<small>CC: ${t.cc.map(getUserDisplayName).join(', ')}</small><br>` : ''}
            </div>
        `).join('')}
    ` : '';
    
    const leadsHtml = monitorLeads.length ? `
        <h4>CC Leads</h4>
        ${monitorLeads.map(l => `
            <div class="rem-item">
                <strong>${l.name} (${l.loanType})</strong><br>
                <small>Phone: ${l.phone}</small><br>
                <small>Status: ${badge(l.status)}</small><br>
                <small>Assigned to: ${Array.isArray(l.assignedCSOs) && l.assignedCSOs.length ? l.assignedCSOs.map(getUserDisplayName).join(', ') : 'Unassigned'}</small><br>
                <small>Created by: ${getUserDisplayName(l.createdBy)}</small><br>
                ${l.cc?.length ? `<small>CC: ${l.cc.map(getUserDisplayName).join(', ')}</small><br>` : ''}
                <button class="btn btn-sm btn-info" onclick="viewLead('${l.id}')">View Lead</button>
            </div>
        `).join('')}
    ` : '';
    
    container.innerHTML = remindersHtml + tasksHtml + leadsHtml || '<div>No items assigned to you for monitoring.</div>';
}

function renderEscalations() {
    const container = document.getElementById('escalations-list');
    if (!container) return;
    const escList = getVisibleEscalations();
    const leadOptions = leads.map(l => `<option value="${l.id}">${l.name} (${l.loanType})</option>`).join('');
    const userOptions = users.map(u => `<option value="${u.userId}">${u.displayName} (${u.role})</option>`).join('');

    container.innerHTML = `
        <div class="panel-body" style="margin-bottom:16px;">
            <button class="btn btn-primary" onclick="openCreateEscalation()">+ Add Escalation</button>
        </div>
        ${escList.length ? escList.map(e => {
            const messageCount = e.messages
                ? (Array.isArray(e.messages)
                    ? e.messages.filter(Boolean).length
                    : Object.values(e.messages).filter(Boolean).length)
                : 0;
            return `
            <div class="rem-item">
                <strong>Lead:</strong> ${e.leadName || 'Unknown'}<br>
                <strong>Reason:</strong> ${e.reason}<br>
                <small>Escalated by: ${getUserDisplayName(e.createdBy)}</small><br>
                <small>Assigned to: ${getUserDisplayName(e.assignedTo)}</small><br>
                <small>Status: ${e.status || 'open'}</small><br>
                <small>Sent: ${new Date(e.createdAt).toLocaleString()}</small><br>
                <small>Messages: ${messageCount}</small><br>
                <button class="btn btn-sm btn-info" onclick="viewEscalation('${e.id}')">Open Chat</button>
                <button class="btn btn-sm" onclick="viewLead('${e.leadId}')">View Lead</button>
            </div>
        `;
        }).join('') : '<div>No escalations yet</div>'}
    `;
}

function openCreateEscalation() {
    const leadOptions = leads.map(l => `<option value="${l.id}">${l.name} (${l.loanType})</option>`).join('');
    const userOptions = users.map(u => `<option value="${u.userId}">${u.displayName} (${u.role})</option>`).join('');
    openModal('Create Escalation', `
        <div class="fg"><label>Select Lead</label><select id="escalationLead">${leadOptions}</select></div>
        <div class="fg"><label>Select Person</label><select id="escalationPerson">${userOptions}</select></div>
        <div class="fg"><label>Escalation Reason</label><textarea id="escalationReason" rows="3"></textarea></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveEscalation()">Send Escalation</button>
    `);
}

async function saveEscalation() {
    const leadId = document.getElementById('escalationLead')?.value;
    const assignedTo = document.getElementById('escalationPerson')?.value;
    const reason = document.getElementById('escalationReason')?.value.trim();
    if (!leadId || !assignedTo || !reason) {
        toast('Lead, person and reason are required', 'error');
        return;
    }
    const lead = leads.find(l => l.id === leadId);
    const escalationRef = escalationsRef.push();
    const escalation = {
        leadId,
        leadName: lead?.name || 'Unknown',
        assignedTo,
        reason,
        status: 'open',
        createdBy: currentUser.userId,
        createdAt: Date.now()
    };
    await escalationRef.set(escalation);
    await escalationRef.child('messages').push({
        senderId: currentUser.userId,
        text: reason,
        createdAt: Date.now()
    });
    toast('Escalation sent', 'success');
    closeModal();
    if (currentPage === 'escalations') renderEscalations();
}

function getEscalationMessages(escalation) {
    if (!escalation || !escalation.messages) return [];
    const messages = Array.isArray(escalation.messages)
        ? escalation.messages.filter(Boolean)
        : Object.values(escalation.messages).filter(Boolean);
    return messages.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;')
        .replace(/\n/g, '<br>');
}

function viewEscalation(escalationId) {
    const escalation = escalations.find(e => e.id === escalationId);
    if (!escalation) {
        toast('Escalation not found', 'error');
        return;
    }
    const messages = getEscalationMessages(escalation);
    const messageHtml = messages.map(msg => {
        const sender = getUserDisplayName(msg.senderId);
        const time = msg.createdAt ? new Date(msg.createdAt).toLocaleString() : '';
        return `
            <div class="escalation-chat-message">
                <div class="escalation-chat-sender">${sender} <span>${time}</span></div>
                <div class="escalation-chat-body">${escapeHtml(msg.text)}</div>
            </div>
        `;
    }).join('') || '<div class="escalation-chat-empty">No updates yet.</div>';

    const body = `
        <div class="report-detail-grid">
            <div class="report-detail-card">
                <div class="report-detail-title">Escalation Details</div>
                <div class="report-detail-line"><strong>Lead:</strong> ${escalation.leadName || 'Unknown'}</div>
                <div class="report-detail-line"><strong>Assigned to:</strong> ${getUserDisplayName(escalation.assignedTo)}</div>
                <div class="report-detail-line"><strong>Opened by:</strong> ${getUserDisplayName(escalation.createdBy)}</div>
                <div class="report-detail-line"><strong>Status:</strong> ${escalation.status || 'open'}</div>
                <div class="report-detail-line"><strong>Reason:</strong> ${escapeHtml(escalation.reason)}</div>
                <div class="report-detail-line"><strong>Created:</strong> ${new Date(escalation.createdAt).toLocaleString()}</div>
            </div>
            <div class="report-detail-card" style="grid-column: span 2;">
                <div class="report-detail-subtitle">Escalation Chat</div>
                <div class="escalation-chat-window">${messageHtml}</div>
            </div>
            <div class="report-detail-card report-detail-list" style="grid-column: span 2;">
                <div class="report-detail-subtitle">Add update</div>
                <textarea id="escalationReply" rows="4" class="textarea"></textarea>
            </div>
        </div>
    `;
    openModal(`Escalation: ${escalation.leadName}`, body, `
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="saveEscalationReply('${escalationId}')">Send update</button>
    `);
}

async function saveEscalationReply(escalationId) {
    const text = document.getElementById('escalationReply')?.value.trim();
    if (!text) {
        toast('Please enter an update message', 'error');
        return;
    }
    const messagesRef = rtdb.ref(`escalations/${escalationId}/messages`);
    await messagesRef.push({
        senderId: currentUser.userId,
        text,
        createdAt: Date.now()
    });
    toast('Escalation update posted', 'success');
    viewEscalation(escalationId);
}

function getEmployeeStats(userId) {
    const created = leads.filter(l => l.createdBy === userId);
    const assigned = leads.filter(l => l.assignedTo === userId || (Array.isArray(l.assignedCSOs) && l.assignedCSOs.includes(userId)));
    const employeeLeads = Array.from(new Set([...created, ...assigned]));
    const completed = employeeLeads.filter(l => l.status === 'disbursed');
    const openEscalations = escalations.filter(e => e.assignedTo === userId || e.createdBy === userId).length;
    const pendingTasks = tasks.filter(t => t.assignedTo === userId && t.status !== 'completed').length;
    const remindersCount = reminders.filter(r => r.assignedTo === userId || r.createdBy === userId).length;
    return {
        created: created.length,
        assigned: assigned.length,
        completed: completed.length,
        openEscalations,
        pendingTasks,
        remindersCount,
        createdLeads: created,
        assignedLeads: assigned,
        employeeLeads
    };
}

function formatHoursLabel(hours) {
    if (!Number.isFinite(hours) || hours <= 0) return '0h';
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    if (h === 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function getEmployeeStagePerformance(userId) {
    const employeeLeads = leads.filter(l => l.createdBy === userId || l.assignedTo === userId || (Array.isArray(l.assignedCSOs) && l.assignedCSOs.includes(userId)));
    const stages = STATUSES.map(s => s.l);
    const values = STATUSES.map(status => {
        const durations = employeeLeads.map(lead => {
            const stage = getLeadStageDurations(lead).find(item => item.stage === status.k);
            return stage ? stage.hours : null;
        }).filter(v => v !== null);
        return durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0;
    });
    return {
        stages,
        values,
        leadCount: employeeLeads.length
    };
}

function viewEmployeeStats(userId) {
    const user = users.find(u => u.userId === userId) || { displayName: userId };
    const stats = getEmployeeStats(userId);
    const perf = getEmployeeStagePerformance(userId);
    const stageRows = perf.stages.map((stageLabel, idx) => `
                    <div class="report-stage-row">${stageLabel}: ${formatHoursLabel(perf.values[idx])}</div>
                `).join('') || '<div class="report-detail-item">No stage time data available</div>';
    const body = `
        <div class="report-detail-grid">
            <div class="report-detail-card">
                <div class="report-detail-title">${user.displayName}</div>
                <div class="report-detail-line">Created Leads: ${stats.created}</div>
                <div class="report-detail-line">Assigned Leads: ${stats.assigned}</div>
                <div class="report-detail-line">Completed: ${stats.completed}</div>
                <div class="report-detail-line">Open Escalations: ${stats.openEscalations}</div>
                <div class="report-detail-line">Pending Tasks: ${stats.pendingTasks}</div>
                <div class="report-detail-line">Reminders: ${stats.remindersCount}</div>
                <div class="report-detail-line">Leads Included: ${perf.leadCount}</div>
            </div>
            <div class="report-detail-card report-detail-list">
                <div class="report-detail-subtitle">Stage average time</div>
                ${stageRows}
            </div>
            <div class="report-detail-card report-detail-list">
                <div class="report-detail-subtitle">Recent Created Leads</div>
                ${stats.createdLeads.slice(-5).map(l => `
                    <div class="report-detail-item">${l.name} — ${badge(l.status)} ${getLeadDuration(l)}</div>
                `).join('') || '<div class="report-detail-item">No created leads yet</div>'}
            </div>
            <div class="report-detail-card report-detail-list">
                <div class="report-detail-subtitle">Recent Assigned Leads</div>
                ${stats.assignedLeads.slice(-5).map(l => `
                    <div class="report-detail-item">${l.name} — ${badge(l.status)} ${getLeadDuration(l)}</div>
                `).join('') || '<div class="report-detail-item">No assigned leads yet</div>'}
            </div>
            <div class="report-detail-card">
                <div class="report-detail-subtitle">Stage timing chart</div>
                <canvas id="employeeStageChart" height="180"></canvas>
            </div>
        </div>
    `;
    openModal(`Employee report: ${user.displayName}`, body, '<button class="btn btn-primary" onclick="closeModal()">Close</button>');
    if (employeeChartInstance) employeeChartInstance.destroy();
    const ctx = document.getElementById('employeeStageChart')?.getContext('2d');
    if (ctx) {
        employeeChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: perf.stages,
                datasets: [{
                    label: 'Avg hours per stage',
                    data: perf.values.map(v => parseFloat(v.toFixed(1))),
                    backgroundColor: '#1f77b4'
                }]
            },
            options: {
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Hours' }
                    }
                },
                plugins: {
                    legend: { display: false }
                }
            }
        });
    }
}

function renderReports() {
    if (chartInstance) chartInstance.destroy();
    const ctx = document.getElementById('stageChart')?.getContext('2d');
    if (!ctx) return;
    const stages = STATUSES.map(s => s.l);
    const avgTimes = stages.map((_, idx) => {
        const stageKey = STATUSES[idx].k;
        const times = leads.map(l => {
            const hist = l.history || [];
            const enter = hist.find(h => h.s === stageKey);
            const exit = hist.find(h => STATUSES.findIndex(s => s.k === h.s) > idx);
            if (enter && exit) return (new Date(exit.d).getTime() - new Date(enter.d).getTime()) / (1000 * 3600);
            return null;
        }).filter(t => t !== null);
        return times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(1) : 0;
    });
    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stages,
            datasets: [{ label: 'Avg Hours', data: avgTimes, backgroundColor: '#f5a623' }]
        }
    });

    const employeeStats = document.getElementById('employee-stats');
    if (employeeStats) {
        employeeStats.innerHTML = users.map(u => {
            const stats = getEmployeeStats(u.userId);
            return `
                <div class="stat-card" onclick="viewEmployeeStats('${u.userId}')">
                    <div class="stat-card-label">${u.displayName}</div>
                    <div class="stat-card-value">${stats.created}</div>
                    <div class="stat-card-label">created</div>
                    <div class="report-user-summary">Assigned ${stats.assigned} · Completed ${stats.completed}</div>
                </div>
            `;
        }).join('');
    }
}

function renderPipeline() {
    const container = document.getElementById('pipeline-kanban');
    if (!container) return;
    const groups = {};
    STATUSES.forEach(s => groups[s.k] = getVisibleLeads().filter(l => l.status === s.k));
    container.innerHTML = STATUSES.map(s => `
        <div class="kan-col">
            <div class="kan-col-hd">${s.l} <span class="kan-cnt">${groups[s.k].length}</span></div>
            ${groups[s.k].map(l => `
                <div class="kan-card" onclick="viewLead('${l.id}')">
                    <div class="kan-name">${l.name}</div>
                    <div class="kan-meta">${l.loanType}</div>
                    <div class="kan-meta">${getStat(l.status).l} · ${getLeadDuration(l)}</div>
                </div>
            `).join('')}
            ${!groups[s.k].length ? '<div class="kan-empty">—</div>' : ''}
        </div>
    `).join('');
}

function getPageLabel(page) {
    return page.split('-').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

function renderAdminPanel() {
    const container = document.getElementById('admin-panel-body');
    if (!container) return;
    const rows = users.map(u => `
        <div class="admin-user-card">
            <div><strong>${u.displayName}</strong> (${u.role})</div>
            <div>Dept: ${u.department || 'N/A'}</div>
            <div>Lead access: ${u.permissions?.canViewLeads === false ? 'No' : 'Yes'}</div>
            <div>Pages: ${(u.permissions?.pageAccess || []).join(', ')}</div>
            <button class="btn btn-sm btn-primary" onclick="openEditUserPermissions('${u.userId}')">Edit</button>
        </div>
    `).join('');
    container.innerHTML = `
        <div style="margin-bottom:16px; display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn btn-primary" onclick="openAddUser()">+ Add User</button>
        </div>
        ${rows || '<div>No users found</div>'}
    `;
}

function openEditUserPermissions(userId) {
    const user = users.find(u => u.userId === userId);
    if (!user) return;
    const pageCheckboxes = MENU_PAGES.map(page => `
        <label><input type="checkbox" value="${page}" ${user.permissions?.pageAccess?.includes(page) ? 'checked' : ''}> ${getPageLabel(page)}</label><br>
    `).join('');
    openModal(`Edit user: ${user.displayName}`, `
        <div class="fg"><label>User ID</label><input value="${user.userId}" disabled></div>
        <div class="fg"><label>Display Name</label><input id="permDisplayName" value="${user.displayName}"></div>
        <div class="fg"><label>Password</label><input id="permPassword" placeholder="Leave blank to keep current password"></div>
        <div class="fg"><label>Role</label><select id="permRole">
            ${['admin', 'cso', 'cse', 'msme_head', 'retail_head', 'bank_follow_officer', 'legal_officer'].map(role => `<option value="${role}" ${user.role === role ? 'selected' : ''}>${role}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Department</label><input id="permDepartment" value="${user.department || ''}"></div>
        <div class="fg"><label><input type="checkbox" id="permCanViewLeads" ${user.permissions?.canViewLeads !== false ? 'checked' : ''}> Can view leads</label></div>
        <div class="fg"><label>Allowed Pages</label><div id="permPages">${pageCheckboxes}</div></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveUserPermissions('${userId}')">Save</button>
    `);
}

async function saveUserPermissions(userId) {
    const displayName = document.getElementById('permDisplayName')?.value.trim();
    const password = document.getElementById('permPassword')?.value.trim();
    const role = document.getElementById('permRole')?.value;
    const department = document.getElementById('permDepartment')?.value.trim();
    const canViewLeads = document.getElementById('permCanViewLeads')?.checked;
    const selectedPages = [...document.querySelectorAll('#permPages input[type="checkbox"]:checked')].map(cb => cb.value);
    if (!displayName || !role) {
        toast('Please fill in display name and role', 'error');
        return;
    }
    const permissions = {
        canViewLeads: canViewLeads,
        pageAccess: selectedPages.length ? selectedPages : [...DEFAULT_PAGE_ACCESS]
    };
    const updateData = { displayName, role, department, permissions };
    if (password) updateData.password = password;
    await usersRef.child(userId).update(updateData);
    toast('User permissions updated', 'success');
    closeModal();
    if (currentPage === 'admin-panel') renderAdminPanel();
    if (currentUser.userId === userId) {
        currentUser = { userId, displayName, role, department, permissions };
        sessionStorage.setItem('crmUser', JSON.stringify(currentUser));
        buildSidebar();
    }
}

function openAddUser() {
    const pageCheckboxes = MENU_PAGES.map(page => `
        <label><input type="checkbox" value="${page}" ${DEFAULT_PAGE_ACCESS.includes(page) ? 'checked' : ''}> ${getPageLabel(page)}</label><br>
    `).join('');
    openModal('Add New User', `
        <div class="fg"><label>User ID</label><input id="newUserId" placeholder="user id"></div>
        <div class="fg"><label>Display Name</label><input id="newDisplayName"></div>
        <div class="fg"><label>Password</label><input id="newPassword" type="password"></div>
        <div class="fg"><label>Role</label><select id="newRole">
            ${['admin', 'cso', 'cse', 'msme_head', 'retail_head', 'bank_follow_officer', 'legal_officer'].map(role => `<option value="${role}">${role}</option>`).join('')}
        </select></div>
        <div class="fg"><label>Department</label><input id="newDepartment"></div>
        <div class="fg"><label><input type="checkbox" id="newCanViewLeads" checked> Can view leads</label></div>
        <div class="fg"><label>Allowed Pages</label><div id="newPermPages">${pageCheckboxes}</div></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveNewUser()">Create</button>
    `);
}

async function saveNewUser() {
    const userId = document.getElementById('newUserId')?.value.trim();
    const displayName = document.getElementById('newDisplayName')?.value.trim();
    const password = document.getElementById('newPassword')?.value.trim();
    const role = document.getElementById('newRole')?.value;
    const department = document.getElementById('newDepartment')?.value.trim();
    const canViewLeads = document.getElementById('newCanViewLeads')?.checked;
    const selectedPages = [...document.querySelectorAll('#newPermPages input[type="checkbox"]:checked')].map(cb => cb.value);
    if (!userId || !displayName || !password || !role) {
        toast('Please fill all required fields', 'error');
        return;
    }
    const existing = users.find(u => u.userId === userId);
    if (existing) {
        toast('User ID already exists', 'error');
        return;
    }
    const permissions = {
        canViewLeads: canViewLeads,
        pageAccess: selectedPages.length ? selectedPages : [...DEFAULT_PAGE_ACCESS]
    };
    await usersRef.child(userId).set({ userId, displayName, password, role, department, permissions });
    toast('User created', 'success');
    closeModal();
    if (currentPage === 'admin-panel') renderAdminPanel();
}

// ===================== NAVIGATION =====================
function navToPage(page) {
    if (page === currentPage) return;
    if (!canViewPage(page)) {
        toast('Access denied', 'error');
        return;
    }
    currentPage = page;
    loadPage(page);
    // Update URL hash (optional)
    window.location.hash = page;
}

function updateSidebarActive() {
    document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
    const active = document.querySelector(`.sb-item[data-page="${currentPage}"]`);
    if (active) active.classList.add('active');
}

// ===================== SEARCH =====================
function setupSearch() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput) return;
    searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        if (currentPage === 'all-leads') renderAllLeads();
        else if (currentPage === 'new-leads') renderNewLeads();
        else if (currentPage === 'processing') renderProcessing();
        else if (currentPage === 'tat-breach') renderTatBreach();
        else if (currentPage === 'tat-warning') renderTatWarning();
    });
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (currentPage === 'all-leads') renderAllLeads();
            else if (currentPage === 'new-leads') renderNewLeads();
            else if (currentPage === 'processing') renderProcessing();
            else if (currentPage === 'tat-breach') renderTatBreach();
            else if (currentPage === 'tat-warning') renderTatWarning();
        }
    });
}

// ===================== FIREBASE REAL-TIME LISTENERS =====================
function initRealtime() {
    const refreshCurrentPage = () => {
        if (!currentPage) return;

        if (currentPage === 'dashboard') {
            renderDashboard();
        } else if (currentPage === 'all-leads') {
            renderAllLeads();
        } else if (currentPage === 'new-leads') {
            renderNewLeads();
        } else if (currentPage === 'processing') {
            renderProcessing();
        } else if (currentPage === 'tat-breach') {
            renderTatBreach();
        } else if (currentPage === 'tat-warning') {
            renderTatWarning();
        } else if (currentPage === 'reminders') {
            renderReminders();
        } else if (currentPage === 'tasks') {
            renderTasks();
        } else if (currentPage === 'escalations') {
            renderEscalations();
        } else if (currentPage === 'reports') {
            renderReports();
        } else if (currentPage === 'pipeline') {
            renderPipeline();
        } else if (currentPage === 'workflow') {
            // static content -- no rerender required
        } else {
            loadPage(currentPage);
        }

        updateBadges();
    };

    leadsRef.on('value', snap => {
        const leadData = snap.val() || {};
        leads = Object.entries(leadData).map(([id, v]) => ({ id, ...v }));
        console.log('Firebase leads snapshot received:', leads.length);
        refreshCurrentPage();
        updateNotificationBadge();
    });

    usersRef.on('value', snap => {
        const userData = snap.val() || {};
        users = Object.entries(userData).map(([id, v]) => normalizeUser({ userId: id, ...v }));
        console.log('Firebase users snapshot received:', users.length);
    });

    remindersRef.on('value', snap => {
        const reminderData = snap.val() || {};
        reminders = Object.entries(reminderData).map(([id, v]) => ({ id, ...v }));
        console.log('Firebase reminders snapshot received:', reminders.length);
        if (currentPage === 'reminders') renderReminders();
        updateBadges();
    });

    tasksRef.on('value', snap => {
        const taskData = snap.val() || {};
        tasks = Object.entries(taskData).map(([id, v]) => ({ id, ...v }));
        console.log('Firebase tasks snapshot received:', tasks.length);
        if (currentPage === 'tasks') renderTasks();
        updateBadges();
    });

    escalationsRef.on('value', snap => {
        const escalationData = snap.val() || {};
        escalations = Object.entries(escalationData).map(([id, v]) => ({ id, ...v }));
        console.log('Firebase escalations snapshot received:', escalations.length);
        if (currentPage === 'escalations') renderEscalations();
        updateBadges();
    });

    loanTypesRef.on('value', snap => {
        const loanTypeData = snap.val() || {};
        loanTypes = Array.isArray(loanTypeData) ? loanTypeData.filter(Boolean) : Object.values(loanTypeData).filter(Boolean);
    });
}

// ===================== LEAD DETAIL =====================
async function viewLead(id) {
    const l = leads.find(x => x.id === id);
    if (!l) return;
    currentLeadId = id;
    currentTab = 'details';
    renderLeadModal(l);
}

async function renderLeadModal(l) {
    const timeLogHtml = await buildTimeLog(l);
    const detailsHtml = `
        <div class="lead-modal-grid">
            <div class="lead-modal-panel lead-modal-left">
                <div class="lead-modal-title">Lead Details</div>
                ${renderLeadDetails(l)}
            </div>
            <div class="lead-modal-panel lead-modal-right">
                <div class="lead-modal-title">Time Taken Log</div>
                ${timeLogHtml}
            </div>
        </div>
    `;
    openModal('Lead Details', detailsHtml, `
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-info" onclick="closeModal();openUpdateStatus('${l.id}')">Update Status</button>
        <button class="btn btn-primary" onclick="closeModal();editLead('${l.id}')">Edit</button>
    `);
    renderLeadStageChart(l);
}

function renderLeadDetails(l) {
    const currentStage = getLeadStageDurations(l).find(s => s.isCurrent);
    const assignedNames = Array.isArray(l.assignedCSOs) && l.assignedCSOs.length
        ? l.assignedCSOs.map(getUserDisplayName).join(', ')
        : 'Unassigned';
    return `
        <div class="lead-detail-block">
            <div class="lead-detail-row"><strong>Name</strong><span>${l.name}</span></div>
            <div class="lead-detail-row"><strong>Phone</strong><span>${l.phone}</span></div>
            <div class="lead-detail-row"><strong>Loan</strong><span>${l.loanType}</span></div>
            <div class="lead-detail-row"><strong>Amount</strong><span>₹${l.amount}</span></div>
            <div class="lead-detail-row"><strong>Status</strong><span>${badge(l.status)}</span></div>
            <div class="lead-detail-row"><strong>Current stage</strong><span>${currentStage ? currentStage.label : getStat(l.status).l}</span></div>
            <div class="lead-detail-row"><strong>Time in current stage</strong><span>${getLeadDuration(l)}</span></div>
            <div class="lead-detail-row"><strong>Allocated to</strong><span>${assignedNames}</span></div>
            ${l.profilingData ? `<hr><div class="lead-detail-row lead-detail-block"><strong>Profiling Data</strong></div>
                <div class="lead-detail-row"><strong>Company</strong><span>${l.profilingData.company || '-'}</span></div>
                <div class="lead-detail-row"><strong>Turnover</strong><span>${l.profilingData.turnover || '-'}</span></div>
                <div class="lead-detail-row"><strong>Liabilities</strong><span>${l.profilingData.liabilities || '-'}</span></div>
            ` : ''}
        </div>
    `;
}

function formatTime(timestamp) {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleString();
}

async function buildTimeLog(l) {
    const stages = getLeadStageDurations(l);
    if (!stages.length) {
        return `<div class="time-log-empty">No stage history available.</div>`;
    }

    const rows = stages.map(item => `
        <tr>
            <td>${item.label}</td>
            <td>${item.isCurrent ? 'Current' : 'Completed'}</td>
            <td>${formatDurationMs(item.durationMs)}</td>
            <td>${item.start ? formatTime(item.start) : 'Unknown'}</td>
        </tr>
    `).join('');

    return `
        <div class="time-log-panel">
            <table class="time-log-table">
                <thead>
                    <tr>
                        <th>Stage</th>
                        <th>Status</th>
                        <th>Duration</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
            <div class="time-log-chart-wrap">
                <canvas id="lead-stage-chart-${l.id}" height="200"></canvas>
            </div>
        </div>
    `;
}

function renderLeadStageChart(l) {
    const stages = getLeadStageDurations(l);
    const chartEl = document.getElementById(`lead-stage-chart-${l.id}`);
    if (!chartEl) return;
    if (leadStageChart) {
        leadStageChart.destroy();
        leadStageChart = null;
    }
    const labels = stages.map(item => item.label);
    const data = stages.map(item => Number(item.hours.toFixed(2)));
    leadStageChart = new Chart(chartEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Hours spent',
                data,
                backgroundColor: stages.map(item => item.isCurrent ? '#278cff' : '#f5a623')
            }]
        },
        options: {
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Hours' } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function switchLeadTab(tab) {
    currentTab = tab;
    const l = leads.find(x => x.id === currentLeadId);
    if (l) renderLeadModal(l);
}

// ===================== STATUS UPDATE =====================
function openUpdateStatus(id) {
    const l = leads.find(x => x.id === id);
    openModal('Update Status', `
        <div class="fg">
            <label>New Status</label>
            <select id="newStatus" onchange="toggleProfiling(this.value)">
                ${STATUSES.map(s => `<option value="${s.k}" ${s.k === l.status ? 'selected' : ''}>${s.l}</option>`).join('')}
            </select>
        </div>
        <div id="profilingFields" style="display:none; border-top:1px solid var(--border); margin-top:12px; padding-top:12px;">
            <h4>Detailed Data (Optional)</h4>
            <div class="fg"><label>Company Name</label><input id="profCompany"></div>
            <div class="fg"><label>Annual Turnover (₹)</label><input id="profTurnover"></div>
            <div class="fg"><label>Existing Liabilities</label><textarea id="profLiabilities"></textarea></div>
        </div>
        <div class="fg">
            <label>Remarks</label>
            <textarea id="statusRemarks" rows="2"></textarea>
        </div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="applyStatusWithExtra('${id}')">Update</button>
    `);
    window.toggleProfiling = function (val) {
        const fields = document.getElementById('profilingFields');
        if (fields) fields.style.display = val === 'profiling' ? 'block' : 'none';
    };
    if (l.status === 'profiling') toggleProfiling('profiling');
}

async function applyStatusWithExtra(id) {
    const newStatus = document.getElementById('newStatus').value;
    const remarks = document.getElementById('statusRemarks').value.trim() || '(no remarks)';
    const extra = {};
    if (newStatus === 'profiling') {
        extra.profilingData = {
            company: document.getElementById('profCompany').value,
            turnover: document.getElementById('profTurnover').value,
            liabilities: document.getElementById('profLiabilities').value
        };
    }
    const leadRef = leadsRef.child(id);
    const snap = await leadRef.once('value');
    const lead = snap.val();
    const history = lead.history || [];
    history.push({ s: newStatus, by: currentUser.displayName, d: new Date().toLocaleString(), remarks });
    await leadRef.update({ status: newStatus, history, ...extra });
    closeModal();
    toast('Status updated');
}

// ===================== REMINDERS & TASKS (Create & Complete) =====================
function openCreateReminder() {
    const depts = [...new Set(users.map(u => u.department).filter(d => d))];
    const leadOptions = leads.map(l => `<option value="${l.id}">${l.name} (${l.loanType})</option>`).join('');
    const userOptions = users.map(u => `<option value="${u.userId}">${u.displayName}</option>`).join('');
    const ccOptions = users.map(u => `<label><input type="checkbox" value="${u.userId}"> ${u.displayName}</label><br>`).join('');
    openModal('Create Reminder', `
        <div class="fg"><label>Title</label><input id="remTitle"></div>
        <div class="fg"><label>Description</label><textarea id="remDesc"></textarea></div>
        <div class="fg"><label>Due Date</label><input type="date" id="remDue"></div>
        <div class="fg"><label>Related Lead</label><select id="remLead"><option value="">None</option>${leadOptions}</select></div>
        <div class="fg"><label>Type</label>
            <select id="remType" onchange="toggleReminderAssign(this.value)">
                <option value="person">Person-wise</option>
                <option value="department">Department-wise</option>
                <option value="custom">Custom Selection</option>
            </select>
        </div>
        <div id="remAssignArea">
            <div class="fg"><label>Select Person</label><select id="remPerson">${userOptions}</select></div>
        </div>
        <div class="fg"><label>Monitor (CC Users)</label><div id="remCc">${ccOptions}</div></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveReminder()">Create</button>
    `);
    window.toggleReminderAssign = function (type) {
        const area = document.getElementById('remAssignArea');
        if (type === 'department') {
            area.innerHTML = `<div class="fg"><label>Select Department</label><select id="remDept">${depts.map(d => `<option>${d}</option>`).join('')}</select></div>`;
        } else if (type === 'custom') {
            area.innerHTML = `<div class="fg"><label>Select Users</label><div id="customUsers">${users.map(u => `<label><input type="checkbox" value="${u.userId}"> ${u.displayName}</label><br>`).join('')}</div></div>`;
        } else {
            area.innerHTML = `<div class="fg"><label>Select Person</label><select id="remPerson">${userOptions}</select></div>`;
        }
    };
}

async function saveReminder() {
    const title = document.getElementById('remTitle').value.trim();
    const desc = document.getElementById('remDesc').value.trim();
    const due = document.getElementById('remDue').value;
    const leadId = document.getElementById('remLead').value;
    const type = document.getElementById('remType').value;
    let assignedTo = [];
    let department = null;
    if (type === 'person') assignedTo = [document.getElementById('remPerson').value];
    else if (type === 'department') department = document.getElementById('remDept').value;
    else assignedTo = [...document.querySelectorAll('#customUsers input:checked')].map(cb => cb.value);
    const cc = [...document.querySelectorAll('#remCc input:checked')].map(cb => cb.value);
    if (!title) { toast('Title required', 'error'); return; }
    const reminderData = {
        title,
        desc,
        due,
        leadId: leadId || null,
        leadName: leadId ? (leads.find(l => l.id === leadId)?.name || '') : null,
        type,
        assignedTo,
        department,
        cc,
        createdBy: currentUser.userId,
        createdAt: Date.now()
    };
    await remindersRef.push(reminderData);
    closeModal();
    toast('Reminder created');
}

function openCreateTask() {
    const ccOptions = users.map(u => `<label><input type="checkbox" value="${u.userId}"> ${u.displayName}</label><br>`).join('');
    openModal('Create Task', `
        <div class="fg"><label>Title</label><input id="taskTitle"></div>
        <div class="fg"><label>Description</label><textarea id="taskDesc"></textarea></div>
        <div class="fg"><label>Due Date</label><input type="date" id="taskDue"></div>
        <div class="fg"><label>Assign to</label><select id="taskAssign">${users.map(u => `<option value="${u.userId}">${u.displayName}</option>`).join('')}</select></div>
        <div class="fg"><label>Monitor (CC Users)</label><div id="taskCc">${ccOptions}</div></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveTask()">Create</button>
    `);
}

async function saveTask() {
    const title = document.getElementById('taskTitle').value;
    const desc = document.getElementById('taskDesc').value;
    const due = document.getElementById('taskDue').value;
    const assignedTo = document.getElementById('taskAssign').value;
    
    // Collect CC users
    const ccCheckboxes = document.querySelectorAll('#taskCc input[type="checkbox"]:checked');
    const ccUsers = Array.from(ccCheckboxes).map(cb => cb.value);
    
    if (!title) { toast('Title required', 'error'); return; }
    await tasksRef.push({ title, desc, due, assignedTo, cc: ccUsers, status: 'pending', createdBy: currentUser.userId, createdAt: Date.now() });
    closeModal();
    toast('Task created');
}

async function completeReminder(id) {
    await remindersRef.child(id).remove();
    toast('Reminder done');
}

async function completeTask(id) {
    await tasksRef.child(id).update({ status: 'completed' });
    toast('Task completed');
}

// ===================== ADD/EDIT LEAD =====================
function renderLoanTypeDatalist() {
    return `<datalist id="loanTypeList">${loanTypes.map(type => `<option value="${type}"></option>`).join('')}</datalist>`;
}

function addLoanType() {
    const value = document.getElementById('newLoanType')?.value.trim();
    if (!value) { toast('Enter loan type name', 'error'); return; }
    if (loanTypes.includes(value)) { toast('Loan type already exists', 'error'); return; }
    const key = value.replace(/\s+/g, '_');
    loanTypesRef.child(key).set(value);
    loanTypes.push(value);
    const dataList = document.getElementById('loanTypeList');
    if (dataList) {
        dataList.innerHTML += `<option value="${value}"></option>`;
    }
    toast('Loan type added', 'success');
    document.getElementById('newLoanType').value = '';
}

function openAddLead() {
    const loanTypeOptions = loanTypes.map(type => `<option value="${type}">${type}</option>`).join('');
    const csoOptions = users.filter(u => u.role === 'cso').map(u => `<option value="${u.userId}">${u.displayName}</option>`).join('');
    const ccOptions = users.map(u => `<label><input type="checkbox" value="${u.userId}"> ${u.displayName}</label><br>`).join('');
    const adminLoanField = currentUser?.role === 'admin' ? `
        <div class="fg"><label>Add New Loan Type</label><div style="display:flex;gap:8px;align-items:flex-end;"><input id="newLoanType" placeholder="New loan type"><button class="btn btn-sm btn-info" onclick="addLoanType()">Add</button></div></div>
    ` : '';
    openModal('Add New Lead', `
        <div class="fg-grid">
            <div class="fg fg-full"><label>Name *</label><input id="addName"></div>
            <div class="fg"><label>Phone *</label><input id="addPhone"></div>
            <div class="fg"><label>Loan Type *</label><input id="addLoanType" list="loanTypeList">${renderLoanTypeDatalist()}</div>
            <div class="fg"><label>Amount (₹)</label><input id="addAmount" type="number" value="100000"></div>
            <div class="fg"><label>Category *</label><select id="addCategory"><option>MSME</option><option>Retail</option></select></div>
            <div class="fg"><label>Assign CSO</label><select id="addCso"><option value="">None</option>${csoOptions}</select></div>
            <div class="fg fg-full"><label>Monitor (CC Users)</label><div id="addCc">${ccOptions}</div></div>
            ${adminLoanField}
        </div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveLead()">Save</button>
    `);
}

async function saveLead() {
    const saveButton = document.querySelector('#modal .modal-ft .btn-primary');
    const cancelButton = document.querySelector('#modal .modal-ft .btn-ghost');
    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.innerText = 'Saving...';
        }
        if (cancelButton) cancelButton.disabled = true;

        const name = document.getElementById('addName').value.trim();
        const phone = document.getElementById('addPhone').value.trim();
        const loanType = document.getElementById('addLoanType').value.trim();
        const amount = parseFloat(document.getElementById('addAmount').value) || 100000;
        const category = document.getElementById('addCategory').value;
        const csoId = document.getElementById('addCso').value;

        // Collect CC users
        const ccCheckboxes = document.querySelectorAll('#addCc input[type="checkbox"]:checked');
        const ccUsers = Array.from(ccCheckboxes).map(cb => cb.value);

        if (!name || !phone || !loanType) {
            toast('Name, Phone and Loan Type are required', 'error');
            throw new Error('Validation failed: required fields missing');
        }

        const assignedCSOs = csoId ? [csoId] : [];
        const visibleTo = [
            ...(category === 'MSME' ? users.filter(u => u.role === 'msme_head').map(u => u.userId) : []),
            ...(category === 'Retail' ? users.filter(u => u.role === 'retail_head').map(u => u.userId) : [])
        ].filter(Boolean);

        const leadData = {
            name,
            phone,
            loanType,
            amount,
            category,
            assignedCSOs,
            visibleTo,
            cc: ccUsers,
            status: 'new',
            tat: 0,
            createdBy: currentUser.userId,
            created: new Date().toISOString(),
            history: [{ status: 'new', by: currentUser.displayName, date: new Date().toISOString(), s: 'new', d: new Date().toLocaleString(), remarks: 'Created' }]
        };

        console.log('Attempting to save lead', leadData);
        const newLeadRef = await leadsRef.push(leadData);
        if (!newLeadRef || !newLeadRef.key) {
            throw new Error('Firebase push did not return a valid key');
        }

        await newLeadRef.update({ id: newLeadRef.key });
        console.log('Lead saved successfully', newLeadRef.key);

        toast('Lead added successfully', 'success');
        closeModal();
        navToPage('all-leads');
    } catch (error) {
        console.error('saveLead error:', error);
        if (error.message && error.message !== 'Validation failed: required fields missing') {
            toast(`Save failed: ${error.message}`, 'error');
        }
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.innerText = 'Save';
        }
        if (cancelButton) cancelButton.disabled = false;
    }
}

function editLead(id) {
    toast('Edit feature available in lead view');
}

// ===================== SIDEBAR =====================
function buildSidebar() {
    const menu = [
        { page: 'dashboard', icon: 'fas fa-home', label: 'Dashboard' },
        { page: 'all-leads', icon: 'fas fa-users', label: 'All Leads' },
        { page: 'new-leads', icon: 'fas fa-plus-circle', label: 'New Leads' },
        { page: 'processing', icon: 'fas fa-cogs', label: 'Processing' },
        { page: 'tat-breach', icon: 'fas fa-exclamation-triangle', label: 'TAT Breach' },
        { page: 'tat-warning', icon: 'fas fa-clock', label: 'TAT Warning' },
        { page: 'reminders', icon: 'fas fa-bell', label: 'Reminders', badge: 'nb-rem' },
        { page: 'monitor', icon: 'fas fa-eye', label: 'Monitor' },
        { page: 'tasks', icon: 'fas fa-tasks', label: 'Tasks', badge: 'nb-tasks' },
        { page: 'escalations', icon: 'fas fa-arrow-up', label: 'Escalations', badge: 'nb-esc' },
        { page: 'reports', icon: 'fas fa-chart-line', label: 'Reports' },
        { page: 'pipeline', icon: 'fas fa-project-diagram', label: 'Pipeline' },
        { page: 'workflow', icon: 'fas fa-diagram-project', label: 'Workflow' }
    ];
    if (currentUser?.role === 'admin') {
        menu.push({ page: 'admin-panel', icon: 'fas fa-user-shield', label: 'Admin Panel' });
    }
    let html = `
        <div class="sb-logo">
            <i class="fas fa-chart-line"></i>
            <span>CRM LOANITOL</span>
        </div>
        <div class="role-display">
            <div>${currentUser?.displayName || 'User'}</div>
            <div class="role-name">${currentUser?.role || ''}</div>
        </div>
        <div class="sb-section">
    `;
    menu.forEach(m => {
        html += `<div class="sb-item" data-page="${m.page}" onclick="navToPage('${m.page}')">
                    <i class="${m.icon}"></i>
                    <span>${m.label}</span>
                    ${m.badge ? `<span class="sb-badge" id="${m.badge}">0</span>` : ''}
                 </div>`;
    });
    html += `</div>`;
    document.getElementById('sidebar').innerHTML = html;
}

// ===================== LOGIN & SEED =====================
async function login() {
    const userId = document.getElementById('loginId').value.trim();
    const pwd = document.getElementById('loginPassword').value.trim();
    const snap = await usersRef.child(userId).once('value');
    const user = snap.val();
    if (!user || user.password !== pwd) {
        document.getElementById('loginError').innerText = 'Invalid credentials';
        return;
    }
    const normalizedUser = normalizeUser({ userId, ...user });
    currentUser = { userId, displayName: normalizedUser.displayName, role: normalizedUser.role, department: normalizedUser.department, permissions: normalizedUser.permissions };
    sessionStorage.setItem('crmUser', JSON.stringify(currentUser));
    document.getElementById('loginContainer').style.display = 'none';
    document.getElementById('appContainer').classList.remove('hidden');
    buildSidebar();
    initRealtime();
    setupSearch();
    document.getElementById('newLeadBtn')?.addEventListener('click', openAddLead);
    // Load initial page
    const hash = window.location.hash.slice(1);
    const startPage = hash && MENU_PAGES.includes(hash) ? hash : 'dashboard';
    loadPage(startPage);
}

function logout() {
    sessionStorage.clear();
    location.reload();
}

async function seedDemoData() {
    const usersSnap = await usersRef.once('value');
    if (!usersSnap.exists()) {
        await usersRef.set({
            admin: { userId: 'admin', displayName: 'Admin User', password: 'admin123', role: 'admin', department: 'admin', permissions: getDefaultPermissions('admin') },
            cso1: { userId: 'cso1', displayName: 'Ravi Kumar', password: 'pass', role: 'cso', department: 'msme', permissions: getDefaultPermissions('cso') },
            cso2: { userId: 'cso2', displayName: 'Priya Sharma', password: 'pass', role: 'cso', department: 'retail', permissions: getDefaultPermissions('cso') },
            head1: { userId: 'head1', displayName: 'MSME Head', password: 'pass', role: 'msme_head', department: 'msme', permissions: getDefaultPermissions('msme_head') },
            bank1: { userId: 'bank1', displayName: 'Bank Follow Officer', password: 'pass', role: 'bank_follow_officer', department: 'common', permissions: getDefaultPermissions('bank_follow_officer') },
            legal1: { userId: 'legal1', displayName: 'Legal Officer', password: 'pass', role: 'legal_officer', department: 'legal', permissions: getDefaultPermissions('legal_officer') }
        });
    }
    const leadsSnap = await leadsRef.once('value');
    if (!leadsSnap.exists()) {
        await leadsRef.push({
            name: 'Amit Patel', phone: '9876543210', loanType: 'Home Loan', amount: 5000000, category: 'MSME',
            status: 'new', tat: 0, createdBy: 'cso1', assignedCSOs: ['cso1'], visibleTo: ['head1'],
            history: [{ s: 'new', by: 'Ravi Kumar', d: new Date().toLocaleString(), remarks: 'Lead created' }]
        });
        await leadsRef.push({
            name: 'Neha Gupta', phone: '9123456789', loanType: 'LAP', amount: 2500000, category: 'Retail',
            status: 'profiling', tat: 1, createdBy: 'cso2', assignedCSOs: ['cso2'], visibleTo: [],
            history: [
                { s: 'new', by: 'Priya Sharma', d: new Date().toLocaleString() },
                { s: 'profiling', by: 'Priya Sharma', d: new Date().toLocaleString(), remarks: 'Profiling started' }
            ]
        });
    }
    const loanTypesSnap = await loanTypesRef.once('value');
    if (!loanTypesSnap.exists()) {
        await loanTypesRef.set(['Home Loan', 'LAP', 'MSME Loan', 'Personal Loan', 'Business Loan']);
    }
}

// ===================== NOTIFICATIONS =====================
function updateNotificationBadge() {
    const newLeads = leads.filter(l => l.status === 'new').length;
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        badge.innerText = newLeads;
        badge.style.display = newLeads > 0 ? 'flex' : 'none';
    }
}

function toggleNotifications() {
    navToPage('new-leads');
}

function renderNotifications() {
    const list = document.getElementById('notificationList');
    if (!list) return;
    const newLeads = leads.filter(l => l.status === 'new');
    list.innerHTML = newLeads.map(l => `
        <div class="notification-item" onclick="viewLead('${l.id}'); toggleNotifications();">
            <div class="notification-item-title">New Lead: ${l.name}</div>
            <div class="notification-item-desc">${l.loanType} - ${l.phone}</div>
        </div>
    `).join('') || '<div class="notification-item">No new leads</div>';
}

// ===================== REASSIGN LEAD =====================
function openReassignModal(leadId) {
    const lead = leads.find(l => l.id === leadId);
    if (!lead) return;
    const userOptions = users.map(u => `<option value="${u.userId}">${u.displayName} (${u.role})</option>`).join('');
    openModal('Reassign Lead', `
        <div class="fg"><label>Lead</label><input value="${lead.name} (${lead.loanType})" disabled></div>
        <div class="fg"><label>Assign to</label><select id="reassignUser">${userOptions}</select></div>
        <div class="fg"><label>Or Resign (unassign)</label><input type="checkbox" id="resignLead"></div>
    `, `
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="reassignLead('${leadId}')">Reassign</button>
    `);
}

async function reassignLead(leadId) {
    const userId = document.getElementById('reassignUser').value;
    const resign = document.getElementById('resignLead').checked;
    const leadRef = leadsRef.child(leadId);
    if (resign) {
        await leadRef.update({ assignedCSOs: [] });
        toast('Lead resigned', 'success');
    } else {
        await leadRef.update({ assignedCSOs: [userId] });
        toast('Lead reassigned', 'success');
    }
    closeModal();
}

// ===================== INIT =====================
window.onload = async () => {
    await seedDemoData();
    const saved = sessionStorage.getItem('crmUser');
    if (saved) {
        currentUser = JSON.parse(saved);
        document.getElementById('loginContainer').style.display = 'none';
        document.getElementById('appContainer').classList.remove('hidden');
        buildSidebar();
        initRealtime();
        setupSearch();
        document.getElementById('newLeadBtn')?.addEventListener('click', openAddLead);
        const hash = window.location.hash.slice(1);
        const startPage = hash && MENU_PAGES.includes(hash) ? hash : 'dashboard';
        loadPage(startPage);
    } else {
        document.getElementById('loginContainer').style.display = 'flex';
    }

    document.addEventListener('click', closeAllDropdowns);

    // Expose global functions
    window.navToPage = navToPage;
    window.viewLead = viewLead;
    window.openUpdateStatus = openUpdateStatus;
    window.openCreateReminder = openCreateReminder;
    window.openCreateTask = openCreateTask;
    window.completeReminder = completeReminder;
    window.completeTask = completeTask;
    window.switchLeadTab = switchLeadTab;
    window.editLead = editLead;
    window.openAddLead = openAddLead;
    window.openCreateEscalation = openCreateEscalation;
    window.saveEscalation = saveEscalation;
    window.closeModal = closeModal;
    window.closeOverlay = closeOverlay;
    window.setDashboardFilter = (type) => {
        dashboardFilter = type === 'total' ? null : 'new';
        searchQuery = '';
        document.getElementById('searchInput').value = '';
        navToPage('all-leads');
    };
    window.toggleProfiling = (val) => { };
    window.toggleReminderAssign = (type) => { };
};