export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Anti-Multi — Antigravity 다중 계정 · 다중 인스턴스 · 스텔스 런처</title>
  <style>
    :root {
      --bg: #070b14;
      --bg-panel: #0f1626;
      --bg-card: #131c31;
      --bg-input: #0a101d;
      --border: #1e293b;
      --border-light: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-hover: #4f46e5;
      --emerald: #10b981;
      --amber: #f59e0b;
      --rose: #ef4444;
      --cyan: #06b6d4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: radial-gradient(circle at 15% 0%, #161f38 0%, var(--bg) 55%);
      color: var(--text);
      font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      padding-bottom: 60px;
    }
    header {
      border-bottom: 1px solid var(--border);
      background: rgba(15, 22, 38, 0.85);
      backdrop-filter: blur(12px);
      position: sticky;
      top: 0;
      z-index: 30;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 24px;
    }
    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 0;
      gap: 16px;
      flex-wrap: wrap;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-logo {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6366f1, #06b6d4);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 18px;
      color: white;
      box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
    }
    .brand-title h1 {
      font-size: 18px;
      margin: 0;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .brand-title p {
      margin: 2px 0 0;
      font-size: 12px;
      color: var(--text-muted);
    }
    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    button {
      font-family: inherit;
      font-size: 13px;
      font-weight: 600;
      border-radius: 8px;
      padding: 8px 14px;
      border: 1px solid transparent;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s ease;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .btn-primary {
      background: var(--primary);
      color: white;
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--primary-hover);
    }
    .btn-emerald {
      background: rgba(16, 185, 129, 0.16);
      color: #34d399;
      border-color: rgba(16, 185, 129, 0.35);
    }
    .btn-emerald:hover:not(:disabled) {
      background: rgba(16, 185, 129, 0.28);
    }
    .btn-rose {
      background: rgba(239, 68, 68, 0.15);
      color: #f87171;
      border-color: rgba(239, 68, 68, 0.35);
    }
    .btn-rose:hover:not(:disabled) {
      background: rgba(239, 68, 68, 0.26);
    }
    .btn-ghost {
      background: var(--bg-card);
      color: var(--text);
      border-color: var(--border);
    }
    .btn-ghost:hover:not(:disabled) {
      border-color: var(--border-light);
      background: #1b2742;
    }
    .btn-sm {
      padding: 5px 10px;
      font-size: 12px;
      border-radius: 6px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 14px;
      margin: 22px 0;
    }
    .stat-card {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 18px;
    }
    .stat-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 6px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 700;
    }
    .stat-sub {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 4px;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 26px 0 12px;
      gap: 12px;
      flex-wrap: wrap;
    }
    .section-header h2 {
      font-size: 16px;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .running-panel {
      background: linear-gradient(180deg, rgba(16, 185, 129, 0.07), rgba(15, 22, 38, 0.9));
      border: 1px solid rgba(16, 185, 129, 0.3);
      border-radius: 14px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .running-list {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 12px;
    }
    .running-item {
      background: rgba(10, 16, 29, 0.85);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .running-item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .pulse-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--emerald);
      box-shadow: 0 0 10px var(--emerald);
      display: inline-block;
    }
    .profiles-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
      gap: 18px;
    }
    .profile-card {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: relative;
      transition: border-color 0.15s ease;
    }
    .profile-card.is-running {
      border-color: rgba(16, 185, 129, 0.55);
      box-shadow: 0 0 25px rgba(16, 185, 129, 0.08);
    }
    .card-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
    }
    .card-title-row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .color-dot {
      width: 12px;
      height: 12px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .card-title {
      font-size: 16px;
      font-weight: 700;
      margin: 0;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .badge-pro { background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); }
    .badge-ultra { background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
    .badge-free { background: rgba(148, 163, 184, 0.15); color: #cbd5e1; }
    .badge-running { background: rgba(16, 185, 129, 0.18); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
    .info-box {
      background: var(--bg-input);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      font-size: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .info-box-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-weight: 600;
      color: #cbd5e1;
    }
    .kv-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-size: 12px;
    }
    .kv-label {
      color: var(--text-muted);
      flex-shrink: 0;
    }
    .kv-val {
      font-family: 'JetBrains Mono', Consolas, monospace;
      color: #e2e8f0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 240px;
    }
    .quota-bar-wrap {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }
    .quota-row {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .quota-row-top {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: var(--text-muted);
    }
    .progress-track {
      height: 6px;
      background: #1e293b;
      border-radius: 999px;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #6366f1, #06b6d4);
      border-radius: 999px;
    }
    .card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: auto;
      padding-top: 6px;
      border-top: 1px solid var(--border);
    }
    .modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(4, 7, 15, 0.78);
      backdrop-filter: blur(4px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 100;
      padding: 20px;
    }
    .modal-backdrop.open {
      display: flex;
    }
    .modal {
      background: var(--bg-panel);
      border: 1px solid var(--border-light);
      border-radius: 16px;
      width: 100%;
      max-width: 580px;
      max-height: 90vh;
      overflow-y: auto;
      padding: 24px;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.65);
    }
    .modal h3 {
      margin: 0 0 16px;
      font-size: 18px;
    }
    .form-group {
      margin-bottom: 14px;
    }
    .form-group label {
      display: block;
      font-size: 12px;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    input[type="text"],
    input[type="password"],
    input[type="number"],
    select,
    textarea {
      width: 100%;
      background: var(--bg-input);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 9px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-family: inherit;
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--primary);
    }
    .toast-container {
      position: fixed;
      bottom: 20px;
      right: 20px;
      z-index: 200;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .toast {
      background: #1e293b;
      border-left: 4px solid var(--primary);
      color: var(--text);
      padding: 12px 16px;
      border-radius: 8px;
      font-size: 13px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.45);
    }
    .empty-state {
      text-align: center;
      padding: 48px 24px;
      background: var(--bg-panel);
      border: 1px dashed var(--border-light);
      border-radius: 16px;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <header>
    <div class="container topbar">
      <div class="brand">
        <div class="brand-logo">AM</div>
        <div class="brand-title">
          <h1>Anti-Multi Studio</h1>
          <p>Antigravity 다중 계정 · 다중 인스턴스 동시 실행 · 기기값(Fingerprint) & 프록시 IP 격리 플랫폼</p>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn-primary" onclick="openProfileModal()">➕ 새 프로필 생성</button>
        <button class="btn-emerald" onclick="importLocalAccount()">📥 현재 PC 계정 가져오기</button>
        <button class="btn-ghost" onclick="openOAuthModal()">🌐 Google OAuth 계정 추가</button>
        <button class="btn-ghost" onclick="launchSelectedProfiles()">🚀 선택 동시 실행</button>
        <button class="btn-rose" onclick="stopAllInstances()">⏹ 전체 종료</button>
        <button class="btn-ghost" onclick="openSettingsModal()">⚙️ 설정 / 백업</button>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">등록된 격리 프로필</div>
        <div class="stat-value" id="stat-profiles">0</div>
        <div class="stat-sub">독립 user-data-dir & .gemini 홈</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">연결된 Google 계정</div>
        <div class="stat-value" id="stat-accounts">0</div>
        <div class="stat-sub">파일 토큰 격리 (전역 Keyring 우회)</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">동시 실행 중인 인스턴스</div>
        <div class="stat-value" id="stat-running" style="color: var(--emerald);">0</div>
        <div class="stat-sub">프로필별 전용 로컬 스텔스 게이트웨이</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">게이트웨이 변조 / 텔레메트리 차단</div>
        <div class="stat-value" id="stat-intercepted">0 / 0</div>
        <div class="stat-sub">실시간 UA · InstallationID · 토큰 주입</div>
      </div>
    </div>

    <div id="running-section" style="display: none;">
      <div class="section-header">
        <h2><span class="pulse-dot"></span> 실행 중인 독립 Antigravity 인스턴스 & 스텔스 게이트웨이</h2>
      </div>
      <div class="running-panel">
        <div class="running-list" id="running-list"></div>
      </div>
    </div>

    <div class="section-header">
      <h2>🛡️ 계정 · 기기값(Fingerprint) · 프록시 프로필 매트릭스</h2>
      <div style="display: flex; gap: 8px; align-items: center;">
        <button class="btn-ghost btn-sm" onclick="toggleSelectAll(true)">전체 선택</button>
        <button class="btn-ghost btn-sm" onclick="toggleSelectAll(false)">선택 해제</button>
        <button class="btn-ghost btn-sm" onclick="refreshState()">🔄 상태 새로고침</button>
      </div>
    </div>

    <div id="profiles-container"></div>
  </main>

  <!-- Profile Create/Edit Modal -->
  <div class="modal-backdrop" id="profile-modal">
    <div class="modal">
      <h3 id="profile-modal-title">프로필 생성 / 편집</h3>
      <input type="hidden" id="pm-id" />
      <div class="form-row">
        <div class="form-group">
          <label>프로필 이름 *</label>
          <input type="text" id="pm-name" placeholder="예: 본계정 (KR 프록시)" />
        </div>
        <div class="form-group">
          <label>메모 / 태그</label>
          <input type="text" id="pm-notes" placeholder="예: 외주 프로젝트용 계정" />
        </div>
      </div>
      <div class="form-group">
        <label>기본 워크스페이스 경로 (선택)</label>
        <input type="text" id="pm-workspace" placeholder="예: C:\\projects\\my-app" />
      </div>
      <div class="form-group">
        <label>아웃바운드 프록시 (비워두면 Direct 연결)</label>
        <input type="text" id="pm-proxy" placeholder="예: socks5://user:pass@1.2.3.4:1080 또는 http://1.2.3.4:8080 또는 1.2.3.4:8080:user:pass" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>변조 OS 타입 (User-Agent / Metadata)</label>
          <select id="pm-os">
            <option value="windows">Windows (windows)</option>
            <option value="darwin">macOS (darwin)</option>
            <option value="linux">Linux (linux)</option>
          </select>
        </div>
        <div class="form-group">
          <label>변조 아키텍처 (Arch)</label>
          <select id="pm-arch">
            <option value="arm64">ARM64 (arm64)</option>
            <option value="amd64">x86_64 (amd64)</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>변조 호스트네임 (COMPUTERNAME)</label>
          <input type="text" id="pm-hostname" placeholder="자동 생성됨 (예: DESKTOP-7F3A91B)" />
        </div>
        <div class="form-group">
          <label>텔레메트리/로그 수집 차단</label>
          <select id="pm-block-telemetry">
            <option value="true">차단 (권장 - /log 요청 드롭)</option>
            <option value="false">허용</option>
          </select>
        </div>
      </div>
      <div class="form-group" id="pm-token-group">
        <label>Refresh Token (<code>1//...</code>) 또는 토큰 JSON (선택 — 생성 시 즉시 바인딩)</label>
        <input type="password" id="pm-refresh-token" placeholder="1//0g... (비워두면 생성 후 OAuth 로그인 가능)" />
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px;">
        <button class="btn-ghost" onclick="closeModal('profile-modal')">취소</button>
        <button class="btn-primary" onclick="saveProfileModal()">저장</button>
      </div>
    </div>
  </div>

  <!-- OAuth & Token Bind Modal -->
  <div class="modal-backdrop" id="oauth-modal">
    <div class="modal">
      <h3 id="oauth-modal-title">Google 계정 연결 (OAuth / Refresh Token)</h3>
      <input type="hidden" id="om-profile-id" />
      <div class="info-box" style="margin-bottom: 16px;">
        <div class="info-box-header">방법 1. Google OAuth 브라우저 로그인</div>
        <p style="margin: 4px 0; color: var(--text-muted); line-height: 1.5;">
          아래 버튼을 누르면 공식 Antigravity OAuth 인증 URL이 생성됩니다. 새 창에서 로그인하면 자동으로 계정이 프로필에 저장됩니다.<br/>
          (다른 브라우저/시크릿 창에서 로그인한 경우 리다이렉트된 <code>http://127.0.0.1:.../api/oauth/callback?code=...</code> 주소를 아래에 붙여넣어도 됩니다.)
        </p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap;">
          <button class="btn-primary btn-sm" onclick="startBrowserOAuth(true)">🌐 브라우저 창 열어서 로그인</button>
          <button class="btn-ghost btn-sm" onclick="startBrowserOAuth(false)">📋 OAuth 인증 URL 복사</button>
        </div>
        <input type="text" id="om-auth-url" readonly placeholder="OAuth URL이 여기에 표시됩니다" style="margin-top: 6px; font-size: 11px;" />
      </div>

      <div class="form-group">
        <label>콜백 URL 또는 인증 코드(code) 수동 입력 (외부 브라우저 사용 시)</label>
        <div style="display: flex; gap: 8px;">
          <input type="text" id="om-manual-code" placeholder="http://127.0.0.1:4300/api/oauth/callback?code=4/0A..." />
          <button class="btn-emerald btn-sm" style="flex-shrink: 0;" onclick="submitManualOAuthCode()">코드 교환</button>
        </div>
      </div>

      <hr style="border: none; border-top: 1px solid var(--border); margin: 18px 0;" />

      <div class="form-group">
        <label>방법 2. Refresh Token (<code>1//...</code>) 또는 <code>jetski-standalone-oauth-token</code> JSON 직접 입력</label>
        <textarea id="om-refresh-token" rows="3" placeholder="1//0g... 또는 {&quot;token&quot;:{&quot;refresh_token&quot;:&quot;1//...&quot;}}"></textarea>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button class="btn-ghost" onclick="closeModal('oauth-modal')">닫기</button>
        <button class="btn-primary" onclick="submitRefreshTokenBind()">Refresh Token 바인딩</button>
      </div>
    </div>
  </div>

  <!-- Settings & Backup Modal -->
  <div class="modal-backdrop" id="settings-modal">
    <div class="modal">
      <h3>⚙️ 전역 설정 및 프로필 백업/복원</h3>
      <div class="form-group">
        <label>Antigravity 실행 파일 경로 (<code>Antigravity.exe</code>)</label>
        <input type="text" id="sm-exe-path" placeholder="C:\\Users\\...\\AppData\\Local\\Programs\\antigravity\\Antigravity.exe" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>기본 타임존 (TZ)</label>
          <input type="text" id="sm-timezone" placeholder="Asia/Seoul" />
        </div>
        <div class="form-group">
          <label>기본 로케일 (Locale)</label>
          <input type="text" id="sm-locale" placeholder="ko-KR" />
        </div>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 20px;">
        <button class="btn-primary btn-sm" onclick="saveSettings()">설정 저장</button>
      </div>

      <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;" />

      <div class="form-group">
        <label>💾 전체 프로필 JSON 내보내기 / 가져오기</label>
        <div style="display: flex; gap: 8px; margin-bottom: 10px;">
          <button class="btn-ghost btn-sm" onclick="exportProfilesJson()">⬇️ JSON 파일 다운로드</button>
        </div>
        <textarea id="sm-import-json" rows="4" placeholder="가져올 프로필 JSON 배열 또는 백업 번들을 여기에 붙여넣으세요"></textarea>
      </div>
      <div style="display: flex; justify-content: space-between; gap: 8px;">
        <button class="btn-emerald btn-sm" onclick="importProfilesJson()">⬆️ JSON 프로필 가져오기</button>
        <button class="btn-ghost" onclick="closeModal('settings-modal')">닫기</button>
      </div>
    </div>
  </div>

  <div class="toast-container" id="toast-container"></div>

  <script>
    let appState = { settings: {}, profiles: [], runningInstances: [] };
    const selectedProfiles = new Set();

    function showToast(msg, color = '#6366f1') {
      const container = document.getElementById('toast-container');
      const el = document.createElement('div');
      el.className = 'toast';
      el.style.borderLeftColor = color;
      el.textContent = msg;
      container.appendChild(el);
      setTimeout(() => el.remove(), 4000);
    }

    async function apiCall(path, options = {}) {
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }

    async function refreshState() {
      try {
        const data = await apiCall('/api/state');
        appState = data;
        renderAll();
      } catch (err) {
        showToast('상태 조회 실패: ' + err.message, '#ef4444');
      }
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function renderAll() {
      const profiles = appState.profiles || [];
      const running = appState.runningInstances || [];
      const runningByProfile = new Map(running.map(r => [r.profileId, r]));

      document.getElementById('stat-profiles').textContent = profiles.length;
      document.getElementById('stat-accounts').textContent = profiles.filter(p => p.account && p.account.email).length;
      document.getElementById('stat-running').textContent = running.length;

      const totalIntercepted = running.reduce((acc, r) => acc + (r.interceptedRequests || 0), 0);
      const totalBlocked = running.reduce((acc, r) => acc + (r.blockedTelemetryRequests || 0), 0);
      document.getElementById('stat-intercepted').textContent = totalIntercepted + ' / ' + totalBlocked;

      // Render Running Instances
      const runningSec = document.getElementById('running-section');
      const runningList = document.getElementById('running-list');
      if (running.length === 0) {
        runningSec.style.display = 'none';
      } else {
        runningSec.style.display = 'block';
        runningList.innerHTML = running.map(r => \`
          <div class="running-item">
            <div class="running-item-top">
              <div style="display:flex; align-items:center; gap:8px;">
                <span class="pulse-dot"></span>
                <strong>\${escapeHtml(r.profileName)}</strong>
                <span class="badge badge-running">PID \${r.pid}</span>
              </div>
              <button class="btn-rose btn-sm" onclick="stopProfile('\${r.profileId}')">⏹ 종료</button>
            </div>
            <div class="kv-row">
              <span class="kv-label">계정 / 게이트웨이</span>
              <span class="kv-val">\${escapeHtml(r.email || '앱 내 로그인 대기')} · \${escapeHtml(r.gatewayUrl)}</span>
            </div>
            <div class="kv-row">
              <span class="kv-label">출구 프록시 / Installation ID</span>
              <span class="kv-val">\${escapeHtml(r.proxySummary)} · \${escapeHtml(r.installationId.slice(0, 13))}...</span>
            </div>
            <div class="kv-row">
              <span class="kv-label">변조 요청 / 텔레메트리 차단</span>
              <span class="kv-val">\${r.interceptedRequests}건 변조 완료 / \${r.blockedTelemetryRequests}건 차단</span>
            </div>
          </div>
        \`).join('');
      }

      // Render Profiles Grid
      const container = document.getElementById('profiles-container');
      if (profiles.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <h3 style="color: var(--text); margin-bottom: 8px;">등록된 프로필이 없습니다</h3>
            <p style="margin-bottom: 20px;">상단의 <strong>[📥 현재 PC 계정 가져오기]</strong> 또는 <strong>[➕ 새 프로필 생성]</strong> 버튼을 눌러 첫 격리 프로필을 만드세요.</p>
            <div style="display:flex; gap:10px; justify-content:center;">
              <button class="btn-emerald" onclick="importLocalAccount()">📥 현재 PC 계정 가져오기</button>
              <button class="btn-primary" onclick="openProfileModal()">➕ 새 프로필 생성</button>
            </div>
          </div>
        \`;
        return;
      }

      container.innerHTML = '<div class="profiles-grid">' + profiles.map(p => {
        const runInfo = runningByProfile.get(p.id);
        const isChecked = selectedProfiles.has(p.id) ? 'checked' : '';
        const tier = (p.account && p.account.subscriptionTier) || (p.quota && p.quota.tier) || 'FREE';
        const tierClass = tier === 'ULTRA' ? 'badge-ultra' : tier === 'PRO' ? 'badge-pro' : 'badge-free';
        const proxyStr = p.proxy && p.proxy.enabled && p.proxy.host
          ? \`\${p.proxy.protocol}://\${p.proxy.host}:\${p.proxy.port}\`
          : 'Direct (로컬 IP)';
        const checkedIpStr = p.proxy && p.proxy.lastCheckedIp
          ? \`\${p.proxy.lastCheckedIp} (\${p.proxy.lastCheckedCountry || '-'}, \${p.proxy.lastCheckedLatencyMs || 0}ms)\`
          : '미확인 (출구 IP 테스트 클릭)';

        const quotaItems = [
          ...((p.quota && p.quota.groups) || []),
          ...((p.quota && p.quota.models) || []).slice(0, 3),
        ].slice(0, 4);

        const quotaHtml = quotaItems.length > 0
          ? '<div class="quota-bar-wrap">' + quotaItems.map(q => \`
              <div class="quota-row">
                <div class="quota-row-top">
                  <span>\${escapeHtml(q.displayName || q.modelId)}</span>
                  <strong>\${q.remainingPercent}%</strong>
                </div>
                <div class="progress-track">
                  <div class="progress-fill" style="width: \${Math.max(0, Math.min(100, q.remainingPercent))}%"></div>
                </div>
              </div>
            \`).join('') + '</div>'
          : '';

        return \`
          <div class="profile-card \${runInfo ? 'is-running' : ''}">
            <div class="card-header">
              <div class="card-title-row">
                <input type="checkbox" \${isChecked} onchange="toggleSelectProfile('\${p.id}', this.checked)" />
                <span class="color-dot" style="background: \${escapeHtml(p.color || '#6366f1')}"></span>
                <div>
                  <h3 class="card-title">\${escapeHtml(p.name)}</h3>
                  \${p.notes ? \`<div style="font-size:11px; color:var(--text-muted); margin-top:2px;">\${escapeHtml(p.notes)}</div>\` : ''}
                </div>
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                \${p.account ? \`<span class="badge \${tierClass}">\${escapeHtml(tier)}</span>\` : ''}
                \${runInfo ? '<span class="badge badge-running">실행 중</span>' : ''}
              </div>
            </div>

            <!-- Account Box -->
            <div class="info-box">
              <div class="info-box-header">
                <span>👤 연결된 Google 계정</span>
                <div style="display:flex; gap:4px;">
                  <button class="btn-ghost btn-sm" onclick="openOAuthModal('\${p.id}')">🔑 계정 변경/연결</button>
                  \${p.account ? \`<button class="btn-ghost btn-sm" onclick="refreshQuota('\${p.id}')">📊 쿼터</button>\` : ''}
                </div>
              </div>
              \${p.account ? \`
                <div class="kv-row">
                  <span class="kv-label">이메일</span>
                  <span class="kv-val" title="\${escapeHtml(p.account.email)}">\${escapeHtml(p.account.email)}</span>
                </div>
                <div class="kv-row">
                  <span class="kv-label">Cloud Code 프로젝트</span>
                  <span class="kv-val">\${escapeHtml(p.account.projectId || (p.quota && p.quota.projectId) || '자동 탐색')}</span>
                </div>
                \${quotaHtml}
              \` : \`
                <div style="color: var(--text-muted); font-size: 12px;">
                  연결된 계정이 없습니다. <strong>[🔑 계정 변경/연결]</strong>로 로그인하거나, 바로 인스턴스를 실행한 뒤 Antigravity 창 안에서 로그인하면 자동 저장됩니다.
                </div>
              \`}
            </div>

            <!-- Device Fingerprint Box -->
            <div class="info-box">
              <div class="info-box-header">
                <span>🧬 격리된 기기 식별값 (Device Fingerprint)</span>
                <button class="btn-ghost btn-sm" onclick="regenerateFingerprint('\${p.id}')">🎲 기기값 재생성</button>
              </div>
              <div class="kv-row">
                <span class="kv-label">Installation ID (.gemini)</span>
                <span class="kv-val" title="\${escapeHtml(p.fingerprint.installationId)}">\${escapeHtml(p.fingerprint.installationId)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">Machine ID (storage.json)</span>
                <span class="kv-val" title="\${escapeHtml(p.fingerprint.machineId)}">\${escapeHtml(p.fingerprint.machineId)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">OS / Arch / Hostname</span>
                <span class="kv-val">\${escapeHtml(p.fingerprint.osType)}/\${escapeHtml(p.fingerprint.arch)} · \${escapeHtml(p.fingerprint.hostname)}</span>
              </div>
            </div>

            <!-- Network / Proxy Box -->
            <div class="info-box">
              <div class="info-box-header">
                <span>🌐 네트워크 & 프록시 IP 격리</span>
                <button class="btn-ghost btn-sm" onclick="checkProfileIp('\${p.id}')">🌐 출구 IP 테스트</button>
              </div>
              <div class="kv-row">
                <span class="kv-label">프록시 설정</span>
                <span class="kv-val">\${escapeHtml(proxyStr)}</span>
              </div>
              <div class="kv-row">
                <span class="kv-label">확인된 외부 IP</span>
                <span class="kv-val" style="color: \${p.proxy && p.proxy.lastCheckedIp ? '#34d399' : 'var(--text-muted)'}">\${escapeHtml(checkedIpStr)}</span>
              </div>
            </div>

            <div class="card-footer">
              <div style="display:flex; gap:6px;">
                <button class="btn-ghost btn-sm" onclick="openProfileModal('\${p.id}')">✏️ 상세 편집</button>
                <button class="btn-rose btn-sm" onclick="deleteProfile('\${p.id}')">🗑 삭제</button>
              </div>
              \${runInfo ? \`
                <button class="btn-rose" onclick="stopProfile('\${p.id}')">⏹ 인스턴스 종료 (PID \${runInfo.pid})</button>
              \` : \`
                <button class="btn-primary" onclick="launchProfile('\${p.id}')">🚀 독립 인스턴스 실행</button>
              \`}
            </div>
          </div>
        \`;
      }).join('') + '</div>';
    }

    function toggleSelectProfile(id, checked) {
      if (checked) selectedProfiles.add(id);
      else selectedProfiles.delete(id);
    }

    function toggleSelectAll(selectAll) {
      selectedProfiles.clear();
      if (selectAll) {
        for (const p of (appState.profiles || [])) {
          selectedProfiles.add(p.id);
        }
      }
      renderAll();
    }

    function closeModal(id) {
      document.getElementById(id).classList.remove('open');
    }

    function openProfileModal(profileId) {
      const p = profileId ? (appState.profiles || []).find(x => x.id === profileId) : null;
      document.getElementById('profile-modal-title').textContent = p ? '프로필 상세 편집' : '새 격리 프로필 생성';
      document.getElementById('pm-id').value = p ? p.id : '';
      document.getElementById('pm-name').value = p ? p.name : '';
      document.getElementById('pm-notes').value = p && p.notes ? p.notes : '';
      document.getElementById('pm-workspace').value = p && p.workspacePath ? p.workspacePath : '';

      let proxyVal = '';
      if (p && p.proxy && p.proxy.enabled && p.proxy.host) {
        const auth = p.proxy.username ? \`\${p.proxy.username}:\${p.proxy.password || ''}@\` : '';
        proxyVal = \`\${p.proxy.protocol}://\${auth}\${p.proxy.host}:\${p.proxy.port}\`;
      }
      document.getElementById('pm-proxy').value = proxyVal;
      document.getElementById('pm-os').value = p ? p.fingerprint.osType : 'windows';
      document.getElementById('pm-arch').value = p ? p.fingerprint.arch : 'arm64';
      document.getElementById('pm-hostname').value = p ? p.fingerprint.hostname : '';
      document.getElementById('pm-block-telemetry').value = p ? String(p.fingerprint.blockTelemetry) : 'true';
      document.getElementById('pm-refresh-token').value = '';
      document.getElementById('pm-token-group').style.display = p ? 'none' : 'block';

      document.getElementById('profile-modal').classList.add('open');
    }

    async function saveProfileModal() {
      const id = document.getElementById('pm-id').value.trim();
      const name = document.getElementById('pm-name').value.trim() || 'New Profile';
      const notes = document.getElementById('pm-notes').value.trim();
      const workspacePath = document.getElementById('pm-workspace').value.trim();
      const proxyString = document.getElementById('pm-proxy').value.trim();
      const osType = document.getElementById('pm-os').value;
      const arch = document.getElementById('pm-arch').value;
      const hostname = document.getElementById('pm-hostname').value.trim();
      const blockTelemetry = document.getElementById('pm-block-telemetry').value === 'true';
      const refreshToken = document.getElementById('pm-refresh-token').value.trim();

      const fingerprint = { osType, arch, blockTelemetry };
      if (hostname) fingerprint.hostname = hostname;

      try {
        if (id) {
          await apiCall(\`/api/profiles/\${id}\`, {
            method: 'PUT',
            body: JSON.stringify({ name, notes, workspacePath, proxyString, fingerprint }),
          });
          showToast('프로필이 업데이트되었습니다.');
        } else {
          await apiCall('/api/profiles', {
            method: 'POST',
            body: JSON.stringify({ name, notes, workspacePath, proxyString, fingerprint, refreshToken }),
          });
          showToast('새 격리 프로필이 생성되었습니다.');
        }
        closeModal('profile-modal');
        await refreshState();
      } catch (err) {
        showToast('저장 실패: ' + err.message, '#ef4444');
      }
    }

    async function importLocalAccount() {
      try {
        showToast('현재 PC의 Antigravity 계정을 탐색 중입니다...');
        const res = await apiCall('/api/profiles/import-local', {
          method: 'POST',
          body: JSON.stringify({ preserveHostFingerprint: false }),
        });
        showToast(\`로컬 계정 가져오기 성공: \${res.profile.account?.email || res.profile.name}\`, '#10b981');
        await refreshState();
      } catch (err) {
        showToast('로컬 계정 가져오기 실패: ' + err.message, '#ef4444');
      }
    }

    function openOAuthModal(profileId = '') {
      document.getElementById('om-profile-id').value = profileId;
      document.getElementById('om-auth-url').value = '';
      document.getElementById('om-manual-code').value = '';
      document.getElementById('om-refresh-token').value = '';
      const p = profileId ? (appState.profiles || []).find(x => x.id === profileId) : null;
      document.getElementById('oauth-modal-title').textContent = p
        ? \`[\${p.name}] 프로필에 Google 계정 연결\`
        : '새 Google OAuth 계정 추가';
      document.getElementById('oauth-modal').classList.add('open');
    }

    async function startBrowserOAuth(openPopup) {
      const profileId = document.getElementById('om-profile-id').value.trim();
      try {
        const q = profileId ? \`?profileId=\${encodeURIComponent(profileId)}\` : '';
        const res = await apiCall(\`/api/oauth/start\${q}\`);
        document.getElementById('om-auth-url').value = res.authUrl;
        if (openPopup) {
          window.open(res.authUrl, 'anti_multi_oauth', 'width=540,height=680');
          showToast('Google 로그인 창이 열렸습니다. 로그인 완료 시 자동 반영됩니다.');
        } else {
          await navigator.clipboard.writeText(res.authUrl);
          showToast('OAuth 인증 URL이 클립보드에 복사되었습니다!', '#10b981');
        }
      } catch (err) {
        showToast('OAuth 시작 실패: ' + err.message, '#ef4444');
      }
    }

    async function submitManualOAuthCode() {
      const profileId = document.getElementById('om-profile-id').value.trim();
      const codeOrUrl = document.getElementById('om-manual-code').value.trim();
      if (!codeOrUrl) {
        showToast('콜백 URL 또는 인증 코드를 입력해주세요.', '#f59e0b');
        return;
      }
      try {
        const res = await apiCall('/api/oauth/exchange-manual', {
          method: 'POST',
          body: JSON.stringify({ profileId, codeOrUrl }),
        });
        showToast(\`계정 연결 성공: \${res.profile.account?.email}\`, '#10b981');
        closeModal('oauth-modal');
        await refreshState();
      } catch (err) {
        showToast('코드 교환 실패: ' + err.message, '#ef4444');
      }
    }

    async function submitRefreshTokenBind() {
      const profileId = document.getElementById('om-profile-id').value.trim();
      const refreshToken = document.getElementById('om-refresh-token').value.trim();
      if (!refreshToken) {
        showToast('Refresh Token 또는 JSON을 입력해주세요.', '#f59e0b');
        return;
      }
      try {
        if (profileId) {
          await apiCall(\`/api/profiles/\${profileId}/bind-refresh-token\`, {
            method: 'POST',
            body: JSON.stringify({ refreshToken }),
          });
        } else {
          await apiCall('/api/profiles', {
            method: 'POST',
            body: JSON.stringify({ name: 'Token Account', refreshToken }),
          });
        }
        showToast('Refresh Token 바인딩 및 쿼터 조회 완료!', '#10b981');
        closeModal('oauth-modal');
        await refreshState();
      } catch (err) {
        showToast('토큰 바인딩 실패: ' + err.message, '#ef4444');
      }
    }

    async function regenerateFingerprint(profileId) {
      try {
        await apiCall(\`/api/profiles/\${profileId}/regenerate-fingerprint\`, {
          method: 'POST',
          body: '{}',
        });
        showToast('새로운 기기 식별값(Installation ID / Machine ID)이 생성되었습니다!', '#10b981');
        await refreshState();
      } catch (err) {
        showToast('기기값 재생성 실패: ' + err.message, '#ef4444');
      }
    }

    async function checkProfileIp(profileId) {
      try {
        showToast('프로필 출구 IP 및 프록시 연결을 테스트 중입니다...');
        const res = await apiCall(\`/api/profiles/\${profileId}/check-ip\`, {
          method: 'POST',
          body: '{}',
        });
        if (res.ipCheck && res.ipCheck.ok) {
          showToast(\`출구 IP 확인: \${res.ipCheck.ip} (\${res.ipCheck.country || '-'}, \${res.ipCheck.latencyMs}ms)\`, '#10b981');
        } else {
          showToast(\`IP 테스트 실패: \${res.ipCheck?.error || '연결 불가'}\`, '#ef4444');
        }
        await refreshState();
      } catch (err) {
        showToast('IP 확인 오류: ' + err.message, '#ef4444');
      }
    }

    async function refreshQuota(profileId) {
      try {
        showToast('실시간 모델 쿼터 및 플랜 정보를 조회 중입니다...');
        await apiCall(\`/api/profiles/\${profileId}/refresh-quota\`, {
          method: 'POST',
          body: '{}',
        });
        showToast('쿼터 조회 완료!', '#10b981');
        await refreshState();
      } catch (err) {
        showToast('쿼터 조회 실패: ' + err.message, '#ef4444');
      }
    }

    async function launchProfile(profileId) {
      try {
        showToast('격리된 Antigravity 인스턴스 및 스텔스 게이트웨이를 시작합니다...');
        const res = await apiCall(\`/api/profiles/\${profileId}/launch\`, {
          method: 'POST',
          body: '{}',
        });
        showToast(\`실행됨: \${res.instance.profileName} (PID \${res.instance.pid})\`, '#10b981');
        await refreshState();
      } catch (err) {
        showToast('인스턴스 실행 실패: ' + err.message, '#ef4444');
      }
    }

    async function stopProfile(profileId) {
      try {
        await apiCall(\`/api/profiles/\${profileId}/stop\`, {
          method: 'POST',
          body: '{}',
        });
        showToast('인스턴스가 종료되었습니다.');
        await refreshState();
      } catch (err) {
        showToast('종료 실패: ' + err.message, '#ef4444');
      }
    }

    async function launchSelectedProfiles() {
      const ids = Array.from(selectedProfiles);
      if (ids.length === 0) {
        showToast('동시 실행할 프로필을 먼저 체크박스로 선택해주세요.', '#f59e0b');
        return;
      }
      try {
        showToast(\`\${ids.length}개 프로필을 동시에 격리 실행합니다...\`);
        const res = await apiCall('/api/instances/launch-batch', {
          method: 'POST',
          body: JSON.stringify({ profileIds: ids }),
        });
        showToast(\`\${res.launched.length}개 인스턴스 실행 완료!\`, '#10b981');
        await refreshState();
      } catch (err) {
        showToast('일괄 실행 실패: ' + err.message, '#ef4444');
      }
    }

    async function stopAllInstances() {
      try {
        await apiCall('/api/instances/stop-all', { method: 'POST', body: '{}' });
        showToast('모든 실행 중인 인스턴스를 종료했습니다.');
        await refreshState();
      } catch (err) {
        showToast('전체 종료 실패: ' + err.message, '#ef4444');
      }
    }

    async function deleteProfile(profileId) {
      if (!confirm('이 프로필과 격리 디스크 데이터를 삭제하시겠습니까?')) return;
      try {
        await apiCall(\`/api/profiles/\${profileId}?removeDisk=true\`, { method: 'DELETE' });
        selectedProfiles.delete(profileId);
        showToast('프로필이 삭제되었습니다.');
        await refreshState();
      } catch (err) {
        showToast('삭제 실패: ' + err.message, '#ef4444');
      }
    }

    function openSettingsModal() {
      const s = appState.settings || {};
      document.getElementById('sm-exe-path').value = s.antigravityExecutablePath || '';
      document.getElementById('sm-timezone').value = s.defaultTimezone || 'Asia/Seoul';
      document.getElementById('sm-locale').value = s.defaultLocale || 'ko-KR';
      document.getElementById('sm-import-json').value = '';
      document.getElementById('settings-modal').classList.add('open');
    }

    async function saveSettings() {
      try {
        await apiCall('/api/settings', {
          method: 'PUT',
          body: JSON.stringify({
            antigravityExecutablePath: document.getElementById('sm-exe-path').value.trim(),
            defaultTimezone: document.getElementById('sm-timezone').value.trim(),
            defaultLocale: document.getElementById('sm-locale').value.trim(),
          }),
        });
        showToast('전역 설정이 저장되었습니다.', '#10b981');
        await refreshState();
      } catch (err) {
        showToast('설정 저장 실패: ' + err.message, '#ef4444');
      }
    }

    async function exportProfilesJson() {
      const res = await fetch('/api/export');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'anti-multi-profiles-backup.json';
      a.click();
      URL.revokeObjectURL(url);
    }

    async function importProfilesJson() {
      const raw = document.getElementById('sm-import-json').value.trim();
      if (!raw) {
        showToast('가져올 JSON 데이터를 입력해주세요.', '#f59e0b');
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        const profiles = Array.isArray(parsed) ? parsed : (parsed.profiles || []);
        const res = await apiCall('/api/import', {
          method: 'POST',
          body: JSON.stringify({ profiles }),
        });
        showToast(\`\${res.count}개 프로필을 가져왔습니다!\`, '#10b981');
        closeModal('settings-modal');
        await refreshState();
      } catch (err) {
        showToast('JSON 가져오기 실패: ' + err.message, '#ef4444');
      }
    }

    window.addEventListener('message', (ev) => {
      if (ev.data && ev.data.type === 'anti-multi-oauth-complete') {
        closeModal('oauth-modal');
        showToast('Google OAuth 계정 인증이 완료되었습니다!', '#10b981');
        refreshState();
      }
    });

    refreshState();
    setInterval(refreshState, 4000);
  </script>
</body>
</html>`;
}
