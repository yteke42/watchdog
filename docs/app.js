/* ================================================
   PC Monitor Dashboard — Main Application Logic
   ================================================ */

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM References
const loginScreen = document.getElementById('login-screen');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const pcGrid = document.getElementById('pc-grid');
const onlineCount = document.getElementById('online-count');
const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('logout-btn');
const logModal = document.getElementById('log-modal');
const logModalTitle = document.getElementById('log-modal-title');
const logContent = document.getElementById('log-content');
const closeLogModal = document.getElementById('close-log-modal');
const loginModal = document.getElementById('login-modal');
const loginModalTitle = document.getElementById('login-modal-title');
const loginPwdInput = document.getElementById('login-password-input');
const sendLoginCmd = document.getElementById('send-login-cmd');
const closeLoginModal = document.getElementById('close-login-modal');
const toastContainer = document.getElementById('toast-container');
const cmdSection = document.getElementById('command-history-section');
const cmdHistory = document.getElementById('command-history');
const closeHistoryBtn = document.getElementById('close-history-btn');

const otherModal = document.getElementById('other-modal');
const otherModalTitle = document.getElementById('other-modal-title');
const closeOtherModalBtn = document.getElementById('close-other-modal');
const otherRightBtn = document.getElementById('other-right-btn');
const otherUpdateBtn = document.getElementById('other-update-btn');

// PC → Region mapping (keys are lowercase for case-insensitive lookup)
const PC_REGION_MAP = {
    'pc1': 'EUW',
    'pc5': 'EUW',
    'pc2': 'TR',
    'pc4': 'TR',
    'pc10': 'TR'
};

function getRegionSuffix(pcName) {
    const region = PC_REGION_MAP[(pcName || '').toLowerCase()];
    return region ? ` (${region})` : '';
}

let refreshTimer = null;
let loginTargetPc = null; // which PC the login modal is for

// ─── AUTH ────────────────────────────────────────────────────────────────────

async function checkAuth() {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
        showDashboard();
    } else {
        showLogin();
    }
}

function showLogin() {
    loginScreen.style.display = 'flex';
    dashboard.style.display = 'none';
    stopAutoRefresh();
}

function showDashboard() {
    loginScreen.style.display = 'none';
    dashboard.style.display = 'block';
    loadDashboard();
    startAutoRefresh();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const pwd = document.getElementById('password').value;

    console.log('[AUTH] Attempting login with:', email);

    loginBtn.disabled = true;
    loginBtn.querySelector('.btn-text').style.display = 'none';
    loginBtn.querySelector('.btn-loading').style.display = 'inline';
    loginError.style.display = 'none';

    try {
        const { data, error } = await sb.auth.signInWithPassword({ email, password: pwd });
        console.log('[AUTH] Login response — data:', data, 'error:', error);

        loginBtn.disabled = false;
        loginBtn.querySelector('.btn-text').style.display = 'inline';
        loginBtn.querySelector('.btn-loading').style.display = 'none';

        if (error) {
            console.error('[AUTH] Login error:', error.message);
            loginError.textContent = error.message;
            loginError.style.display = 'block';
        } else {
            console.log('[AUTH] Login successful, switching to dashboard');
            showDashboard();
        }
    } catch (err) {
        console.error('[AUTH] Unexpected error:', err);
        loginBtn.disabled = false;
        loginBtn.querySelector('.btn-text').style.display = 'inline';
        loginBtn.querySelector('.btn-loading').style.display = 'none';
        loginError.textContent = 'Unexpected error: ' + err.message;
        loginError.style.display = 'block';
    }
});

logoutBtn.addEventListener('click', async () => {
    await sb.auth.signOut();
    showLogin();
});

// ─── DASHBOARD DATA ──────────────────────────────────────────────────────────

async function loadDashboard() {
    try {
        const { data: pcs, error } = await sb
            .from('pc_status')
            .select('*')
            .order('pc_name');

        if (error) throw error;
        renderPcGrid(pcs || []);
    } catch (err) {
        console.error('Failed to load PCs:', err);
        toast('Failed to load dashboard', 'error');
    }
}

