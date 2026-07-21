const { useState, useEffect, useRef, useCallback } = React;

/* ============================================================
   UTILITIES
   ============================================================ */
function pad(n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); }
function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return `${pad(m)}:${pad(sec)}`;
}
function formatTimeFull(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}:${pad(m)}:${pad(sec)}`;
}
function formatTimeWithMs(ms) {
  const totalCs = Math.floor(ms / 10);
  const cs = totalCs % 100;
  const totalSec = Math.floor(ms / 1000);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return { min: pad(min), sec: pad(sec), cs: pad(cs) };
}
function getDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function getTodayKey() { return getDateKey(new Date()); }
function formatSessionDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function loadLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return fallback;
    return JSON.parse(v);
  } catch { return fallback; }
}
function saveLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

/* ============================================================
   NOTIFICATIONS (Web Notification + beep)
   ============================================================ */
async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission;
  }
  try { return await Notification.requestPermission(); }
  catch { return 'denied'; }
}
function playBeep(frequency = 880, duration = 0.18, type = 'sine') {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain); gain.connect(ctx.destination);
    osc.start(); osc.stop(ctx.currentTime + duration + 0.02);
    setTimeout(() => ctx.close && ctx.close(), (duration + 0.1) * 1000);
  } catch {}
}
function playCompletionSound(kind) {
  // work-done: rising chord, break-done: single higher ping
  if (kind === 'work') {
    playBeep(660, 0.16);
    setTimeout(() => playBeep(880, 0.18), 180);
    setTimeout(() => playBeep(1175, 0.28), 380);
  } else {
    playBeep(1175, 0.15);
    setTimeout(() => playBeep(880, 0.22), 180);
  }
}
function fireNotification(title, body) {
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: '/favicon.ico', tag: 'pomodoro', renotify: true });
      setTimeout(() => { try { n.close(); } catch {} }, 8000);
    }
  } catch {}
}

/* ============================================================
   NOTION SETTINGS
   ============================================================ */
const NOTION_BASE = '/api/notion-api'; // Nitro server route: server/routes/api/notion-api/[...path].ts
const DEFAULT_NOTION_SETTINGS = { apiKey: '', databaseId: '' };
const NOTION_DATE_PROP = '날짜';

async function notionFetch(path, apiKey, init = {}) {
  const res = await fetch(NOTION_BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Notion-Version': '2022-06-28',
      ...(init.headers || {}),
    },
  });
  return res;
}

/* ============================================================
   MAC WINDOW WRAPPER (with drag reorder + resize)
   ============================================================ */
function MacWindow({ id, title, size, onResize, onDragStart, onDragOver, onDrop, onDragEnd, draggingId, dropTargetId, children, draggable = true }) {
  const isDragging = draggingId === id;
  const isTarget = dropTargetId === id && draggingId !== id;

  return (
    <div
      className={`grid-item size-${size}${isDragging ? ' dragging' : ''}${isTarget ? ' drop-target' : ''}`}
      onDragOver={(e) => { e.preventDefault(); onDragOver && onDragOver(id); }}
      onDrop={(e) => { e.preventDefault(); onDrop && onDrop(id); }}
    >
      <div className="mac-win">
        <div
          className={`mac-titlebar${draggable ? '' : ' no-drag'}`}
          draggable={draggable}
          onDragStart={(e) => {
            if (!draggable) return;
            e.dataTransfer.effectAllowed = 'move';
            try { e.dataTransfer.setData('text/plain', id); } catch {}
            onDragStart && onDragStart(id);
          }}
          onDragEnd={() => onDragEnd && onDragEnd()}
          title={draggable ? '드래그해서 위치 이동' : ''}
        >
          <div className="mac-lights">
            <span className="mac-light close" />
            <span className="mac-light min" />
            <span className="mac-light max" />
          </div>
          <div className="mac-title-box">{title}</div>
          <div className="mac-title-resize">
            {['sm', 'md', 'lg'].map(s => (
              <button
                key={s}
                className={`mac-size-btn${size === s ? ' active' : ''}`}
                onClick={() => onResize(id, s)}
                title={s === 'sm' ? '작게' : s === 'md' ? '중간' : '크게'}
                aria-label={`크기 ${s.toUpperCase()}`}
              >
                {s === 'sm' ? 'S' : s === 'md' ? 'M' : 'L'}
              </button>
            ))}
          </div>
        </div>
        <div className="mac-body">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================
   MENUBAR (classic mac top bar)
   ============================================================ */
function MacMenubar({ theme, onToggleTheme, onOpenNotion, onOpenPomodoroSettings }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30 * 1000);
    return () => clearInterval(id);
  }, []);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return (
    <div className="mac-menubar">
      <span className="mac-menubar-apple"></span>
      <span className="mac-menubar-item"><b>File</b></span>
      <span className="mac-menubar-item">Edit</span>
      <span className="mac-menubar-item" onClick={onOpenPomodoroSettings} style={{ cursor: 'pointer' }}>⚙ Pomodoro</span>
      <span className="mac-menubar-item" onClick={onOpenNotion} style={{ cursor: 'pointer' }}>Notion</span>
      <span className="mac-menubar-item" onClick={onToggleTheme} style={{ cursor: 'pointer' }}>
        {theme === 'pink' ? '💙 Blue' : '💗 Pink'}
      </span>
      <span className="mac-menubar-spacer" />
      <span className="mac-menubar-clock">{time}</span>
    </div>
  );
}

/* ============================================================
   POMODORO
   ============================================================ */
function Pomodoro({ state, dispatch, onOpenSettings, notificationsEnabled }) {
  const intervalRef = useRef(null);
  const prevSessionsLen = useRef(state.sessions.length);
  const prevMode = useRef(state.mode);
  const { timeLeft, isRunning, mode, sessions, workDuration, breakDuration } = state;

  useEffect(() => {
    // Fire notification when a work session completes (sessions array grew)
    // or when a break ends (mode flips back to work with no new session).
    const workDone = sessions.length > prevSessionsLen.current;
    const breakDone = !workDone && prevMode.current === 'break' && mode === 'work';
    if (workDone) {
      if (notificationsEnabled !== false) {
        fireNotification('🍅 작업 세션 완료!', `수고했어요. ${Math.round(breakDuration / 60)}분 휴식을 시작합니다.`);
        playCompletionSound('work');
      }
    } else if (breakDone) {
      if (notificationsEnabled !== false) {
        fireNotification('☕ 휴식 종료', `다음 ${Math.round(workDuration / 60)}분 작업 세션을 시작해요.`);
        playCompletionSound('break');
      }
    }
    prevSessionsLen.current = sessions.length;
    prevMode.current = mode;
  }, [sessions.length, mode, notificationsEnabled, breakDuration, workDuration]);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => dispatch({ type: 'POMODORO_TICK' }), 1000);
    } else {
      clearInterval(intervalRef.current);
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, dispatch]);

  const totalDuration = mode === 'work' ? workDuration : breakDuration;
  const circumference = 2 * Math.PI * 90;
  const progress = timeLeft / totalDuration;
  const dashOffset = circumference * (1 - progress);
  const recentSessions = sessions.slice(-4).reverse();

  return (
    <div className="pomodoro-container">
      <div className="pomodoro-toprow">
        <div className="mode-toggle-pill">
          <button className={`mode-toggle-btn${mode === 'work' ? ' active' : ''}`} onClick={() => dispatch({ type: 'POMODORO_SET_MODE', mode: 'work' })}>
            작업 {formatTime(workDuration)}
          </button>
          <button className={`mode-toggle-btn${mode === 'break' ? ' active' : ''}`} onClick={() => dispatch({ type: 'POMODORO_SET_MODE', mode: 'break' })}>
            휴식 {formatTime(breakDuration)}
          </button>
        </div>
        <button className="btn-icon" onClick={onOpenSettings} title="시간 설정" aria-label="포모도로 시간 설정">⚙</button>
      </div>

      <div className="timer-ring-wrapper">
        <svg className="timer-ring-svg" viewBox="0 0 220 220">
          <circle className="timer-ring-bg" cx="110" cy="110" r="90" />
          <circle className="timer-ring-fill" cx="110" cy="110" r="90" strokeDasharray={circumference} strokeDashoffset={dashOffset} />
        </svg>
        <div className="timer-display">{formatTime(timeLeft)}</div>
      </div>

      <div className="pomodoro-controls">
        <button className="btn-primary large" onClick={() => dispatch({ type: 'POMODORO_TOGGLE' })}>
          {isRunning ? '일시정지' : '시작'}
        </button>
        <button className="btn-secondary" onClick={() => dispatch({ type: 'POMODORO_RESET' })}>리셋</button>
        <button className="btn-secondary" onClick={() => dispatch({ type: 'POMODORO_SKIP' })}>건너뛰기</button>
      </div>

      <div className="session-counter">
        <span>🍅</span><span>완료한 세션: <strong>{sessions.length}</strong></span>
      </div>

      {recentSessions.length > 0 ? (
        <div className="session-list">
          <div className="session-list-title">최근 완료</div>
          {recentSessions.map((s, i) => (
            <div className="session-item" key={i}>
              <span className="session-item-type">🍅</span>
              <span className="session-item-date">{formatSessionDate(s.date)}</span>
              <span className="session-item-duration">{formatTimeFull(s.duration)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state">아직 완료한 세션이 없어요.</div>
      )}
    </div>
  );
}

/* ============================================================
   POMODORO SETTINGS MODAL
   ============================================================ */
function PomodoroSettingsModal({ work, brk, notificationsEnabled, onSave, onClose }) {
  const [w, setW] = useState(Math.round(work / 60));
  const [b, setB] = useState(Math.round(brk / 60));
  const [notif, setNotif] = useState(notificationsEnabled !== false);
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  async function handleToggleNotif(next) {
    setNotif(next);
    if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const p = await requestNotificationPermission();
      setPermission(p);
    }
  }

  async function handleSave() {
    const wm = Math.max(1, Math.min(180, parseInt(w, 10) || 25));
    const bm = Math.max(1, Math.min(60, parseInt(b, 10) || 5));
    if (notif && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await requestNotificationPermission();
    }
    onSave({ work: wm * 60, brk: bm * 60, notificationsEnabled: notif });
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-titlebar">
          <div className="mac-lights">
            <button className="mac-light close" onClick={onClose} aria-label="닫기" />
            <span className="mac-light min" />
            <span className="mac-light max" />
          </div>
          <div className="modal-title-text">Pomodoro 설정</div>
        </div>
        <div className="modal-body">
          <div className="modal-desc">
            집중 시간과 휴식 시간을 분 단위로 직접 설정하세요.
          </div>
          <div className="settings-duration-row">
            <div className="form-group">
              <span className="form-label">🍅 작업 (분)</span>
              <input
                type="number"
                min="1" max="180"
                className="form-input duration-input"
                value={w}
                onChange={e => setW(e.target.value)}
              />
            </div>
            <div className="form-group">
              <span className="form-label">☕ 휴식 (분)</span>
              <input
                type="number"
                min="1" max="60"
                className="form-input duration-input"
                value={b}
                onChange={e => setB(e.target.value)}
              />
            </div>
          </div>
          <div className="form-hint" style={{ marginTop: 6 }}>
            변경 사항은 다음 세션부터 적용됩니다.
          </div>

          <div className="settings-toggle-row">
            <div>
              <div className="settings-toggle-label">🔔 세션 완료 알림</div>
              <div className="settings-toggle-hint">
                {permission === 'denied'
                  ? '브라우저에서 알림이 차단되어 있어요. 소리만 재생됩니다.'
                  : permission === 'unsupported'
                    ? '이 브라우저는 알림을 지원하지 않아요. 소리만 재생됩니다.'
                    : '작업/휴식이 끝나면 알림과 소리로 알려드려요.'}
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={notif}
                onChange={e => handleToggleNotif(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </label>
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => { playCompletionSound('work'); if (notif) fireNotification('🍅 알림 테스트', '이렇게 알림이 표시돼요.'); }}>
              테스트
            </button>
            <button className="btn-secondary" onClick={onClose}>취소</button>
            <button className="btn-primary" onClick={handleSave}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   STOPWATCH
   ============================================================ */
function Stopwatch({ state, dispatch }) {
  const intervalRef = useRef(null);
  const startTimeRef = useRef(null);
  const accumulatedRef = useRef(0);
  const { elapsedMs, isRunning, laps } = state;

  useEffect(() => {
    if (isRunning) {
      startTimeRef.current = Date.now();
      intervalRef.current = setInterval(() => {
        const delta = Date.now() - startTimeRef.current;
        dispatch({ type: 'SW_SET_ELAPSED', ms: accumulatedRef.current + delta });
      }, 50);
    } else {
      clearInterval(intervalRef.current);
      accumulatedRef.current = elapsedMs;
    }
    return () => clearInterval(intervalRef.current);
  }, [isRunning, dispatch]);

  useEffect(() => { if (!isRunning) accumulatedRef.current = elapsedMs; }, [elapsedMs, isRunning]);

  const fmt = formatTimeWithMs(elapsedMs);
  const lapTotals = laps.map((_, i) => laps.slice(0, i + 1).reduce((s, l) => s + l, 0));
  const lapMs = laps.map((total, i) => i === 0 ? total : total - laps[i - 1]);
  const avgLap = laps.length > 0 ? elapsedMs / laps.length : 0;

  return (
    <div className="stopwatch-container">
      <div className="stopwatch-display">
        {fmt.min}:{fmt.sec}<span className="ms">.{fmt.cs}</span>
      </div>
      <div className="stopwatch-controls">
        <button className="btn-primary large" onClick={() => dispatch({ type: 'SW_TOGGLE' })}>
          {isRunning ? '정지' : '시작'}
        </button>
        <button className="btn-secondary" onClick={() => dispatch({ type: 'SW_LAP' })} disabled={!isRunning && elapsedMs === 0}>랩</button>
        <button className="btn-secondary" onClick={() => { accumulatedRef.current = 0; dispatch({ type: 'SW_RESET' }); }}>리셋</button>
      </div>

      {laps.length > 0 && (
        <div className="lap-list">
          <div className="lap-list-header"><span>랩</span><span>랩 시간</span><span>총 시간</span></div>
          <div className="lap-list-body">
            {[...laps].reverse().map((_, ri) => {
              const i = laps.length - 1 - ri;
              const lf = formatTimeWithMs(lapMs[i]);
              const tf = formatTimeWithMs(lapTotals[i]);
              return (
                <div className="lap-row" key={i}>
                  <span className="lap-num">랩 {i + 1}</span>
                  <span className="lap-time">{lf.min}:{lf.sec}.{lf.cs}</span>
                  <span className="lap-total">{tf.min}:{tf.sec}.{tf.cs}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="stopwatch-summary">
        <div className="summary-stat"><div className="summary-stat-label">총 시간</div><div className="summary-stat-value">{fmt.min}:{fmt.sec}.{fmt.cs}</div></div>
        <div className="summary-stat"><div className="summary-stat-label">랩 수</div><div className="summary-stat-value">{laps.length}</div></div>
        <div className="summary-stat"><div className="summary-stat-label">평균 랩</div><div className="summary-stat-value">
          {laps.length > 0 ? (() => { const f = formatTimeWithMs(avgLap); return `${f.min}:${f.sec}.${f.cs}`; })() : '--:--.--'}
        </div></div>
      </div>
    </div>
  );
}

/* ============================================================
   TIME CALCULATOR
   ============================================================ */
function TimeCalculator({ pomodoroSessions, swSessions, targetMinutes, onSetTarget }) {
  const PRESETS = [30, 60, 120, 240];
  const pomodoroTotalSec = pomodoroSessions.reduce((s, x) => s + x.duration, 0);
  const swTotalSec = swSessions.reduce((s, x) => s + Math.floor(x.duration / 1000), 0);
  const totalSeconds = pomodoroTotalSec + swTotalSec;
  const targetSeconds = (targetMinutes || 0) * 60;
  const percentage = targetSeconds > 0 ? Math.min((totalSeconds / targetSeconds) * 100, 100) : 0;
  const remaining = Math.max(targetSeconds - totalSeconds, 0);

  const allSessions = [
    ...pomodoroSessions.map(s => ({ type: 'pomodoro', date: s.date, duration: s.duration * 1000 })),
    ...swSessions.map(s => ({ type: 'stopwatch', date: s.date, duration: s.duration })),
  ].sort((a, b) => b.date - a.date).slice(0, 8);

  return (
    <div className="calculator-container">
      <div>
        <div className="target-section">
          <div className="target-input-row">
            <span className="target-input-label">목표 시간</span>
            <input
              type="number" min="0" className="target-input"
              value={targetMinutes || ''}
              onChange={e => { const v = parseInt(e.target.value, 10); onSetTarget(isNaN(v) || v < 0 ? 0 : v); }}
              placeholder="분"
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>분</span>
          </div>
          <div className="preset-buttons">
            {PRESETS.map(p => (
              <button key={p} className={`btn-preset${targetMinutes === p ? ' active-preset' : ''}`} onClick={() => onSetTarget(p)}>
                {p < 60 ? `${p}분` : `${p / 60}시간`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="progress-bar-wrapper">
        <div className="progress-bar-track">
          <div className="progress-bar-fill" style={{ width: `${percentage}%` }}>
            {percentage >= 8 && <span className="progress-pct-text">{Math.floor(percentage)}%</span>}
          </div>
        </div>
        {percentage === 100 && (
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <div className="achievement-badge"><span>🎉</span><span>목표 달성!</span></div>
          </div>
        )}
      </div>

      <div className="stats-grid">
        <div className="stat-card"><div className="stat-card-label">목표</div><div className="stat-card-value">{formatTimeFull(targetSeconds)}</div></div>
        <div className="stat-card"><div className="stat-card-label">달성</div><div className="stat-card-value">{formatTimeFull(totalSeconds)}</div></div>
        <div className="stat-card"><div className="stat-card-label">남은</div><div className="stat-card-value">{formatTimeFull(remaining)}</div></div>
      </div>

      <div>
        <div className="calculator-sessions-title">통합 세션 기록</div>
        {allSessions.length === 0 ? (
          <div className="empty-state">아직 기록된 세션이 없습니다.</div>
        ) : (
          allSessions.map((s, i) => {
            const durSec = s.type === 'pomodoro' ? s.duration : Math.floor(s.duration / 1000);
            return (
              <div className="session-item" key={i}>
                <span className="session-item-type">{s.type === 'pomodoro' ? '🍅' : '⏱'}</span>
                <span className="session-item-date">{formatSessionDate(s.date)}</span>
                <span className="session-item-duration">{formatTimeFull(durSec)}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE (not a draggable card — stays at top)
   ============================================================ */
function ProfileBar({ profile, onChange, theme, onToggleTheme }) {
  const fileInputRef = useRef(null);
  return (
    <div className="mac-win">
      <div className="mac-titlebar no-drag">
        <button className="mac-title-close" aria-label="닫기 (사용 안함)" onClick={e => e.preventDefault()} />
        <div className="mac-title-box">🌸 Profile</div>
      </div>
      <div className="mac-body profile-card">
        <input
          type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }}
          onChange={e => {
            const file = e.target.files && e.target.files[0];
            if (!file || !file.type.startsWith('image/')) return;
            if (file.size > 3 * 1024 * 1024) { alert('3MB 이하 이미지를 사용해주세요.'); return; }
            const reader = new FileReader();
            reader.onload = () => onChange({ ...profile, avatar: reader.result });
            reader.readAsDataURL(file);
          }}
        />
        <button className="profile-avatar-btn" onClick={() => fileInputRef.current && fileInputRef.current.click()} title="프로필 사진 변경">
          {profile.avatar
            ? <img className="profile-avatar-img" src={profile.avatar} alt="" />
            : <span className="profile-avatar-placeholder">📷</span>}
        </button>
        <div className="profile-fields">
          <input
            type="text" className="profile-nickname-input"
            value={profile.nickname}
            onChange={e => onChange({ ...profile, nickname: e.target.value })}
            placeholder="닉네임을 입력하세요"
          />
          <input
            type="text" className="profile-status-input"
            value={profile.status || ''}
            onChange={e => onChange({ ...profile, status: e.target.value })}
            placeholder="상태 메시지를 입력하세요"
            maxLength={60}
          />
        </div>
        <button className="profile-theme-btn" onClick={onToggleTheme} title="테마 변경">
          {theme === 'pink' ? '💙' : '💗'}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   TODO
   ============================================================ */
function TodoList({ todos, dispatch }) {
  const [text, setText] = useState('');
  const pending = todos.filter(t => !t.done);
  const completed = todos.filter(t => t.done);
  return (
    <div className="todo-container">
      <form className="todo-add-row" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (!t) return; dispatch({ type: 'TODO_ADD', text: t }); setText(''); }}>
        <input type="text" className="form-input" value={text} onChange={e => setText(e.target.value)} placeholder="할 일을 입력하고 Enter" />
        <button type="submit" className="btn-primary">추가</button>
      </form>
      {todos.length === 0 && <div className="empty-state">아직 할 일이 없습니다.</div>}
      {[...pending, ...completed].map(t => (
        <div className={`todo-item${t.done ? ' done' : ''}`} key={t.id}>
          <button className="todo-check" onClick={() => dispatch({ type: 'TODO_TOGGLE', id: t.id })}>{t.done ? '✓' : ''}</button>
          <span className="todo-text">{t.text}</span>
          <button className={`todo-repeat-btn${t.repeat ? ' active' : ''}`} onClick={() => dispatch({ type: 'TODO_TOGGLE_REPEAT', id: t.id })} title="매일 반복">🔁</button>
          <button className="todo-delete-btn" onClick={() => dispatch({ type: 'TODO_DELETE', id: t.id })} title="삭제">🗑</button>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   MEMO FEED
   ============================================================ */
function MemoFeed({ profile, posts, onAdd, onDelete }) {
  const [text, setText] = useState('');
  return (
    <div className="memo-feed">
      <form className="memo-compose" onSubmit={e => { e.preventDefault(); const t = text.trim(); if (!t) return; onAdd(t); setText(''); }}>
        <div className="memo-compose-avatar">
          {profile.avatar ? <img className="profile-avatar-img" src={profile.avatar} alt="" /> : <span className="profile-avatar-placeholder">📷</span>}
        </div>
        <div className="memo-compose-fields">
          <textarea className="memo-compose-textarea" value={text} onChange={e => setText(e.target.value)} placeholder="무슨 생각을 하고 계신가요?" rows={3} />
          <div className="memo-compose-actions">
            <span className="form-hint">{text.length.toLocaleString()}자</span>
            <button type="submit" className="btn-primary" disabled={!text.trim()}>게시</button>
          </div>
        </div>
      </form>
      {posts.length === 0 && <div className="empty-state">아직 작성한 메모가 없습니다.</div>}
      <div className="memo-timeline">
        {posts.map(p => (
          <div className="memo-post" key={p.id}>
            <div className="memo-post-avatar">
              {profile.avatar ? <img className="profile-avatar-img" src={profile.avatar} alt="" /> : <span className="profile-avatar-placeholder">📷</span>}
            </div>
            <div className="memo-post-body">
              <div className="memo-post-header">
                <span className="memo-post-nickname">{profile.nickname || '이름 없음'}</span>
                <span className="memo-post-time">{formatSessionDate(p.date)}</span>
                <button className="memo-post-delete" onClick={() => onDelete(p.id)} title="삭제">🗑</button>
              </div>
              <div className="memo-post-text">{p.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   NOTION SYNC
   ============================================================ */
function NotionSync({ settings, totalMinutes, onOpenSettings }) {
  const [charCount, setCharCount] = useState(() => loadLS('wt_charcount', ''));
  const [status, setStatus] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { saveLS('wt_charcount', charCount); }, [charCount]);

  async function handleSend() {
    if (!settings.apiKey || !settings.databaseId) {
      setStatus({ type: 'error', msg: '먼저 Notion 설정에서 API 키와 데이터베이스를 선택해주세요.' });
      return;
    }
    setSending(true); setStatus(null);
    const properties = {
      [NOTION_DATE_PROP]: { date: { start: getTodayKey() } },
      '글자 수': { number: charCount === '' ? 0 : Number(charCount) },
      '집중': { number: totalMinutes },
    };
    try {
      const res = await notionFetch('/v1/pages', settings.apiKey, {
        method: 'POST',
        body: JSON.stringify({ parent: { database_id: settings.databaseId }, properties }),
      });
      if (!res.ok) {
        let msg = `요청 실패 (HTTP ${res.status})`;
        try { const err = await res.json(); if (err && err.message) msg = err.message; } catch {}
        throw new Error(msg);
      }
      setStatus({ type: 'success', msg: '노션 캘린더에 전송되었습니다! 🎉' });
    } catch (e) {
      setStatus({ type: 'error', msg: e.message || '전송 중 오류가 발생했습니다.' });
    } finally {
      setSending(false);
    }
  }

  return (
    <div>
      <div className="card-title-row">
        <div className="card-title">📤 노션 캘린더</div>
        <button className="btn-icon" onClick={onOpenSettings} title="Notion 설정">⚙</button>
      </div>
      <div className="notion-field-row">
        <div className="form-group" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <span className="form-label">글자 수</span>
          <input type="text" inputMode="numeric" className="form-input" value={charCount}
            onChange={e => { const v = e.target.value; if (v === '' || /^[0-9]*$/.test(v)) setCharCount(v); }}
            placeholder="예: 1500" />
        </div>
        <div className="form-group" style={{ flex: 1, minWidth: 120, marginBottom: 0 }}>
          <span className="form-label">집중 (자동)</span>
          <div className="notion-auto-value">{totalMinutes}분</div>
        </div>
      </div>
      <div className="form-hint" style={{ marginTop: 8 }}>
        날짜는 오늘({getTodayKey()})로 전송, '집중'은 포모도로·스톱워치 총합입니다.
      </div>
      {status && <div className={`sync-status ${status.type}`}>{status.msg}</div>}
      <button className="btn-primary" onClick={handleSend} disabled={sending} style={{ marginTop: 12 }}>
        {sending ? '전송 중...' : '노션으로 전송'}
      </button>
    </div>
  );
}

/* ============================================================
   NOTION SETTINGS MODAL
   ============================================================ */
function NotionSettingsModal({ settings, onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  const [dbList, setDbList] = useState([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState(null);
  const [manualDbEntry, setManualDbEntry] = useState(false);

  function update(key, value) { setDraft(prev => ({ ...prev, [key]: value })); }

  useEffect(() => {
    if (!draft.apiKey || draft.apiKey.trim().length < 10) {
      setDbList([]); setDbError(null); return;
    }
    const timer = setTimeout(() => fetchDatabases(draft.apiKey.trim()), 700);
    return () => clearTimeout(timer);
  }, [draft.apiKey]);

  async function fetchDatabases(apiKey) {
    setDbLoading(true); setDbError(null);
    try {
      const res = await notionFetch('/v1/search', apiKey, {
        method: 'POST',
        body: JSON.stringify({ filter: { value: 'database', property: 'object' }, page_size: 50 }),
      });
      if (!res.ok) {
        let msg = `목록을 불러오지 못했습니다 (HTTP ${res.status})`;
        try { const err = await res.json(); if (err && err.message) msg = err.message; } catch {}
        throw new Error(msg);
      }
      const data = await res.json();
      const dbs = (data.results || []).map(r => {
        const titleArr = (r.title && r.title.length ? r.title : (r.properties && r.properties.title && r.properties.title.title)) || [];
        const title = titleArr.map(t => t.plain_text).join('') || '(제목 없음)';
        return { id: r.id, title };
      });
      setDbList(dbs);
      if (dbs.length && !dbs.some(d => d.id === draft.databaseId)) update('databaseId', dbs[0].id);
    } catch (e) {
      setDbError(e.message || '데이터베이스 목록을 불러오지 못했습니다.');
      setDbList([]);
    } finally { setDbLoading(false); }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-titlebar">
          <button className="mac-title-close" onClick={onClose} aria-label="닫기" />
          <div className="modal-title-text">📤 Notion 연동 설정</div>
        </div>
        <div className="modal-body">
          <div className="modal-desc">
            Notion Integration Secret과 대상 데이터베이스를 선택하세요. 값은 브라우저 localStorage에만 저장됩니다.
          </div>
          <div className="modal-warning">
            ✅ CORS 프록시는 이 앱에 내장되어 있습니다 (Cloudflare Pages Function). 별도의 프록시 URL을 입력할 필요가 없습니다.
          </div>

          <div className="form-group">
            <span className="form-label">Notion API 키 (Integration Secret)</span>
            <input
              type="password" className="form-input"
              value={draft.apiKey}
              onChange={e => update('apiKey', e.target.value)}
              placeholder="secret_... 또는 ntn_..."
            />
            <span className="form-hint">
              notion.so → Integrations에서 만든 통합의 Internal Integration Secret을 붙여넣고, 대상 데이터베이스를 해당 통합과 공유하세요.
            </span>
          </div>

          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="form-label">데이터베이스</span>
              <button type="button" className="link-btn" onClick={() => setManualDbEntry(v => !v)}>
                {manualDbEntry ? '목록에서 선택' : '직접 입력'}
              </button>
            </div>
            {!manualDbEntry ? (
              <>
                {dbLoading && <span className="form-hint">데이터베이스 목록을 불러오는 중...</span>}
                {!dbLoading && dbList.length > 0 && (
                  <select className="form-input" value={draft.databaseId} onChange={e => update('databaseId', e.target.value)}>
                    {dbList.map(db => <option key={db.id} value={db.id}>{db.title}</option>)}
                  </select>
                )}
                {!dbLoading && dbList.length === 0 && !dbError && (
                  <span className="form-hint">API 키를 입력하면 연결된 데이터베이스 목록을 자동으로 불러옵니다.</span>
                )}
                {!dbLoading && dbError && (
                  <span className="form-hint" style={{ color: 'var(--accent-strong)' }}>{dbError}</span>
                )}
              </>
            ) : (
              <input type="text" className="form-input" value={draft.databaseId}
                onChange={e => update('databaseId', e.target.value)}
                placeholder="노션 데이터베이스 URL의 32자리 ID" />
            )}
          </div>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={onClose}>취소</button>
            <button className="btn-primary" onClick={() => { onSave(draft); onClose(); }}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   REDUCERS
   ============================================================ */
const WORK_DURATION = 25 * 60;
const BREAK_DURATION = 5 * 60;

function getInitialPomodoro() {
  const saved = loadLS('wt_pomodoro_settings', { workDuration: WORK_DURATION, breakDuration: BREAK_DURATION });
  return {
    timeLeft: saved.workDuration,
    isRunning: false,
    mode: 'work',
    sessions: loadLS('wt_pomodoro_sessions', []),
    workDuration: saved.workDuration,
    breakDuration: saved.breakDuration,
  };
}
function pomodoroReducer(state, action) {
  switch (action.type) {
    case 'POMODORO_TOGGLE': return { ...state, isRunning: !state.isRunning };
    case 'POMODORO_TICK': {
      if (state.timeLeft <= 1) {
        if (state.mode === 'work') {
          return { ...state, isRunning: true, mode: 'break', timeLeft: state.breakDuration,
            sessions: [...state.sessions, { duration: state.workDuration, date: Date.now() }] };
        }
        return { ...state, isRunning: true, mode: 'work', timeLeft: state.workDuration };
      }
      return { ...state, timeLeft: state.timeLeft - 1 };
    }
    case 'POMODORO_RESET': return { ...state, isRunning: false, timeLeft: state.workDuration, mode: 'work' };
    case 'POMODORO_SKIP': return state.mode === 'work'
      ? { ...state, isRunning: false, mode: 'break', timeLeft: state.breakDuration }
      : { ...state, isRunning: false, mode: 'work', timeLeft: state.workDuration };
    case 'POMODORO_SET_MODE': return { ...state, isRunning: false, mode: action.mode,
      timeLeft: action.mode === 'work' ? state.workDuration : state.breakDuration };
    case 'POMODORO_SET_DURATIONS': {
      const next = { ...state, workDuration: action.work, breakDuration: action.brk };
      if (!state.isRunning) next.timeLeft = state.mode === 'work' ? action.work : action.brk;
      return next;
    }
    default: return state;
  }
}

function getInitialStopwatch() {
  return { elapsedMs: 0, isRunning: false, laps: [], savedSessions: loadLS('wt_stopwatch_sessions', []) };
}
function stopwatchReducer(state, action) {
  switch (action.type) {
    case 'SW_TOGGLE': return { ...state, isRunning: !state.isRunning };
    case 'SW_SET_ELAPSED': return { ...state, elapsedMs: action.ms };
    case 'SW_LAP': return state.elapsedMs === 0 ? state : { ...state, laps: [...state.laps, state.elapsedMs] };
    case 'SW_RESET': {
      const newSessions = state.elapsedMs > 1000
        ? [...state.savedSessions, { duration: state.elapsedMs, date: Date.now() }]
        : state.savedSessions;
      return { ...state, isRunning: false, elapsedMs: 0, laps: [], savedSessions: newSessions };
    }
    default: return state;
  }
}

function getInitialTodos() { return loadLS('wt_todos', []); }
function todoReducer(state, action) {
  switch (action.type) {
    case 'TODO_ADD': return [...state, { id: Date.now() + Math.random().toString(36).slice(2), text: action.text, done: false, repeat: false }];
    case 'TODO_TOGGLE': return state.map(t => t.id === action.id ? { ...t, done: !t.done } : t);
    case 'TODO_TOGGLE_REPEAT': return state.map(t => t.id === action.id ? { ...t, repeat: !t.repeat } : t);
    case 'TODO_DELETE': return state.filter(t => t.id !== action.id);
    case 'TODO_RESET_REPEATING': return state.map(t => t.repeat ? { ...t, done: false } : t);
    default: return state;
  }
}

const DEFAULT_PROFILE = { nickname: '', avatar: null, status: '' };

/* ============================================================
   CARD LAYOUT (order + sizes)
   ============================================================ */
const DEFAULT_LAYOUT = [
  { id: 'pomodoro',   size: 'md' },
  { id: 'stopwatch',  size: 'md' },
  { id: 'todo',       size: 'sm' },
  { id: 'calculator', size: 'md' },
  { id: 'notion',     size: 'sm' },
  { id: 'memo',       size: 'lg' },
];
function loadLayout() {
  const saved = loadLS('wt_layout_v2', null);
  if (!Array.isArray(saved)) return DEFAULT_LAYOUT;
  const knownIds = DEFAULT_LAYOUT.map(x => x.id);
  const cleaned = saved.filter(x => x && knownIds.includes(x.id) && ['sm','md','lg'].includes(x.size));
  for (const def of DEFAULT_LAYOUT) {
    if (!cleaned.some(c => c.id === def.id)) cleaned.push(def);
  }
  return cleaned;
}

/* ============================================================
   APP
   ============================================================ */
function App() {
  const [theme, setTheme] = useState(() => loadLS('wt_theme', 'pink'));
  const [pomodoroState, pomodoroDispatch] = React.useReducer(pomodoroReducer, null, getInitialPomodoro);
  const [swState, swDispatch] = React.useReducer(stopwatchReducer, null, getInitialStopwatch);
  const [todos, todoDispatch] = React.useReducer(todoReducer, null, getInitialTodos);
  const [targetMinutes, setTargetMinutes] = useState(() => loadLS('wt_target', 60));
  const [notionSettings, setNotionSettings] = useState(() => {
    const legacy = loadLS('wt_notion_settings', DEFAULT_NOTION_SETTINGS);
    // Strip legacy proxyUrl if present
    return { apiKey: legacy.apiKey || '', databaseId: legacy.databaseId || '' };
  });
  const [profile, setProfile] = useState(() => loadLS('wt_profile', DEFAULT_PROFILE));
  const [memoPosts, setMemoPosts] = useState(() => loadLS('wt_memo_posts', []));
  const [notionModalOpen, setNotionModalOpen] = useState(false);
  const [pomodoroModalOpen, setPomodoroModalOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => loadLS('wt_pomodoro_notify', true));
  const [layout, setLayout] = useState(loadLayout);
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const todayKey = getTodayKey();

  useEffect(() => { document.body.className = theme === 'blue' ? 'theme-blue' : ''; saveLS('wt_theme', theme); }, [theme]);
  useEffect(() => { saveLS('wt_target', targetMinutes); }, [targetMinutes]);
  useEffect(() => { saveLS('wt_notion_settings', notionSettings); }, [notionSettings]);
  useEffect(() => { saveLS('wt_pomodoro_sessions', pomodoroState.sessions); }, [pomodoroState.sessions]);
  useEffect(() => {
    saveLS('wt_pomodoro_settings', { workDuration: pomodoroState.workDuration, breakDuration: pomodoroState.breakDuration });
  }, [pomodoroState.workDuration, pomodoroState.breakDuration]);
  useEffect(() => { saveLS('wt_stopwatch_sessions', swState.savedSessions); }, [swState.savedSessions]);
  useEffect(() => { saveLS('wt_todos', todos); }, [todos]);
  useEffect(() => { saveLS('wt_profile', profile); }, [profile]);
  useEffect(() => { saveLS('wt_memo_posts', memoPosts); }, [memoPosts]);
  useEffect(() => { saveLS('wt_layout_v2', layout); }, [layout]);
  useEffect(() => { saveLS('wt_pomodoro_notify', notificationsEnabled); }, [notificationsEnabled]);

  useEffect(() => {
    const lastReset = loadLS('wt_todos_reset_date', null);
    if (lastReset !== todayKey) {
      todoDispatch({ type: 'TODO_RESET_REPEATING' });
      saveLS('wt_todos_reset_date', todayKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleTheme() { setTheme(t => t === 'pink' ? 'blue' : 'pink'); }
  function handleAddMemoPost(text) {
    setMemoPosts(prev => [{ id: Date.now() + Math.random().toString(36).slice(2), text, date: Date.now() }, ...prev]);
  }
  function handleDeleteMemoPost(id) { setMemoPosts(prev => prev.filter(p => p.id !== id)); }

  const pomodoroTotalSec = pomodoroState.sessions.reduce((s, x) => s + x.duration, 0);
  const swTotalSec = swState.savedSessions.reduce((s, x) => s + Math.floor(x.duration / 1000), 0);
  const totalMinutes = Math.round((pomodoroTotalSec + swTotalSec) / 60);

  // ---- drag & drop / resize handlers ----
  function handleResize(id, size) {
    setLayout(prev => prev.map(it => it.id === id ? { ...it, size } : it));
  }
  function handleDragStart(id) { setDragId(id); }
  function handleDragOver(id) { if (dragId && id !== dragId) setDropTargetId(id); }
  function handleDrop(targetId) {
    if (!dragId || dragId === targetId) { setDragId(null); setDropTargetId(null); return; }
    setLayout(prev => {
      const list = prev.slice();
      const fromIdx = list.findIndex(x => x.id === dragId);
      const toIdx = list.findIndex(x => x.id === targetId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = list.splice(fromIdx, 1);
      list.splice(toIdx, 0, moved);
      return list;
    });
    setDragId(null); setDropTargetId(null);
  }
  function handleDragEnd() { setDragId(null); setDropTargetId(null); }

  const CARDS = {
    pomodoro: {
      title: '🍅 Pomodoro',
      render: () => <Pomodoro state={pomodoroState} dispatch={pomodoroDispatch} onOpenSettings={() => setPomodoroModalOpen(true)} notificationsEnabled={notificationsEnabled} />,
    },
    stopwatch: {
      title: '⏱ Stopwatch',
      render: () => <Stopwatch state={swState} dispatch={swDispatch} />,
    },
    todo: {
      title: '✅ To-Do',
      render: () => <TodoList todos={todos} dispatch={todoDispatch} />,
    },
    calculator: {
      title: '📊 Time Calculator',
      render: () => <TimeCalculator pomodoroSessions={pomodoroState.sessions} swSessions={swState.savedSessions} targetMinutes={targetMinutes} onSetTarget={setTargetMinutes} />,
    },
    notion: {
      title: '📤 Notion Sync',
      render: () => <NotionSync settings={notionSettings} totalMinutes={totalMinutes} onOpenSettings={() => setNotionModalOpen(true)} />,
    },
    memo: {
      title: '💬 Memo Feed',
      render: () => <MemoFeed profile={profile} posts={memoPosts} onAdd={handleAddMemoPost} onDelete={handleDeleteMemoPost} />,
    },
  };

  return (
    <div className="app-window">
      <MacMenubar
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenNotion={() => setNotionModalOpen(true)}
        onOpenPomodoroSettings={() => setPomodoroModalOpen(true)}
      />

      <ProfileBar profile={profile} onChange={setProfile} theme={theme} onToggleTheme={toggleTheme} />

      <div className="main-grid" onDragEnd={handleDragEnd}>
        {layout.map(item => {
          const def = CARDS[item.id];
          if (!def) return null;
          return (
            <MacWindow
              key={item.id}
              id={item.id}
              title={def.title}
              size={item.size}
              onResize={handleResize}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
              draggingId={dragId}
              dropTargetId={dropTargetId}
            >
              {def.render()}
            </MacWindow>
          );
        })}
      </div>

      {notionModalOpen && (
        <NotionSettingsModal settings={notionSettings} onSave={setNotionSettings} onClose={() => setNotionModalOpen(false)} />
      )}
      {pomodoroModalOpen && (
        <PomodoroSettingsModal
          work={pomodoroState.workDuration}
          brk={pomodoroState.breakDuration}
          notificationsEnabled={notificationsEnabled}
          onSave={({ work, brk, notificationsEnabled: nextNotif }) => {
            pomodoroDispatch({ type: 'POMODORO_SET_DURATIONS', work, brk });
            setNotificationsEnabled(nextNotif);
          }}
          onClose={() => setPomodoroModalOpen(false)}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
