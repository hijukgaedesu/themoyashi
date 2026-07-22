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
function uid() { return Date.now() + Math.random().toString(36).slice(2); }
function normalizeUrl(u) {
  const t = (u || '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  return 'https://' + t;
}
function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDaysToKey(key, n) {
  const d = parseDateKey(key);
  d.setDate(d.getDate() + n);
  return getDateKey(d);
}
function daysBetweenKeys(aKey, bKey) {
  return Math.round((parseDateKey(bKey) - parseDateKey(aKey)) / 86400000);
}
function getMonthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const startOffset = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(getDateKey(new Date(year, month, d)));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}
function assignEventRows(events) {
  const sorted = [...events].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const rowEnds = [];
  const withRows = [];
  for (const ev of sorted) {
    let row = 0;
    while (row < rowEnds.length && rowEnds[row] >= ev.start) row++;
    rowEnds[row] = ev.end;
    withRows.push({ ...ev, row });
  }
  return withRows;
}

/* ============================================================
   NOTIFICATIONS
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
const NOTION_BASE = '/api/notion-api';
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
   MAC WINDOW WRAPPER
   ============================================================ */
function MacWindow({ id, title, w, h, onResize, onDragStart, onDragOver, onDrop, onDragEnd, draggingId, dropTargetId, children, draggable = true }) {
  const isDragging = draggingId === id;
  const isTarget = dropTargetId === id && draggingId !== id;
  const itemRef = useRef(null);
  const [resizing, setResizing] = useState(false);

  function handleResizeStart(e) {
    e.preventDefault();
    e.stopPropagation();
    const el = itemRef.current;
    if (!el) return;
    setResizing(true);
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = rect.width;
    const startH = rect.height;

    function onMove(ev) {
      const nw = Math.max(220, Math.round(startW + (ev.clientX - startX)));
      const nh = Math.max(180, Math.round(startH + (ev.clientY - startY)));
      onResize(id, { w: nw, h: nh });
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setResizing(false);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  const style = {};
  if (w) style.width = w + 'px';
  if (h) style.height = h + 'px';

  return (
    <div
      ref={itemRef}
      className={`grid-item${isDragging ? ' dragging' : ''}${isTarget ? ' drop-target' : ''}`}
      style={style}
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
        >
          <div className="mac-lights">
            <span className="mac-light close" />
            <span className="mac-light min" />
            <span className="mac-light max" />
          </div>
          <div className="mac-title-box">{title}</div>
        </div>
        <div className="mac-body">{children}</div>
        <div
          className={`mac-resize-handle${resizing ? ' active' : ''}`}
          onPointerDown={handleResizeStart}
          title="드래그로 크기 조절"
          aria-label="크기 조절"
        />
      </div>
    </div>
  );
}

/* ============================================================
   MENUBAR
   ============================================================ */
function MacMenubar({ theme, onToggleTheme, onOpenNotion, onOpenPomodoroSettings, onOpenDiary }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  return (
    <div className="mac-menubar">
      <span className="mac-menubar-apple"></span>
      <span className="mac-menubar-item"><b>File</b></span>
      <span
        className="mac-menubar-item"
        onClick={onToggleTheme}
        style={{ cursor: 'pointer' }}
        title="테마 바꾸기"
      >
        <span className="menubar-star">⭐</span>
      </span>
      <span className="mac-menubar-item" onClick={onOpenPomodoroSettings} style={{ cursor: 'pointer' }}>⚙ Pomodoro</span>
      <span className="mac-menubar-item" onClick={onOpenNotion} style={{ cursor: 'pointer' }}>Notion</span>
      <span className="mac-menubar-item" onClick={onOpenDiary} style={{ cursor: 'pointer' }}>✏️ Diary</span>
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
        <button className="btn-icon" onClick={onOpenSettings} title="집중 시간 설정" aria-label="집중 시간 설정">⚙</button>
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
          {recentSessions.map((s) => (
            <div className="session-item" key={s.id || s.date}>
              <span className="session-item-type">🍅</span>
              <span className="session-item-date">{formatSessionDate(s.date)}</span>
              <span className="session-item-duration">{formatTimeFull(s.duration)}</span>
              <button
                className="session-delete-btn"
                onClick={() => dispatch({ type: 'POMODORO_DELETE_SESSION', id: s.id, date: s.date })}
                title="세션 기록 삭제"
                aria-label="세션 기록 삭제"
              >🗑</button>
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
              <span className="form-label">🍅 집중 (분)</span>
              <input type="number" min="1" max="180" className="form-input duration-input" value={w} onChange={e => setW(e.target.value)} />
            </div>
            <div className="form-group">
              <span className="form-label">☕ 휴식 (분)</span>
              <input type="number" min="1" max="60" className="form-input duration-input" value={b} onChange={e => setB(e.target.value)} />
            </div>
          </div>
          <div className="form-hint" style={{ marginTop: 6 }}>
            변경 사항은 다음 세션부터 적용됩니다.
          </div>
          <div className="settings-toggle-row">
            <div>
              <div className="settings-toggle-label">🔔 세션 완료 알림</div>
              <div className="settings-toggle-hint">
                {permission === 'denied' ? '브라우저에서 알림이 차단되어 있어요. 소리만 재생됩니다.'
                  : permission === 'unsupported' ? '이 브라우저는 알림을 지원하지 않아요. 소리만 재생됩니다.'
                  : '작업/휴식이 끝나면 알림과 소리로 알려드려요.'}
              </div>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={notif} onChange={e => handleToggleNotif(e.target.checked)} style={{ width: 18, height: 18, cursor: 'pointer' }} />
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => { playCompletionSound('work'); if (notif) fireNotification('🍅 알림 테스트', '이렇게 알림이 표시돼요.'); }}>테스트</button>
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
        <button className="btn-primary large" onClick={() => dispatch({ type: 'SW_TOGGLE' })}>{isRunning ? '정지' : '시작'}</button>
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

      {state.savedSessions && state.savedSessions.length > 0 && (
        <div className="session-list" style={{ width: '100%' }}>
          <div className="session-list-title">저장된 세션</div>
          {[...state.savedSessions].slice(-5).reverse().map(s => (
            <div className="session-item" key={s.id || s.date}>
              <span className="session-item-type">⏱</span>
              <span className="session-item-date">{formatSessionDate(s.date)}</span>
              <span className="session-item-duration">{formatTimeFull(Math.floor(s.duration / 1000))}</span>
              <button
                className="session-delete-btn"
                onClick={() => dispatch({ type: 'SW_DELETE_SESSION', id: s.id, date: s.date })}
                title="세션 기록 삭제"
                aria-label="세션 기록 삭제"
              >🗑</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   TIME CALCULATOR
   ============================================================ */
function TimeCalculator({ pomodoroSessions, swSessions, targetMinutes, onSetTarget, onDeletePomodoro, onDeleteStopwatch }) {
  const PRESETS = [30, 60, 120, 240];
  const pomodoroTotalSec = pomodoroSessions.reduce((s, x) => s + x.duration, 0);
  const swTotalSec = swSessions.reduce((s, x) => s + Math.floor(x.duration / 1000), 0);
  const totalSeconds = pomodoroTotalSec + swTotalSec;
  const targetSeconds = (targetMinutes || 0) * 60;
  const percentage = targetSeconds > 0 ? Math.min((totalSeconds / targetSeconds) * 100, 100) : 0;
  const remaining = Math.max(targetSeconds - totalSeconds, 0);

  const allSessions = [
    ...pomodoroSessions.map(s => ({ type: 'pomodoro', id: s.id, date: s.date, duration: s.duration * 1000 })),
    ...swSessions.map(s => ({ type: 'stopwatch', id: s.id, date: s.date, duration: s.duration })),
  ].sort((a, b) => b.date - a.date).slice(0, 8);

  return (
    <div className="calculator-container">
      <div>
        <div className="target-section">
          <div className="target-input-row">
            <span className="target-input-label">목표 시간</span>
            <input type="number" min="0" className="target-input" value={targetMinutes || ''}
              onChange={e => { const v = parseInt(e.target.value, 10); onSetTarget(isNaN(v) || v < 0 ? 0 : v); }}
              placeholder="분" />
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
          allSessions.map((s) => {
            const durSec = s.type === 'pomodoro' ? s.duration / 1000 : Math.floor(s.duration / 1000);
            return (
              <div className="session-item" key={s.type + '-' + (s.id || s.date)}>
                <span className="session-item-type">{s.type === 'pomodoro' ? '🍅' : '⏱'}</span>
                <span className="session-item-date">{formatSessionDate(s.date)}</span>
                <span className="session-item-duration">{formatTimeFull(durSec)}</span>
                <button
                  className="session-delete-btn"
                  onClick={() => s.type === 'pomodoro' ? onDeletePomodoro(s.id, s.date) : onDeleteStopwatch(s.id, s.date)}
                  title="세션 기록 삭제"
                  aria-label="세션 기록 삭제"
                >🗑</button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ============================================================
   PROFILE BAR
   ============================================================ */
function nearestDeadline(events) {
  const todayKey = getTodayKey();
  const deadlines = (events || []).filter(e => e.isDeadline && e.end >= todayKey);
  if (!deadlines.length) return null;
  deadlines.sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));
  const nearest = deadlines[0];
  return { title: nearest.title, diff: daysBetweenKeys(todayKey, nearest.end) };
}

function ProfileBar({ profile, onChange, calendarEvents }) {
  const avatarInputRef = useRef(null);

  function pickImage(inputRef) {
    return inputRef.current && inputRef.current.click();
  }
  function handleFile(kind, file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 3 * 1024 * 1024) { alert('3MB 이하 이미지를 사용해주세요.'); return; }
    const reader = new FileReader();
    reader.onload = () => onChange({ ...profile, [kind]: reader.result });
    reader.readAsDataURL(file);
  }

  const urls = (profile.urls && profile.urls.length) ? profile.urls : (profile.url ? [profile.url] : ['']);
  const [editingUrlIdx, setEditingUrlIdx] = useState(null);
  function updateUrlAt(i, val) {
    const next = urls.slice();
    next[i] = val;
    onChange({ ...profile, urls: next });
  }
  function removeUrlAt(i) {
    const next = urls.filter((_, idx) => idx !== i);
    onChange({ ...profile, urls: next });
  }
  function addUrl() {
    if (urls.length >= 3) return;
    onChange({ ...profile, urls: [...urls, ''] });
    setEditingUrlIdx(urls.length);
  }

  const dday = nearestDeadline(calendarEvents);

  return (
    <div className="mac-win profile-window">
      <div className="mac-titlebar no-drag">
        <div className="mac-lights">
          <span className="mac-light close" />
          <span className="mac-light min" />
          <span className="mac-light max" />
        </div>
        <div className="mac-title-box">⭐ Profile</div>
      </div>
      <div className="mac-body profile-card">
        <input type="file" accept="image/*" ref={avatarInputRef} style={{ display: 'none' }}
          onChange={e => handleFile('avatar', e.target.files && e.target.files[0])} />

        <div className="profile-body">
          <button className="profile-avatar-btn" onClick={() => pickImage(avatarInputRef)} title="프로필 사진 변경">
            {profile.avatar
              ? <img className="profile-avatar-img" src={profile.avatar} alt="" />
              : <span className="profile-avatar-placeholder">📷</span>}
          </button>

          <div className="profile-fields">
            <div className="profile-nickname-row">
              <input type="text" className="profile-nickname-input" value={profile.nickname}
                onChange={e => onChange({ ...profile, nickname: e.target.value })}
                placeholder="닉네임을 입력하세요" />
              {dday && (
                <span className="profile-dday" title={dday.title}>
                  {dday.diff === 0 ? 'D-DAY' : `D-${dday.diff}`} · {dday.title}
                </span>
              )}
            </div>
            <input type="text" className="profile-status-input" value={profile.status || ''}
              onChange={e => onChange({ ...profile, status: e.target.value })}
              placeholder="상태 메시지를 입력하세요" maxLength={60} />
            {urls.map((u, i) => {
              const hasUrl = (u || '').trim().length > 0;
              const displayUrl = (u || '').replace(/^https?:\/\//, '');
              const hrefUrl = normalizeUrl(u);
              const isEditing = editingUrlIdx === i || !hasUrl;
              return (
                <div className="profile-url-row" key={i}>
                  <span className="profile-url-icon">🔗</span>
                  {isEditing ? (
                    <input type="text" className="profile-url-input" value={u}
                      autoFocus={editingUrlIdx === i}
                      onChange={e => updateUrlAt(i, e.target.value)}
                      onBlur={() => setEditingUrlIdx(null)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.target.blur(); } }}
                      placeholder={`URL ${i + 1} (예: example.com)`} />
                  ) : (
                    <a className="profile-url-input profile-url-as-link" href={hrefUrl} target="_blank" rel="noreferrer" title={hrefUrl}>
                      {displayUrl}
                    </a>
                  )}
                  {!isEditing && (
                    <button type="button" className="profile-url-remove" onClick={() => setEditingUrlIdx(i)} title="수정">✏️</button>
                  )}
                  <button type="button" className="profile-url-remove" onClick={() => removeUrlAt(i)} title="삭제">✕</button>
                </div>
              );
            })}
            {urls.length < 3 && (
              <button type="button" className="profile-url-add" onClick={addUrl}>+ URL 추가</button>
            )}
          </div>
        </div>
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
   MEMO FEED (with edit)
   ============================================================ */
function MemoFeed({ profile, posts, onAdd, onDelete, onEdit }) {
  const [text, setText] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');

  function startEdit(p) { setEditingId(p.id); setEditText(p.text); }
  function saveEdit() {
    const t = editText.trim();
    if (!t) return;
    onEdit(editingId, t);
    setEditingId(null); setEditText('');
  }

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
                <span className="memo-post-time">{formatSessionDate(p.date)}{p.editedAt ? ' (수정됨)' : ''}</span>
                {editingId === p.id ? null : (
                  <>
                    <button className="memo-post-delete" onClick={() => startEdit(p)} title="수정">✏️</button>
                    <button className="memo-post-delete" onClick={() => onDelete(p.id)} title="삭제">🗑</button>
                  </>
                )}
              </div>
              {editingId === p.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                  <textarea className="memo-compose-textarea" value={editText} onChange={e => setEditText(e.target.value)} rows={3} />
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button className="btn-secondary" onClick={() => { setEditingId(null); setEditText(''); }}>취소</button>
                    <button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>저장</button>
                  </div>
                </div>
              ) : (
                <div className="memo-post-text">{p.text}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   BOOKMARKS
   ============================================================ */
function Bookmarks({ bookmarks, onAdd, onDelete, onEdit, onReorder }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [dragId, setDragId] = useState(null);
  const [overId, setOverId] = useState(null);

  function handleAdd(e) {
    e.preventDefault();
    const u = normalizeUrl(url);
    const n = name.trim();
    if (!u) return;
    onAdd({ name: n || u, url: u });
    setName(''); setUrl('');
  }
  function startEdit(b) { setEditingId(b.id); setEditName(b.name); setEditUrl(b.url); }
  function saveEdit() {
    const u = normalizeUrl(editUrl);
    if (!u) return;
    onEdit(editingId, { name: (editName.trim() || u), url: u });
    setEditingId(null);
  }
  function handleDragStart(id) { setDragId(id); }
  function handleDragOver(id, e) { e.preventDefault(); if (id !== dragId) setOverId(id); }
  function handleDrop(id) {
    if (dragId && dragId !== id) {
      const list = bookmarks.slice();
      const fromIdx = list.findIndex(b => b.id === dragId);
      const toIdx = list.findIndex(b => b.id === id);
      if (fromIdx >= 0 && toIdx >= 0) {
        const [moved] = list.splice(fromIdx, 1);
        list.splice(toIdx, 0, moved);
        onReorder(list);
      }
    }
    setDragId(null); setOverId(null);
  }
  function handleDragEnd() { setDragId(null); setOverId(null); }

  return (
    <div className="bookmarks-container">
      <form className="bookmark-add-row" onSubmit={handleAdd}>
        <input type="text" className="form-input" value={name} onChange={e => setName(e.target.value)} placeholder="이름 (예: 노션)" />
        <input type="url" className="form-input" value={url} onChange={e => setUrl(e.target.value)} placeholder="URL (예: notion.so)" />
        <button type="submit" className="btn-primary" disabled={!url.trim()}>추가</button>
      </form>
      {bookmarks.length === 0 && <div className="empty-state">저장된 북마크가 없습니다.</div>}
      {bookmarks.map(b => (
        <div
          className={`bookmark-item${dragId === b.id ? ' dragging' : ''}${overId === b.id && dragId !== b.id ? ' drag-over' : ''}`}
          key={b.id}
          draggable={editingId !== b.id}
          onDragStart={() => handleDragStart(b.id)}
          onDragOver={e => handleDragOver(b.id, e)}
          onDrop={() => handleDrop(b.id)}
          onDragEnd={handleDragEnd}
        >
          {editingId === b.id ? (
            <div className="bookmark-edit">
              <input type="text" className="form-input" value={editName} onChange={e => setEditName(e.target.value)} placeholder="이름" />
              <input type="url" className="form-input" value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="URL" />
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn-secondary" onClick={() => setEditingId(null)}>취소</button>
                <button className="btn-primary" onClick={saveEdit}>저장</button>
              </div>
            </div>
          ) : (
            <>
              <span className="bookmark-drag-handle" title="드래그해서 순서 변경">⠿</span>
              <a className="bookmark-link" href={b.url} target="_blank" rel="noopener noreferrer" title={b.url}>
                <span className="bookmark-fav">🔖</span>
                <span className="bookmark-name">{b.name}</span>
                <span className="bookmark-url">{b.url}</span>
              </a>
              <button className="todo-delete-btn" onClick={() => startEdit(b)} title="수정">✏️</button>
              <button className="todo-delete-btn" onClick={() => onDelete(b.id)} title="삭제">🗑</button>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   PROJECT PANEL (deadlines / progress)
   ============================================================ */
const STAGE_PRESETS = [
  { name: '원고 작성', stages: '아이디어,초고,퇴고,업로드' },
  { name: '그림 작업', stages: '스케치,선화,채색,배경,후보정' },
];

function periodPercent(createdAt, deadline, todayKey) {
  const total = daysBetweenKeys(createdAt, deadline);
  if (total <= 0) return todayKey >= deadline ? 100 : 0;
  const elapsed = daysBetweenKeys(createdAt, todayKey);
  return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
}

function ProjectEditorModal({ initial, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(initial.title || '');
  const [category, setCategory] = useState(initial.category || '');
  const [deadline, setDeadline] = useState(initial.deadline || getTodayKey());
  const [stagesText, setStagesText] = useState((initial.stages || []).join(','));

  function handleSave() {
    const t = title.trim();
    if (!t) return;
    const stages = stagesText.split(',').map(s => s.trim()).filter(Boolean);
    onSave({ ...initial, title: t, category: category.trim(), deadline, stages });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-titlebar">
          <button className="mac-title-close" onClick={onClose} aria-label="닫기" />
          <div className="modal-title-text">📈 프로젝트 {initial.id ? '수정' : '추가'}</div>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <span className="form-label">작품 제목</span>
            <input type="text" className="form-input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 프로젝트" autoFocus />
          </div>
          <div className="form-group">
            <span className="form-label">카테고리</span>
            <input type="text" className="form-input" value={category} onChange={e => setCategory(e.target.value)}
              placeholder="예: 연재" />
          </div>
          <div className="form-group">
            <span className="form-label">마감일</span>
            <input type="date" className="form-input" value={deadline} onChange={e => setDeadline(e.target.value)} />
          </div>
          <div className="form-group">
            <span className="form-label">단계 프리셋</span>
            <div className="progress-preset-row">
              {STAGE_PRESETS.map(p => (
                <button key={p.name} type="button" className="btn-secondary" onClick={() => setStagesText(p.stages)}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <span className="form-label">단계 직접 입력 (쉼표로 구분)</span>
            <input type="text" className="form-input" value={stagesText} onChange={e => setStagesText(e.target.value)}
              placeholder="예: 아이디어,초고,퇴고,업로드" />
          </div>
          <div className="modal-actions">
            {initial.id && (
              <button className="btn-secondary" onClick={() => onDelete(initial.id)} style={{ marginRight: 'auto' }}>삭제</button>
            )}
            <button className="btn-secondary" onClick={onClose}>취소</button>
            <button className="btn-primary" onClick={handleSave} disabled={!title.trim()}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function toggledArr(arr, i) {
  const next = arr ? arr.slice() : [];
  next[i] = !next[i];
  return next;
}

function ProjectCard({ project, onToggleStage, onQuickComplete, onEdit, onDelete }) {
  const todayKey = getTodayKey();
  const diff = daysBetweenKeys(todayKey, project.deadline);
  const ddayLabel = diff === 0 ? 'D-DAY' : diff > 0 ? `D-${diff}` : `D+${-diff}`;
  const pct = periodPercent(project.createdAt || todayKey, project.deadline, todayKey);
  const daysLeftLabel = diff > 0 ? `${diff}일 남음` : diff === 0 ? '오늘 마감' : `${-diff}일 지남`;
  const stages = project.stages || [];
  const checked = project.checked || [];
  const doneCount = checked.filter(Boolean).length;
  const stagePct = stages.length ? Math.round((doneCount / stages.length) * 100) : 0;

  return (
    <div className="project-card">
      <div className="project-card-toprow">
        <span className="project-deadline-text">마감 {project.deadline}</span>
        {project.category && <span className="project-category-badge">{project.category}</span>}
        <span className="project-card-spacer" />
        <span className="project-dday-badge">{ddayLabel}</span>
        <button className="project-icon-btn" onClick={onQuickComplete} title="빠른 마감 (즉시 완료 후 삭제)">⚡</button>
        <button className="project-icon-btn" onClick={onEdit} title="수정">✏️</button>
        <button className="project-icon-btn" onClick={onDelete} title="삭제">🗑</button>
      </div>
      <div className="project-card-title">{project.title}</div>
      <div className="project-card-period">기간 {pct}% 경과 · {daysLeftLabel}</div>
      <div className="project-card-bar-track">
        <div className="project-card-bar-fill" style={{ width: `${stagePct}%` }} />
      </div>
      {stages.length > 0 && (
        <div className="project-card-stages">
          {stages.map((s, i) => (
            <label className="project-stage-check" key={i}>
              <input type="checkbox" checked={!!checked[i]} onChange={() => onToggleStage(i)} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectPanel({ projects, onAdd, onEdit, onDelete, onQuickComplete }) {
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('전체');

  const categories = Array.from(new Set(projects.map(p => p.category).filter(Boolean)));
  const tabs = ['전체', ...categories];

  const visible = projects
    .filter(p => filter === '전체' || p.category === filter)
    .slice()
    .sort((a, b) => (a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0));

  function handleSave(data) {
    if (data.id) onEdit(data); else onAdd(data);
    setEditing(null);
  }
  function handleDelete(id) {
    onDelete(id);
    setEditing(null);
  }

  return (
    <div className="project-panel">
      <div className="project-panel-header">
        <div>
          <div className="project-panel-title">진행 중인 마감</div>
          <div className="project-panel-subtitle">마감 임박순</div>
        </div>
        <button className="btn-icon" onClick={() => setEditing({})} title="새 프로젝트 추가" aria-label="새 프로젝트 추가">⚙</button>
      </div>
      <div className="project-filter-row">
        {tabs.map(t => (
          <button key={t} className={`project-filter-tab${filter === t ? ' active' : ''}`} onClick={() => setFilter(t)}>{t}</button>
        ))}
      </div>
      {visible.length === 0 ? (
        <div className="empty-state">아직 등록된 프로젝트가 없어요. ＋ 버튼으로 추가해보세요.</div>
      ) : (
        <div className="project-list">
          {visible.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onToggleStage={i => onEdit({ ...p, checked: toggledArr(p.checked, i) })}
              onQuickComplete={() => onQuickComplete(p.id)}
              onEdit={() => setEditing(p)}
              onDelete={() => onDelete(p.id)}
            />
          ))}
        </div>
      )}
      {editing && (
        <ProjectEditorModal initial={editing} onSave={handleSave} onDelete={handleDelete} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/* ============================================================
   DIARY MODAL (twitter-style, in modal)
   ============================================================ */
function DiaryModal({ profile, entries, onAdd, onDelete, onEdit, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box modal-box-wide" onClick={e => e.stopPropagation()}>
        <div className="modal-titlebar">
          <div className="mac-lights">
            <button className="mac-light close" onClick={onClose} aria-label="닫기" />
            <span className="mac-light min" />
            <span className="mac-light max" />
          </div>
          <div className="modal-title-text">✏️ Diary</div>
        </div>
        <div className="modal-body" style={{ maxHeight: '75vh' }}>
          <MemoFeed profile={profile} posts={entries} onAdd={onAdd} onDelete={onDelete} onEdit={onEdit} />
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   CALENDAR
   ============================================================ */
const CALENDAR_COLORS = [
  { key: 'pink',      bg: '#FFD9E8', text: '#8a4a63' },
  { key: 'blue',      bg: '#D6E8FF', text: '#38577e' },
  { key: 'mint',      bg: '#D3F5E3', text: '#317a52' },
  { key: 'lavender',  bg: '#E6DCFB', text: '#5f4a8a' },
  { key: 'peach',     bg: '#FFE3D1', text: '#8a5a34' },
  { key: 'lemon',     bg: '#FBF3C4', text: '#7a6a1e' },
  { key: 'sky',       bg: '#CFF3F7', text: '#2a6d75' },
  { key: 'rose',      bg: '#FBDCE4', text: '#8a3a52' },
  { key: 'sage',      bg: '#DFEAD1', text: '#4c6b34' },
  { key: 'lilac',     bg: '#EAD9F0', text: '#6d4a80' },
];

function CalendarEventPopover({ initial, onSave, onDelete, onClose }) {
  const [title, setTitle] = useState(initial.title || '');
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [color, setColor] = useState(initial.color != null ? initial.color : 0);
  const [importance, setImportance] = useState(initial.importance || 1);
  const [isDeadline, setIsDeadline] = useState(!!initial.isDeadline);
  const [isProject, setIsProject] = useState(!!initial.isProject);

  function handleSave() {
    const t = title.trim();
    if (!t) return;
    const s = start <= end ? start : end;
    const e = start <= end ? end : start;
    onSave({ ...initial, title: t, start: s, end: e, color, importance, isDeadline, isProject });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-titlebar">
          <button className="mac-title-close" onClick={onClose} aria-label="닫기" />
          <div className="modal-title-text">📅 일정</div>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <span className="form-label">일정 이름</span>
            <input type="text" className="form-input" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="예: 중단, 투약, 마감 등" autoFocus />
          </div>
          <div className="form-group">
            <span className="form-label">기간</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="date" className="form-input" value={start} onChange={e => setStart(e.target.value)} />
              <span>~</span>
              <input type="date" className="form-input" value={end} onChange={e => setEnd(e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <span className="form-label">색상</span>
            <div className="calendar-color-row">
              {CALENDAR_COLORS.map((c, i) => (
                <button key={c.key} type="button"
                  className={`calendar-color-swatch${color === i ? ' active' : ''}`}
                  style={{ background: c.bg }}
                  onClick={() => setColor(i)}
                  aria-label={c.key}
                />
              ))}
            </div>
          </div>
          <div className="form-group">
            <span className="form-label">중요도</span>
            <div className="calendar-star-row">
              {[1, 2, 3].map(n => (
                <button key={n} type="button" className="calendar-star-btn" onClick={() => setImportance(n)}>
                  {n <= importance ? '⭐' : '☆'}
                </button>
              ))}
            </div>
          </div>
          <label className="calendar-deadline-check">
            <input type="checkbox" checked={isDeadline} onChange={e => setIsDeadline(e.target.checked)} />
            마감일로 표시 (프로필에 D-day로 표시)
          </label>
          <label className="calendar-deadline-check">
            <input type="checkbox" checked={isProject} onChange={e => setIsProject(e.target.checked)} />
            프로젝트로 등록 (진행도 카드 생성)
          </label>
          <div className="modal-actions">
            {initial.id && (
              <button className="btn-secondary" onClick={() => onDelete(initial.id)} style={{ marginRight: 'auto' }}>삭제</button>
            )}
            <button className="btn-secondary" onClick={onClose}>취소</button>
            <button className="btn-primary" onClick={handleSave} disabled={!title.trim()}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Calendar({ events, onAdd, onEdit, onDelete, onSyncProject }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selecting, setSelecting] = useState(null);
  const [popover, setPopover] = useState(null);
  const draggingIdRef = useRef(null);
  const resizeRef = useRef(null);

  useEffect(() => {
    function onUp() {
      setSelecting(cur => {
        if (cur) {
          const s = cur.start <= cur.end ? cur.start : cur.end;
          const e = cur.start <= cur.end ? cur.end : cur.start;
          setPopover({ title: '', start: s, end: e, color: 0, importance: 1, isDeadline: false, isProject: false });
        }
        return null;
      });
    }
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  const cells = getMonthMatrix(viewYear, viewMonth);
  const gridDates = cells.filter(Boolean);
  const gridStart = gridDates[0];
  const gridEnd = gridDates[gridDates.length - 1];
  const visibleEvents = events.filter(e => e.end >= gridStart && e.start <= gridEnd);
  const eventsWithRows = assignEventRows(visibleEvents);
  const maxRow = eventsWithRows.reduce((m, e) => Math.max(m, e.row), -1);
  const rowsByDay = {};
  for (const ev of eventsWithRows) {
    let d = ev.start;
    let guard = 0;
    while (d <= ev.end && guard < 370) {
      if (rowsByDay[d]) rowsByDay[d].push(ev); else rowsByDay[d] = [ev];
      d = addDaysToKey(d, 1);
      guard++;
    }
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); } else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); } else setViewMonth(m => m + 1);
  }
  function isInSelecting(dateKey) {
    if (!selecting || !dateKey) return false;
    const s = selecting.start <= selecting.end ? selecting.start : selecting.end;
    const e = selecting.start <= selecting.end ? selecting.end : selecting.start;
    return dateKey >= s && dateKey <= e;
  }
  function handleCellDrop(dateKey, e) {
    e.preventDefault();
    if (!dateKey) { draggingIdRef.current = null; resizeRef.current = null; return; }

    if (resizeRef.current) {
      const { id, edge } = resizeRef.current;
      resizeRef.current = null;
      const ev = events.find(x => x.id === id);
      if (!ev) return;
      if (edge === 'start') {
        const newStart = dateKey <= ev.end ? dateKey : ev.end;
        const newEnd = dateKey <= ev.end ? ev.end : dateKey;
        onEdit({ ...ev, start: newStart, end: newEnd });
      } else {
        const newEnd = dateKey >= ev.start ? dateKey : ev.start;
        const newStart = dateKey >= ev.start ? ev.start : dateKey;
        onEdit({ ...ev, start: newStart, end: newEnd });
      }
      return;
    }

    const id = draggingIdRef.current;
    draggingIdRef.current = null;
    if (!id) return;
    const ev = events.find(x => x.id === id);
    if (!ev) return;
    const durationDays = daysBetweenKeys(ev.start, ev.end);
    const newStart = dateKey;
    const newEnd = addDaysToKey(newStart, durationDays);
    onEdit({ ...ev, start: newStart, end: newEnd });
  }
  function handleSavePopover(data) {
    const finalEvent = data.id ? data : { ...data, id: uid() };
    if (data.id) onEdit(finalEvent); else onAdd(finalEvent);
    if (finalEvent.isProject) onSyncProject(finalEvent);
    setPopover(null);
  }
  function handleDeletePopover(id) {
    onDelete(id);
    setPopover(null);
  }

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  const todayKey = getTodayKey();

  return (
    <div className="calendar-container">
      <div className="calendar-nav">
        <button className="btn-icon" onClick={prevMonth} aria-label="이전 달">‹</button>
        <div className="calendar-month-label">{viewYear}년 {viewMonth + 1}월</div>
        <button className="btn-icon" onClick={nextMonth} aria-label="다음 달">›</button>
      </div>
      <div className="calendar-dow-row">
        {['일', '월', '화', '수', '목', '금', '토'].map(d => <div className="calendar-dow" key={d}>{d}</div>)}
      </div>
      <div className="calendar-grid">
        {weeks.map((week, wi) => (
          <div className="calendar-week" key={wi}>
            {week.map((dateKey, di) => {
              const isToday = dateKey === todayKey;
              const dayEvents = rowsByDay[dateKey] || [];
              return (
                <div
                  key={di}
                  className={`calendar-cell${!dateKey ? ' empty' : ''}${isInSelecting(dateKey) ? ' selecting' : ''}`}
                  onMouseDown={() => dateKey && setSelecting({ start: dateKey, end: dateKey })}
                  onMouseEnter={() => dateKey && selecting && setSelecting(prev => ({ ...prev, end: dateKey }))}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => handleCellDrop(dateKey, e)}
                >
                  {dateKey && <div className={`calendar-cell-daynum${isToday ? ' today-badge' : ''}`}>{parseInt(dateKey.slice(-2), 10)}</div>}
                  {dateKey && (
                    <div className="calendar-cell-bands">
                      {Array.from({ length: maxRow + 1 }).map((_, rowIdx) => {
                        const ev = dayEvents.find(e => e.row === rowIdx);
                        if (!ev) return <div className="calendar-band-placeholder" key={rowIdx} />;
                        const c = CALENDAR_COLORS[ev.color] || CALENDAR_COLORS[0];
                        const isStart = ev.start === dateKey;
                        const isEnd = ev.end === dateKey;
                        return (
                          <div
                            key={rowIdx}
                            className={`calendar-band${isStart ? ' band-start' : ''}${isEnd ? ' band-end' : ''}`}
                            style={{ background: c.bg, color: c.text }}
                            draggable
                            onMouseDown={e => e.stopPropagation()}
                            onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ev.id); } catch {} draggingIdRef.current = ev.id; }}
                            onClick={e => { e.stopPropagation(); setPopover({ ...ev }); }}
                            title={ev.title}
                          >
                            {isStart && (
                              <span
                                className="calendar-band-handle handle-start"
                                draggable
                                onMouseDown={e => e.stopPropagation()}
                                onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ev.id); } catch {} resizeRef.current = { id: ev.id, edge: 'start' }; }}
                                title="시작일 조절"
                              />
                            )}
                            {isEnd && (
                              <span
                                className="calendar-band-handle handle-end"
                                draggable
                                onMouseDown={e => e.stopPropagation()}
                                onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', ev.id); } catch {} resizeRef.current = { id: ev.id, edge: 'end' }; }}
                                title="종료일 조절"
                              />
                            )}
                            {isStart && (
                              <span className="calendar-band-label">
                                {'⭐'.repeat(ev.importance || 0)} {ev.title}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <div className="form-hint" style={{ marginTop: 8 }}>
        날짜를 드래그해서 새 일정을 추가하고, 일정을 드래그해서 날짜를 옮길 수 있어요.
      </div>
      {popover && (
        <CalendarEventPopover
          initial={popover}
          onSave={handleSavePopover}
          onDelete={handleDeletePopover}
          onClose={() => setPopover(null)}
        />
      )}
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
            ✅ CORS 프록시는 이 앱에 내장되어 있습니다. 별도의 프록시 URL을 입력할 필요가 없습니다.
          </div>
          <div className="form-group">
            <span className="form-label">Notion API 키 (Integration Secret)</span>
            <input type="password" className="form-input" value={draft.apiKey}
              onChange={e => update('apiKey', e.target.value)} placeholder="secret_... 또는 ntn_..." />
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

function ensureSessionIds(list) {
  return (list || []).map(s => s.id ? s : { ...s, id: uid() });
}

function getInitialPomodoro() {
  const saved = loadLS('wt_pomodoro_settings', { workDuration: WORK_DURATION, breakDuration: BREAK_DURATION });
  return {
    timeLeft: saved.workDuration,
    isRunning: false,
    mode: 'work',
    sessions: ensureSessionIds(loadLS('wt_pomodoro_sessions', [])),
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
            sessions: [...state.sessions, { id: uid(), duration: state.workDuration, date: Date.now() }] };
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
    case 'POMODORO_DELETE_SESSION':
      return { ...state, sessions: state.sessions.filter(s => action.id ? s.id !== action.id : s.date !== action.date) };
    default: return state;
  }
}

function getInitialStopwatch() {
  return { elapsedMs: 0, isRunning: false, laps: [], savedSessions: ensureSessionIds(loadLS('wt_stopwatch_sessions', [])) };
}
function stopwatchReducer(state, action) {
  switch (action.type) {
    case 'SW_TOGGLE': return { ...state, isRunning: !state.isRunning };
    case 'SW_SET_ELAPSED': return { ...state, elapsedMs: action.ms };
    case 'SW_LAP': return state.elapsedMs === 0 ? state : { ...state, laps: [...state.laps, state.elapsedMs] };
    case 'SW_RESET': {
      const newSessions = state.elapsedMs > 1000
        ? [...state.savedSessions, { id: uid(), duration: state.elapsedMs, date: Date.now() }]
        : state.savedSessions;
      return { ...state, isRunning: false, elapsedMs: 0, laps: [], savedSessions: newSessions };
    }
    case 'SW_DELETE_SESSION':
      return { ...state, savedSessions: state.savedSessions.filter(s => action.id ? s.id !== action.id : s.date !== action.date) };
    default: return state;
  }
}

function getInitialTodos() { return loadLS('wt_todos', []); }
function todoReducer(state, action) {
  switch (action.type) {
    case 'TODO_ADD': return [...state, { id: uid(), text: action.text, done: false, repeat: false }];
    case 'TODO_TOGGLE': return state.map(t => t.id === action.id ? { ...t, done: !t.done } : t);
    case 'TODO_TOGGLE_REPEAT': return state.map(t => t.id === action.id ? { ...t, repeat: !t.repeat } : t);
    case 'TODO_DELETE': return state.filter(t => t.id !== action.id);
    case 'TODO_RESET_REPEATING': return state.map(t => t.repeat ? { ...t, done: false } : t);
    default: return state;
  }
}

const DEFAULT_PROFILE = { nickname: '', avatar: null, status: '', urls: [''] };

/* ============================================================
   CARD LAYOUT
   ============================================================ */
const DEFAULT_LAYOUT = [
  { id: 'pomodoro',   w: 420, h: 520 },
  { id: 'stopwatch',  w: 420, h: 520 },
  { id: 'todo',       w: 340, h: 420 },
  { id: 'calculator', w: 420, h: 460 },
  { id: 'notion',     w: 340, h: 300 },
  { id: 'bookmarks',  w: 340, h: 360 },
  { id: 'memo',       w: 640, h: 560 },
  { id: 'calendar',   w: 560, h: 520 },
  { id: 'progress',   w: 380, h: 360 },
];
function loadLayout() {
  const saved = loadLS('wt_layout_v4', null);
  const knownIds = DEFAULT_LAYOUT.map(x => x.id);
  const list = Array.isArray(saved)
    ? saved.filter(x => x && knownIds.includes(x.id) && typeof x.w === 'number' && typeof x.h === 'number')
    : [];
  for (const def of DEFAULT_LAYOUT) {
    if (!list.some(c => c.id === def.id)) list.push(def);
  }
  return list;
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
    return { apiKey: legacy.apiKey || '', databaseId: legacy.databaseId || '' };
  });
  const [profile, setProfile] = useState(() => loadLS('wt_profile', DEFAULT_PROFILE));
  const [memoPosts, setMemoPosts] = useState(() => loadLS('wt_memo_posts', []));
  const [diaryEntries, setDiaryEntries] = useState(() => loadLS('wt_diary_entries', []));
  const [bookmarks, setBookmarks] = useState(() => loadLS('wt_bookmarks', []));
  const [calendarEvents, setCalendarEvents] = useState(() => loadLS('wt_calendar_events', []));
  const [projects, setProjects] = useState(() => loadLS('wt_projects', []));
  const [notionModalOpen, setNotionModalOpen] = useState(false);
  const [pomodoroModalOpen, setPomodoroModalOpen] = useState(false);
  const [diaryModalOpen, setDiaryModalOpen] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => loadLS('wt_pomodoro_notify', true));
  const [layout, setLayout] = useState(loadLayout);
  const [dragId, setDragId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const todayKey = getTodayKey();

  useEffect(() => { document.body.className = `theme-${theme}`; saveLS('wt_theme', theme); }, [theme]);
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
  useEffect(() => { saveLS('wt_diary_entries', diaryEntries); }, [diaryEntries]);
  useEffect(() => { saveLS('wt_bookmarks', bookmarks); }, [bookmarks]);
  useEffect(() => { saveLS('wt_calendar_events', calendarEvents); }, [calendarEvents]);
  useEffect(() => { saveLS('wt_projects', projects); }, [projects]);
  useEffect(() => { saveLS('wt_layout_v4', layout); }, [layout]);
  useEffect(() => { saveLS('wt_pomodoro_notify', notificationsEnabled); }, [notificationsEnabled]);

  useEffect(() => {
    const lastReset = loadLS('wt_todos_reset_date', null);
    if (lastReset !== todayKey) {
      todoDispatch({ type: 'TODO_RESET_REPEATING' });
      saveLS('wt_todos_reset_date', todayKey);
    }
  }, []);

  const THEMES = ['pink', 'blue', 'mint', 'lavender', 'peach', 'lemon', 'sky', 'rose', 'sage', 'lilac'];
  function toggleTheme() { setTheme(t => THEMES[(THEMES.indexOf(t) + 1) % THEMES.length] || 'pink'); }

  function handleAddMemoPost(text) {
    setMemoPosts(prev => [{ id: uid(), text, date: Date.now() }, ...prev]);
  }
  function handleDeleteMemoPost(id) { setMemoPosts(prev => prev.filter(p => p.id !== id)); }
  function handleEditMemoPost(id, text) {
    setMemoPosts(prev => prev.map(p => p.id === id ? { ...p, text, editedAt: Date.now() } : p));
  }

  function handleAddDiary(text) { setDiaryEntries(prev => [{ id: uid(), text, date: Date.now() }, ...prev]); }
  function handleDeleteDiary(id) { setDiaryEntries(prev => prev.filter(p => p.id !== id)); }
  function handleEditDiary(id, text) {
    setDiaryEntries(prev => prev.map(p => p.id === id ? { ...p, text, editedAt: Date.now() } : p));
  }

  function handleAddBookmark(b) { setBookmarks(prev => [{ id: uid(), ...b }, ...prev]); }
  function handleDeleteBookmark(id) { setBookmarks(prev => prev.filter(b => b.id !== id)); }
  function handleEditBookmark(id, patch) { setBookmarks(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b)); }
  function handleReorderBookmarks(newList) { setBookmarks(newList); }
  function handleReorderBookmarks(list) { setBookmarks(list); }

  function handleAddEvent(ev) { setCalendarEvents(prev => [...prev, ev]); }
  function handleEditEvent(ev) { setCalendarEvents(prev => prev.map(e => e.id === ev.id ? ev : e)); }
  function handleDeleteEvent(id) { setCalendarEvents(prev => prev.filter(e => e.id !== id)); }

  function handleAddProject(data) {
    const evId = uid();
    const project = { ...data, id: uid(), createdAt: getTodayKey(), checked: [], calendarEventId: evId };
    setProjects(prev => [...prev, project]);
    setCalendarEvents(prev => [...prev, {
      id: evId, title: data.title, start: data.deadline, end: data.deadline,
      color: 0, importance: 1, isDeadline: true, isProject: true,
    }]);
  }
  function handleEditProject(data) {
    setProjects(prev => prev.map(p => p.id === data.id ? { ...p, ...data } : p));
    if (data.calendarEventId) {
      setCalendarEvents(prev => prev.map(e => e.id === data.calendarEventId
        ? { ...e, title: data.title, start: data.deadline, end: data.deadline }
        : e));
    }
  }
  function handleDeleteProject(id) {
    const target = projects.find(p => p.id === id);
    setProjects(prev => prev.filter(p => p.id !== id));
    if (target && target.calendarEventId) {
      setCalendarEvents(prev => prev.filter(e => e.id !== target.calendarEventId));
    }
  }
  function handleQuickCompleteProject(id) { handleDeleteProject(id); }
  function handleSyncProjectFromEvent(ev) {
    setProjects(prev => {
      const existing = prev.find(p => p.calendarEventId === ev.id);
      if (existing) {
        return prev.map(p => p.id === existing.id ? { ...p, title: ev.title, deadline: ev.end } : p);
      }
      return [...prev, {
        id: uid(), title: ev.title, category: '', deadline: ev.end,
        createdAt: getTodayKey(), stages: [], checked: [], calendarEventId: ev.id,
      }];
    });
  }

  const pomodoroTotalSec = pomodoroState.sessions.reduce((s, x) => s + x.duration, 0);
  const swTotalSec = swState.savedSessions.reduce((s, x) => s + Math.floor(x.duration / 1000), 0);
  const totalMinutes = Math.round((pomodoroTotalSec + swTotalSec) / 60);

  function handleResize(id, dims) {
    setLayout(prev => prev.map(it => it.id === id ? { ...it, ...dims } : it));
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
      render: () => (
        <TimeCalculator
          pomodoroSessions={pomodoroState.sessions}
          swSessions={swState.savedSessions}
          targetMinutes={targetMinutes}
          onSetTarget={setTargetMinutes}
          onDeletePomodoro={(id, date) => pomodoroDispatch({ type: 'POMODORO_DELETE_SESSION', id, date })}
          onDeleteStopwatch={(id, date) => swDispatch({ type: 'SW_DELETE_SESSION', id, date })}
        />
      ),
    },
    notion: {
      title: '📤 Notion Sync',
      render: () => <NotionSync settings={notionSettings} totalMinutes={totalMinutes} onOpenSettings={() => setNotionModalOpen(true)} />,
    },
    bookmarks: {
      title: '🔖 Bookmarks',
      render: () => <Bookmarks bookmarks={bookmarks} onAdd={handleAddBookmark} onDelete={handleDeleteBookmark} onEdit={handleEditBookmark} onReorder={handleReorderBookmarks} />,
    },
    memo: {
      title: '💬 Memo Feed',
      render: () => <MemoFeed profile={profile} posts={memoPosts} onAdd={handleAddMemoPost} onDelete={handleDeleteMemoPost} onEdit={handleEditMemoPost} />,
    },
    calendar: {
      title: '📅 Calendar',
      render: () => <Calendar events={calendarEvents} onAdd={handleAddEvent} onEdit={handleEditEvent} onDelete={handleDeleteEvent} onSyncProject={handleSyncProjectFromEvent} />,
    },
    progress: {
      title: '📈 Progress',
      render: () => <ProjectPanel projects={projects} onAdd={handleAddProject} onEdit={handleEditProject} onDelete={handleDeleteProject} onQuickComplete={handleQuickCompleteProject} />,
    },
  };

  return (
    <div className="app-window">
      <MacMenubar
        theme={theme}
        onToggleTheme={toggleTheme}
        onOpenNotion={() => setNotionModalOpen(true)}
        onOpenPomodoroSettings={() => setPomodoroModalOpen(true)}
        onOpenDiary={() => setDiaryModalOpen(true)}
      />

      <ProfileBar profile={profile} onChange={setProfile} calendarEvents={calendarEvents} />

      <div className="main-grid" onDragEnd={handleDragEnd}>
        {layout.map(item => {
          const def = CARDS[item.id];
          if (!def) return null;
          return (
            <MacWindow
              key={item.id}
              id={item.id}
              title={def.title}
              w={item.w}
              h={item.h}
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
      {diaryModalOpen && (
        <DiaryModal
          profile={profile}
          entries={diaryEntries}
          onAdd={handleAddDiary}
          onDelete={handleDeleteDiary}
          onEdit={handleEditDiary}
          onClose={() => setDiaryModalOpen(false)}
        />
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