function getStatusInfo(pc) {
    if (!pc.is_online) {
        return { class: 'offline', badge: 'badge-offline', label: 'PC Offline', icon: '🔴' };
    }
    return { class: 'online', badge: 'badge-online', label: 'PC Online', icon: '🟢' };
}

function getStateClass(state) {
    if (!state) return '';
    const s = state.toUpperCase();
    if (s === 'IN_GAME' || s === 'LOADING_SCREEN') return 'state-in-game';
    if (s === 'CHAMP_SELECT' || s === 'MATCH_FOUND') return 'state-champ-select';
    if (s === 'IDLE' || s === 'LOBBY_NOT_IN_QUEUE' || s === 'IN_QUEUE') return 'state-idle';
    if (s === 'OFFLINE' || s === 'NOT_WORKING') return 'state-offline';
    if (s === 'RESTARTING' || s === 'STARTING') return 'state-champ-select';
    if (s === 'LEVEL_30_REACHED') return 'state-level30';
    return '';
}

function timeAgo(dateStr) {
    if (!dateStr) return 'never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 10) return 'just now';
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
}

// Max allowed minutes per state
const STATE_MAX_MINUTES = {
    'IDLE': 6,
    'IN_QUEUE': 60,
    'CHAMP_SELECT': 11,
    'LOADING_SCREEN': 11,
    'IN_GAME': 60,
    'POST_GAME': 10,
    'LOOP_END': 10,
    'LOGGING IN': 10
};

function stateTimer(pc) {
    if (!pc.state_changed_at) return '';
    const diff = Date.now() - new Date(pc.state_changed_at).getTime();
    if (diff < 0) return '0s';
    const totalSecs = Math.floor(diff / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function isStateOverdue(pc) {
    if (!pc.state_changed_at || !pc.script_state) return false;
    const maxMin = STATE_MAX_MINUTES[pc.script_state.toUpperCase()];
    if (!maxMin) return false;
    const elapsedMs = Date.now() - new Date(pc.state_changed_at).getTime();
    return elapsedMs > maxMin * 60 * 1000;
}

function renderLevelBar(level) {
    const capped = Math.min(level, 30);
    const isComplete = level >= 30;
    const labelClass = isComplete ? 'level-complete' : '';
    const prefix = isComplete ? '🎉 ' : '';

    const showBar = level >= 1 && level <= 31;

    let segments = '';
    if (showBar) {
        for (let i = 0; i < 30; i++) {
            const filled = i < capped;
            const pct = (i + 1) / 30;
            let hue;
            if (pct <= 0.33) hue = pct / 0.33 * 30;
            else if (pct <= 0.66) hue = 30 + (pct - 0.33) / 0.33 * 30;
            else hue = 60 + (pct - 0.66) / 0.34 * 220;
            if (filled) {
                segments += '<div class="level-seg filled" style="--seg-hue: ' + Math.round(hue) + '"></div>';
            } else {
                segments += '<div class="level-seg"></div>';
            }
        }
    }

    return '<div class="level-bar-container">' +
        '<div class="level-bar-header">' +
        '<span class="level-bar-label">Level</span>' +
        '<span class="level-bar-value ' + labelClass + '">' + prefix + 'Lv ' + level + ' / 30</span>' +
        '</div>' +
        (showBar ? '<div class="level-bar-track">' + segments + '</div>' : '') +
        '</div>';
}

function renderPcGrid(pcs) {
    if (pcs.length === 0) {
        pcGrid.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📡</div>
                <h2>No PCs registered</h2>
                <p>Start the watchdog agent on a PC and it will appear here automatically.</p>
            </div>`;
        onlineCount.textContent = '0 online';
        return;
    }

    const online = pcs.filter(pc => {
        const info = getStatusInfo(pc);
        return info.class === 'online' || info.class === 'starting';
    }).length;
    onlineCount.textContent = `${online} online`;

    pcs.sort((a, b) => a.pc_name.localeCompare(b.pc_name, undefined, { numeric: true }));
    pcGrid.innerHTML = pcs.map(pc => {
        const status = getStatusInfo(pc);
        const stateClass = getStateClass(pc.script_state);
        const stateMap = { 'OFFLINE': 'Not Working', 'NOT_WORKING': 'Not Working', 'STARTING': 'Starting...', 'RESTARTING': 'Restarting...', 'LEVEL_30_REACHED': 'Level 30 ✅' };
        const stateDisplay = stateMap[pc.script_state] || pc.script_state || '—';
        const accountDisplay = pc.current_account || '—';
        const lastSeen = timeAgo(pc.updated_at);

        let pcCardClass = `status-${status.class}`;
        if (pc.current_level >= 30 || pc.script_state === 'LEVEL_30_REACHED') {
            pcCardClass += ' status-level30';
        }

        return `
        <div class="pc-card ${pcCardClass}" data-pc="${pc.pc_name}">
            <div class="card-top">
                <span class="card-name">${status.icon} ${pc.pc_name}${getRegionSuffix(pc.pc_name)}</span>
                <span class="card-status-badge ${status.badge}">${status.label}</span>
            </div>
            <div class="card-details">
                <div class="card-detail">
                    <span class="card-detail-label">State</span>
                    <span class="card-detail-value ${stateClass}">${pc.state_changed_at && pc.is_online ? '<span class="state-timer' + (isStateOverdue(pc) ? ' overdue' : '') + '">' + stateTimer(pc) + '</span> ' : ''}${stateDisplay}</span>
                </div>
                <!-- right.exe status row (commented out)
                <div class="card-detail">
                    <span class="card-detail-label">right.exe</span>
                    <span class="card-detail-value ${pc.right_exe_running ? 'state-in-game' : 'state-offline'}">${pc.right_exe_running ? 'Running' : 'Not running'}</span>
                </div>
                -->
                <div class="card-detail">
                    <span class="card-detail-label">Account</span>
                    <span class="card-detail-value">${accountDisplay}</span>
                </div>
                ${pc.current_level != null ? renderLevelBar(pc.current_level) : ''}
                <div class="card-detail">
                    <span class="card-detail-label">Last seen</span>
                    <span class="card-detail-value">${lastSeen}</span>
                </div>
                ${pc.current_level == null ? '<div class="level-bar-container" style="visibility:hidden">' + renderLevelBar(1) + '</div>' : ''}
            </div>
            <div class="card-actions">
                <div class="btn-group">
                    <button class="btn-action btn-primary-action" onclick="sendCommand('${pc.pc_name}', 'start_script')" title="Start the bot script">▶️ Start</button>
                    <button class="btn-action" onclick="confirmCommand('${pc.pc_name}', 'stop_script', 'Stop the bot script?')" title="Stop the bot/yuumi script">⏹️ Stop</button>
                    <button class="btn-action btn-stop-after" onclick="confirmCommand('${pc.pc_name}', 'stop_after_game', 'Stop the bot after current game?')" title="Stop after the current game finishes">⏸️ Stop later</button>
                </div>
                <div class="btn-group">
                    <button class="btn-action" onclick="openLoginModal('${pc.pc_name}')" title="Login with a different account">🔑 Login</button>
                    <button class="btn-action" onclick="openAccsModal('${pc.pc_name}')" title="View/Edit ACCS.txt">📋 ACCS</button>
                    <button class="btn-action btn-gun-open" onclick="openGunModal('${pc.pc_name}')" title="Gun aldirma - otomatik hesap isleme">📅 Gun aldirma</button>
                </div>
                <div class="btn-group">
                    <button class="btn-action" onclick="sendCommand('${pc.pc_name}', 'fetch_logs')" title="Fetch latest logs">📄 Logs</button>
                    <button class="btn-action" onclick="confirmCommand('${pc.pc_name}', 'logout', 'Logout the current account?')" title="Logout current account">🚪 Logout</button>
                    <button class="btn-action" onclick="openOtherModal('${pc.pc_name}')" title="Other actions (Right.exe, Update LoL)">🛠️ Other</button>
                </div>
                <div class="btn-group btn-group-danger">
                <button class="btn-action btn-danger" onclick="openKillModal('${pc.pc_name}')" title="Kill options">💀 Kill</button>
                    <button class="btn-action btn-danger" onclick="confirmCommand('${pc.pc_name}', 'restart_pc', 'Restart PC?')" title="Restart the PC">⚡ Restart</button>
                    <button class="btn-action btn-danger" onclick="confirmCommand('${pc.pc_name}', 'shutdown_pc', 'Shutdown PC?')" title="Shutdown the PC">🔌 Shutdown</button>
                </div>
            </div>
        </div > `;
    }).join('');
}

// ─── COMMANDS ────────────────────────────────────────────────────────────────

async function sendCommand(pcName, command, args = null) {
    try {
        // Check if PC is online before sending command
        const { data: pcStatus } = await sb
            .from('pc_status')
            .select('is_online')
            .eq('pc_name', pcName)
            .single();

        if (!pcStatus || !pcStatus.is_online) {
            toast(`⚠️ ${pcName} is offline.Command not sent.`, 'error');
            return;
        }

        const insertData = {
            target_pc: pcName,
            command: command,
            status: 'pending'
        };
        if (args) insertData.arguments = args;

        const { data, error } = await sb
            .from('pc_commands')
            .insert(insertData)
            .select('id')
            .single();

        if (error) throw error;

        toast(`✅ Command "${command}" sent to ${pcName}`, 'success');

        // If it's a fetch_logs, start polling for the result using the specific command ID
        if (command === 'fetch_logs') {
            pollForResult(pcName, command, data.id);
        }
    } catch (err) {
        console.error('Command send failed:', err);
        toast(`❌ Failed to send command: ${err.message}`, 'error');
    }
}

function confirmCommand(pcName, command, message) {
    if (confirm(`⚠️ ${message}\n\nThis will ${command.replace('_', ' ')} on "${pcName}".Are you sure ? `)) {
        sendCommand(pcName, command);
    }
}

// ─── LOGIN MODAL ─────────────────────────────────────────────────────────────

function openLoginModal(pcName) {
    loginTargetPc = pcName;
    loginModalTitle.textContent = `Login Account — ${pcName}`;
    loginPwdInput.value = '';
    loginModal.style.display = 'flex';
    loginPwdInput.focus();
}

sendLoginCmd.addEventListener('click', () => {
    const pwd = loginPwdInput.value.trim();
    if (!pwd) {
        toast('Please enter a password', 'error');
        return;
    }
    sendCommand(loginTargetPc, 'login_account', pwd);
    loginModal.style.display = 'none';
});

closeLoginModal.addEventListener('click', () => {
    loginModal.style.display = 'none';
});

// Allow Enter key in password input
loginPwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendLoginCmd.click();
});

async function loginRnAccount() {
    if (!loginTargetPc) return;
    loginModal.style.display = 'none';
    await sendCommand(loginTargetPc, 'login_rn');
    toast(`🎯 RN account login sent → ${loginTargetPc}`, 'success');
}

// ─── LOG VIEWER ──────────────────────────────────────────────────────────────

async function pollForResult(pcName, command, cmdId) {
    toast(`⏳ Waiting for ${command} result from ${pcName}...`, 'info');

    let attempts = 0;
    const maxAttempts = 30; // 30 × 2s = 60s max wait
    const interval = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
            clearInterval(interval);
            toast(`⏰ Timed out waiting for ${command} result`, 'error');
            return;
        }

        try {
            const { data, error } = await sb
                .from('pc_commands')
                .select('*')
                .eq('id', cmdId)
                .single();

            if (error) throw error;
            if (data && (data.status === 'completed' || data.status === 'failed')) {
                clearInterval(interval);

                if (command === 'fetch_logs' && data.status === 'completed') {
                    showLogModal(pcName, data.result);
                } else if (data.status === 'failed') {
                    toast(`❌ ${command} failed: ${data.result || 'Unknown error'} `, 'error');
                } else {
                    toast(`✅ ${command}: ${data.result || 'Done'} `, 'success');
                }
            }
        } catch (err) {
            console.error('Poll error:', err);
        }
    }, 2000);
}

function showLogModal(pcName, content) {
    logModalTitle.textContent = `📄 Logs — ${pcName} `;
    logContent.textContent = content || 'No log content available.';
    logModal.style.display = 'flex';

    // Auto-scroll to bottom
    setTimeout(() => {
        logContent.scrollTop = logContent.scrollHeight;
    }, 50);
}

closeLogModal.addEventListener('click', () => {
    logModal.style.display = 'none';
});

// Close modals on overlay click
logModal.addEventListener('click', (e) => {
    if (e.target === logModal) logModal.style.display = 'none';
});

loginModal.addEventListener('click', (e) => {
    if (e.target === loginModal) loginModal.style.display = 'none';
});

// Close modals with Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        logModal.style.display = 'none';
        loginModal.style.display = 'none';
        killModal.style.display = 'none';
        otherModal.style.display = 'none';
    }
});

// ─── COMMAND HISTORY ─────────────────────────────────────────────────────────

async function loadCommandHistory() {
    try {
        const { data, error } = await sb
            .from('pc_commands')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(20);

        if (error) throw error;
        renderCommandHistory(data || []);
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function renderCommandHistory(commands) {
    if (commands.length === 0) {
        cmdHistory.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No commands yet</div>';
        return;
    }

    let html = `
        < div class="cmd-row cmd-row-header" >
            <div>PC</div>
            <div>Command</div>
            <div>Status</div>
            <div>When</div>
            <div>Result</div>
        </div > `;

    for (const cmd of commands) {
        const resultSnippet = cmd.result
            ? (cmd.result.length > 50
                ? `< span class="cmd-result-link" onclick = "showLogModal('${cmd.target_pc}', atob('${btoa(cmd.result)}'))" > View result</span > `
                : escapeHtml(cmd.result))
            : '—';

        html += `
        < div class="cmd-row" >
            <div style="font-weight:600;text-transform:capitalize">${cmd.target_pc}</div>
            <div>${cmd.command}</div>
            <div><span class="cmd-status status-${cmd.status}">${cmd.status}</span></div>
            <div style="color:var(--text-muted)">${timeAgo(cmd.created_at)}</div>
            <div style="color:var(--text-secondary);font-size:11px">${resultSnippet}</div>
        </div > `;
    }

    cmdHistory.innerHTML = html;
}

// ─── AUTO REFRESH ────────────────────────────────────────────────────────────

function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(() => {
        loadDashboard();
    }, REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
    }
}

refreshBtn.addEventListener('click', () => {
    loadDashboard();
    toast('Dashboard refreshed', 'info');
});

// ─── TOAST NOTIFICATIONS ────────────────────────────────────────────────────

function toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast - ${type} `;
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(20px)';
        el.style.transition = '.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 4000);
}

// ─── ACCS EDITOR ─────────────────────────────────────────────────────────────

const accsModal = document.getElementById('accs-modal');
const accsTitle = document.getElementById('accs-modal-title');
const accsContent = document.getElementById('accs-content');
const saveAccsBtn = document.getElementById('save-accs-btn');
const closeAccsModal = document.getElementById('close-accs-modal');
let accsCurrentPc = null;

async function openAccsModal(pcName) {
    accsCurrentPc = pcName;
    accsTitle.textContent = '📋 ACCS.txt — ' + pcName;
    accsContent.value = 'Loading...';
    accsContent.disabled = true;
    saveAccsBtn.disabled = true;
    accsModal.style.display = 'flex';

    try {
        // Check online first
        const { data: pcStatus } = await sb
            .from('pc_status')
            .select('is_online')
            .eq('pc_name', pcName)
            .single();

        if (!pcStatus || !pcStatus.is_online) {
            accsContent.value = 'PC is offline. Cannot fetch ACCS.txt.';
            return;
        }

        // Send fetch_accs command
        const { data, error } = await sb
            .from('pc_commands')
            .insert({ target_pc: pcName, command: 'fetch_accs', status: 'pending' })
            .select('id')
            .single();

        if (error) throw error;

        toast('⏳ Fetching ACCS.txt from ' + pcName + '...', 'info');

        // Poll for the result
        let attempts = 0;
        const poll = setInterval(async () => {
            attempts++;
            if (attempts > 30) {
                clearInterval(poll);
                accsContent.value = 'Timed out waiting for ACCS.txt';
                return;
            }
            try {
                const { data: cmd } = await sb
                    .from('pc_commands')
                    .select('*')
                    .eq('id', data.id)
                    .single();

                if (cmd && (cmd.status === 'completed' || cmd.status === 'failed')) {
                    clearInterval(poll);
                    if (cmd.status === 'completed') {
                        accsContent.value = cmd.result || '';
                        accsContent.disabled = false;
                        saveAccsBtn.disabled = false;
                    } else {
                        accsContent.value = 'Error: ' + (cmd.result || 'Unknown error');
                    }
                }
            } catch (e) {
                console.error('ACCS poll error:', e);
            }
        }, 2000);
    } catch (err) {
        accsContent.value = 'Error: ' + err.message;
    }
}

saveAccsBtn.addEventListener('click', async () => {
    if (!accsCurrentPc) return;
    saveAccsBtn.disabled = true;
    saveAccsBtn.textContent = '⏳ Saving...';

    try {
        const { error } = await sb
            .from('pc_commands')
            .insert({
                target_pc: accsCurrentPc,
                command: 'update_accs',
                arguments: accsContent.value,
                status: 'pending'
            });

        if (error) throw error;
        toast('✅ ACCS.txt save command sent to ' + accsCurrentPc, 'success');
    } catch (err) {
        toast('❌ Failed to save: ' + err.message, 'error');
    } finally {
        saveAccsBtn.disabled = false;
        saveAccsBtn.textContent = '💾 Save';
    }
});

closeAccsModal.addEventListener('click', () => {
    accsModal.style.display = 'none';
    accsCurrentPc = null;
});

accsModal.addEventListener('click', (e) => {
    if (e.target === accsModal) {
        accsModal.style.display = 'none';
        accsCurrentPc = null;
    }
});
// ─── GÜN PROCESSING MODAL ────────────────────────────────────────────────────

const gunModal = document.getElementById('gun-modal');
const gunTitle = document.getElementById('gun-modal-title');
const closeGunModalBtn = document.getElementById('close-gun-modal');
let gunCurrentPc = null;

function openGunModal(pcName) {
    gunCurrentPc = pcName;
    gunTitle.textContent = '📅 Gun aldirma — ' + pcName;
    gunModal.style.display = 'flex';
}

async function sendGunCommand(gun) {
    if (!gunCurrentPc) return;
    const label = gun === 'all' ? 'Tüm günleri' : gun + '. günleri';

    // Confirm before starting
    if (!confirm(`${label} almaya başlansın mı?\n\nPC: ${gunCurrentPc}\n\nBu işlem sırasında bilgisayar meşgul olacak.`)) {
        return;
    }

    gunModal.style.display = 'none';
    await sendCommand(gunCurrentPc, 'process_gun', String(gun));
    toast(`📅 ${label} al komutu gönderildi → ${gunCurrentPc}`, 'success');
}

async function cancelGunCommand() {
    if (!gunCurrentPc) return;
    gunModal.style.display = 'none';
    await sendCommand(gunCurrentPc, 'cancel_gun');
    toast(`⛔ İptal komutu gönderildi → ${gunCurrentPc}`, 'info');
}

async function stopAllWhenReady() {
    if (!confirm('Send stop-after-game to ALL online PCs?')) return;
    try {
        const { data: pcs } = await sb
            .from('pc_status')
            .select('pc_name')
            .eq('is_online', true);
        if (!pcs || pcs.length === 0) {
            toast('No online PCs found', 'warning');
            return;
        }
        let sent = 0;
        for (const pc of pcs) {
            await sendCommand(pc.pc_name, 'stop_after_game');
            sent++;
        }
        toast(`⏸️ Sent stop-after-game to ${sent} PCs`, 'success');
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
}

async function forceHeartbeatAll() {
    try {
        const { data: pcs } = await sb
            .from('pc_status')
            .select('pc_name')
            .eq('is_online', true);
        if (!pcs || pcs.length === 0) {
            toast('No online PCs found', 'warning');
            return;
        }
        // Silently insert all heartbeat commands at once (no per-PC toast)
        const cmds = pcs.map(pc => ({
            target_pc: pc.pc_name,
            command: 'force_heartbeat',
            status: 'pending'
        }));
        const { error } = await sb.from('pc_commands').insert(cmds);
        if (error) throw error;
        toast(`💓 Heartbeat requested from ${pcs.length} PCs. Refreshing...`, 'success');
        // Auto-refresh after a short delay to show updated data
        setTimeout(() => loadDashboard(), 2000);
    } catch (err) {
        toast('Failed: ' + err.message, 'error');
    }
}

async function playOneYuumi() {
    if (!gunCurrentPc) return;
    gunModal.style.display = 'none';
    await sendCommand(gunCurrentPc, 'play_yuumi');
    toast(`🐱 Yuumi komutu gönderildi → ${gunCurrentPc}`, 'success');
}

closeGunModalBtn.addEventListener('click', () => {
    gunModal.style.display = 'none';
    gunCurrentPc = null;
});

gunModal.addEventListener('click', (e) => {
    if (e.target === gunModal) {
        gunModal.style.display = 'none';
        gunCurrentPc = null;
    }
});

// ─── KILL MODAL ─────────────────────────────────────────────────────────────

const killModal = document.getElementById('kill-modal');
const killModalTitle = document.getElementById('kill-modal-title');
const closeKillModalBtn = document.getElementById('close-kill-modal');
const killLolBtn = document.getElementById('kill-lol-btn');
const forceStopBtn = document.getElementById('force-stop-btn');
let killCurrentPc = null;

function openKillModal(pcName) {
    killCurrentPc = pcName;
    killModalTitle.textContent = '💀 Kill — ' + pcName;
    killModal.style.display = 'flex';
}

killLolBtn.addEventListener('click', () => {
    if (!killCurrentPc) return;
    killModal.style.display = 'none';
    sendCommand(killCurrentPc, 'kill_lol');
    killCurrentPc = null;
});

forceStopBtn.addEventListener('click', async () => {
    if (!killCurrentPc) return;
    const pcName = killCurrentPc;
    killModal.style.display = 'none';
    killCurrentPc = null;

    // 1. Send force_stop command
    await sendCommand(pcName, 'force_stop');

    // 2. Also mark any 'running' commands as failed from the dashboard side
    //    (in case watchdog is truly frozen and can't process force_stop)
    try {
        await sb
            .from('pc_commands')
            .update({ status: 'failed', result: 'Forcefully terminated by user', completed_at: new Date().toISOString() })
            .eq('target_pc', pcName)
            .eq('status', 'running');
        toast(`🛑 Force stop sent + stuck commands cleared for ${pcName}`, 'success');
    } catch (err) {
        console.error('Failed to clear stuck commands:', err);
    }

    // 3. Refresh dashboard after a short delay
    setTimeout(() => loadDashboard(), 2000);
});

closeKillModalBtn.addEventListener('click', () => {
    killModal.style.display = 'none';
    killCurrentPc = null;
});

killModal.addEventListener('click', (e) => {
    if (e.target === killModal) {
        killModal.style.display = 'none';
        killCurrentPc = null;
    }
});

// ─── OTHER MODAL ─────────────────────────────────────────────────────────────

let otherCurrentPc = null;

function openOtherModal(pcName) {
    otherCurrentPc = pcName;
    otherModalTitle.textContent = '🛠️ Other Actions — ' + pcName;
    otherModal.style.display = 'flex';
}

otherRightBtn.addEventListener('click', () => {
    if (!otherCurrentPc) return;
    otherModal.style.display = 'none';
    sendCommand(otherCurrentPc, 'start_right');
    otherCurrentPc = null;
});

otherUpdateBtn.addEventListener('click', () => {
    if (!otherCurrentPc) return;
    otherModal.style.display = 'none';
    sendCommand(otherCurrentPc, 'update_game');
    otherCurrentPc = null;
});

closeOtherModalBtn.addEventListener('click', () => {
    otherModal.style.display = 'none';
    otherCurrentPc = null;
});

otherModal.addEventListener('click', (e) => {
    if (e.target === otherModal) {
        otherModal.style.display = 'none';
        otherCurrentPc = null;
    }
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = text;
    return el.innerHTML;
}

// ─── COMMAND HISTORY TOGGLE ──────────────────────────────────────────────────

// Show command history when clicking online badge
document.getElementById('online-count').addEventListener('click', () => {
    if (cmdSection.style.display === 'none') {
        cmdSection.style.display = 'block';
        loadCommandHistory();
    } else {
        cmdSection.style.display = 'none';
    }
});

closeHistoryBtn.addEventListener('click', () => {
    cmdSection.style.display = 'none';
});

// ─── INIT ────────────────────────────────────────────────────────────────────

checkAuth();
