import { useState, useRef, useCallback, useEffect } from 'react';

export default function Scanner() {
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [len3, setLen3] = useState(true);
  const [len4, setLen4] = useState(true);
  const [len5, setLen5] = useState(true);
  const [useLetters, setUseLetters] = useState(true);
  const [useNumbers, setUseNumbers] = useState(false);
  const [useUnderscore, setUseUnderscore] = useState(false);
  const [delay, setDelay] = useState(100);
  const [batchSize, setBatchSize] = useState(10);
  const [maxNames, setMaxNames] = useState(100);
  const [wordlist, setWordlist] = useState('');
  const [mode, setMode] = useState('scan');
  const [useProxy, setUseProxy] = useState(true);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [results, setResults] = useState([]);
  const [stats, setStats] = useState({ checked: 0, available: 0, taken: 0, remaining: 0 });
  const [activeTab, setActiveTab] = useState('log');
  const [testStatus, setTestStatus] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const abortRef = useRef(false);
  const logEndRef = useRef(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const addLog = useCallback((msg, type = 'info') => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => [...prev, { time, msg, type }]);
  }, []);

  const generateNames = useCallback(() => {
    const chars = [];
    if (useLetters) chars.push(...'abcdefghijklmnopqrstuvwxyz'.split(''));
    if (useNumbers) chars.push(...'0123456789'.split(''));
    if (useUnderscore) chars.push('_');

    if (chars.length === 0) { addLog('Select at least one character set.', 'warn'); return []; }

    const lengths = [];
    if (len3) lengths.push(3);
    if (len4) lengths.push(4);
    if (len5) lengths.push(5);
    if (lengths.length === 0) { addLog('Select at least one target length.', 'warn'); return []; }

    const names = [];
    const max = maxNames || 100;

    for (const len of lengths) {
      const total = Math.pow(chars.length, len);
      const toGenerate = Math.min(Math.floor(max / lengths.length), total);
      const used = new Set();
      let safety = 0;
      while (used.size < toGenerate && safety < toGenerate * 10) {
        safety++;
        let name = '';
        for (let i = 0; i < len; i++) name += chars[Math.floor(Math.random() * chars.length)];
        if (!used.has(name)) { used.add(name); names.push(name); }
      }
    }

    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    return names;
  }, [useLetters, useNumbers, useUnderscore, len3, len4, len5, maxNames, addLog]);

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  const statusLabel = (status) => {
    const map = {
      AVAILABLE: 'AVAILABLE',
      TAKEN: 'TAKEN',
      INVALID: 'INVALID',
      RATE_LIMITED: 'RATE LIMITED',
      UNAUTHORIZED: 'BAD TOKEN',
      ERROR: 'SERVER ERROR',
      HTTP_ERROR: 'SERVER ERROR',
      NETWORK_ERROR: 'NETWORK ERROR',
      UNKNOWN: 'UNKNOWN'
    };
    return map[status] || status;
  };

  const statusType = (status) => {
    if (status === 'AVAILABLE') return 'ok';
    if (status === 'TAKEN') return 'taken';
    return 'warn';
  };

  const startScan = async () => {
    if (running) return;
    if (!token || !password) { addLog('Token and password required.', 'warn'); return; }

    let queue = [];
    if (wordlist.trim()) {
      queue = wordlist.split(/\r?\n|,/).map(x => x.trim().toLowerCase()).filter(x => x.length >= 2 && x.length <= 32);
    } else {
      queue = generateNames();
    }
    if (queue.length === 0) { addLog('No names to check.', 'warn'); return; }

    setRunning(true);
    abortRef.current = false;
    setResults([]);
    setLogs([]);
    setStats({ checked: 0, available: 0, taken: 0, remaining: queue.length });
    addLog(`Starting scan of ${queue.length} usernames...`, 'info');
    addLog(`Batch: ${batchSize} | Delay: ${delay}ms | Proxy: ${useProxy ? 'ON' : 'OFF'}`, 'info');

    let checked = 0, available = 0, taken = 0;
    const batch = [];

    for (let i = 0; i < queue.length && !abortRef.current; i++) {
      batch.push(queue[i]);

      if (batch.length >= batchSize || i === queue.length - 1) {
        const currentBatch = batch.splice(0, batch.length);

        const promises = currentBatch.map(async (username) => {
          if (abortRef.current) return null;
          try {
            const res = await fetch('/api/check', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username, token, password, useProxy })
            });
            return { username, data: await res.json() };
          } catch (err) {
            return { username, data: { status: 'NETWORK_ERROR', message: err.message } };
          }
        });

        const batchResults = await Promise.all(promises);
        let maxRetryAfter = 0;
        let rateLimitedCount = 0;

        for (const item of batchResults) {
          if (!item) continue;
          const { username, data } = item;
          checked++;

          const label = statusLabel(data.status);
          const type = statusType(data.status);

          // Build detailed log message
          let logMsg = `${username} — ${label}`;
          if (data.detail) logMsg += ` (${data.detail})`;
          if (data.httpStatus && data.httpStatus > 0) logMsg += ` [HTTP ${data.httpStatus}]`;
          if (data.retryAfter) logMsg += ` (wait ${data.retryAfter}s)`;
          if (data.message && !data.detail) logMsg += ` (${data.message})`;

          if (data.status === 'AVAILABLE') {
            available++;
            addLog(logMsg, 'ok');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
            if (mode === 'claim') {
              addLog('Claim mode: stopping.', 'ok');
              abortRef.current = true;
            }
          } else if (data.status === 'TAKEN') {
            taken++;
            addLog(logMsg, 'taken');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          } else if (data.status === 'INVALID') {
            addLog(logMsg, 'warn');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          } else if (data.status === 'RATE_LIMITED') {
            rateLimitedCount++;
            const waitTime = data.retryAfter || 5;
            if (waitTime > maxRetryAfter) maxRetryAfter = waitTime;
            addLog(logMsg, 'warn');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          } else if (data.status === 'UNAUTHORIZED') {
            addLog(logMsg, 'warn');
            abortRef.current = true;
          } else if (data.status === 'ERROR' || data.status === 'HTTP_ERROR') {
            addLog(logMsg, 'warn');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          } else if (data.status === 'NETWORK_ERROR') {
            addLog(logMsg, 'warn');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          } else {
            addLog(logMsg, 'warn');
            setResults(prev => [{ username, status: label, time: new Date().toISOString() }, ...prev]);
          }
        }

        setStats({ checked, available, taken, remaining: queue.length - i - 1 });

        if (abortRef.current) break;

        if (rateLimitedCount > 0 && maxRetryAfter > 0) {
          addLog(`Batch hit rate limit. Waiting ${maxRetryAfter}s...`, 'warn');
          await sleep(maxRetryAfter * 1000);
        } else if (i < queue.length - 1 && delay > 0) {
          await sleep(delay);
        }
      }
    }

    setRunning(false);
    addLog('Scan complete.', 'info');
  };

  const stopScan = () => { abortRef.current = true; setRunning(false); };

  const testToken = async () => {
    if (!token) { setTestStatus({ ok: false, msg: 'Enter token first' }); return; }
    setTestStatus({ ok: null, msg: 'Testing...' });
    try {
      const res = await fetch('/api/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, useProxy })
      });
      const data = await res.json();
      if (data.ok) {
        const display = data.global_name || data.username;
        const tag = data.discriminator && data.discriminator !== '0' ? `#${data.discriminator}` : '';
        setTestStatus({ ok: true, msg: `Valid! ${display}${tag} (ID: ${data.id})` });
      } else {
        setTestStatus({ ok: false, msg: data.error || 'Unknown error' });
      }
    } catch (err) {
      setTestStatus({ ok: false, msg: 'Network error: ' + err.message });
    }
  };

  const exportResults = (fmt) => {
    if (results.length === 0) { addLog('No results to export.', 'warn'); return; }
    let content, ext;
    if (fmt === 'json') { content = JSON.stringify(results, null, 2); ext = 'json'; }
    else { content = results.map(r => `${r.username}\t${r.status}\t${r.time}`).join('\n'); ext = 'txt'; }
    const blob = new Blob([content], { type: fmt === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `results-${Date.now()}.${ext}`; a.click();
    URL.revokeObjectURL(url);
  };

  const total = stats.checked + stats.remaining;
  const pct = total > 0 ? (stats.checked / total) * 100 : 0;

  const badgeColor = (s) => {
    if (s === 'AVAILABLE') return '#3ba55d';
    if (s === 'TAKEN') return '#ed4245';
    if (s === 'INVALID' || s === 'RATE LIMITED') return '#f9a62b';
    return '#777';
  };

  const badgeBg = (s) => {
    if (s === 'AVAILABLE') return 'rgba(59,165,93,0.12)';
    if (s === 'TAKEN') return 'rgba(237,66,69,0.12)';
    if (s === 'INVALID' || s === 'RATE LIMITED') return 'rgba(249,166,43,0.12)';
    return 'rgba(136,136,136,0.12)';
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#e8e8e8', fontFamily: 'system-ui, -apple-system, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @media (max-width: 767px) {
          .desktop-only { display: none !important; }
          .mobile-grid { grid-template-columns: 1fr !important; }
          .mobile-stack { flex-direction: column !important; }
          .mobile-full { width: 100% !important; }
          .mobile-pad { padding: 1rem !important; }
          .mobile-header { padding: 1rem !important; }
          .mobile-stat-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .mobile-btn { padding: 0.85rem 1rem !important; min-height: 48px; }
          .mobile-input { padding: 0.8rem 0.9rem !important; min-height: 48px; font-size: 16px !important; }
          .mobile-textarea { padding: 0.8rem 0.9rem !important; font-size: 16px !important; }
          .mobile-select { padding: 0.8rem 0.9rem !important; min-height: 48px; font-size: 16px !important; }
          .mobile-toggle { min-height: 48px; padding: 0.6rem 1rem !important; }
          .mobile-sidebar {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 100;
            background: #0a0a0a;
            overflow-y: auto;
            padding: 1rem;
            transform: translateX(-100%);
            transition: transform 0.3s ease;
          }
          .mobile-sidebar.open { transform: translateX(0); }
          .mobile-overlay {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7);
            z-index: 99;
            opacity: 0; pointer-events: none;
            transition: opacity 0.3s;
          }
          .mobile-overlay.open { opacity: 1; pointer-events: all; }
          .mobile-log { height: 40vh !important; }
          .mobile-results { max-height: 50vh !important; }
        }
        @media (min-width: 768px) {
          .mobile-only { display: none !important; }
        }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
      `}</style>

      <header style={{ background: '#141414', borderBottom: '1px solid #2a2a2a', padding: '1.25rem 2rem' }} className="mobile-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '1.2rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
              Username Scanner
              <span style={{ background: '#5865F2', color: 'white', fontSize: '0.6rem', padding: '0.15rem 0.4rem', borderRadius: '3px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vercel</span>
            </div>
            <div style={{ color: '#777', fontSize: '0.8rem', marginTop: '0.2rem' }}>Proxied. Mobile-ready. No logs.</div>
          </div>
          <button 
            className="mobile-only" 
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{ background: '#1f1f1f', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.9rem' }}
          >
            {sidebarOpen ? '✕ Close' : '☰ Config'}
          </button>
        </div>
      </header>

      <div className={`mobile-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '380px 1fr', gap: '1px', background: '#2a2a2a' }} className="mobile-grid">
        <div style={{ background: '#0a0a0a', padding: '1.5rem', overflowY: 'auto' }} className={`desktop-only mobile-sidebar ${sidebarOpen ? 'open' : ''}`}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#777' }}>Configuration</h2>
            <button className="mobile-only" onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: '#777', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
          </div>

          <div style={{ background: 'rgba(59,165,93,0.06)', border: '1px solid rgba(59,165,93,0.2)', borderRadius: '5px', padding: '0.75rem', fontSize: '0.78rem', color: '#3ba55d', marginBottom: '1rem', lineHeight: 1.5 }}>
            <strong>Privacy:</strong> Token & password sent only to your API route, then straight to Discord. Nothing logged.
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Discord Token</label>
            <div style={{ position: 'relative' }}>
              <input type={showToken ? 'text' : 'password'} value={token} onChange={e => setToken(e.target.value)} placeholder="mfa.xxx... or Bot token" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-input" />
              <button onClick={() => setShowToken(!showToken)} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '0.75rem' }}>{showToken ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Discord Password</label>
            <div style={{ position: 'relative' }}>
              <input type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Required for username changes" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-input" />
              <button onClick={() => setShowPass(!showPass)} style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#777', cursor: 'pointer', fontSize: '0.75rem' }}>{showPass ? 'Hide' : 'Show'}</button>
            </div>
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <button onClick={testToken} style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.35rem 0.7rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }} className="mobile-toggle">Test Token</button>
            {testStatus && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.4rem', borderRadius: '4px', border: `1px solid ${testStatus.ok ? 'rgba(59,165,93,0.2)' : 'rgba(237,66,69,0.2)'}`, background: testStatus.ok ? 'rgba(59,165,93,0.1)' : 'rgba(237,66,69,0.1)', color: testStatus.ok ? '#3ba55d' : '#ed4245' }}>
                {testStatus.msg}
              </div>
            )}
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              <input type="checkbox" checked={useProxy} onChange={e => setUseProxy(e.target.checked)} style={{ width: 18, height: 18, accentColor: '#5865F2' }} />
              <span>Use Proxy (vital-proxies.com)</span>
            </label>
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Lengths</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={len3} onChange={e => setLen3(e.target.checked)} /> 3 characters</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={len4} onChange={e => setLen4(e.target.checked)} /> 4 characters</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={len5} onChange={e => setLen5(e.target.checked)} /> 5 characters</label>
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Character Set</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={useLetters} onChange={e => setUseLetters(e.target.checked)} /> Letters a-z</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={useNumbers} onChange={e => setUseNumbers(e.target.checked)} /> Numbers 0-9</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', cursor: 'pointer', fontSize: '0.85rem' }}><input type="checkbox" checked={useUnderscore} onChange={e => setUseUnderscore(e.target.checked)} /> Underscore _</label>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Batch Size</label>
              <input type="number" value={batchSize} onChange={e => setBatchSize(Number(e.target.value))} min="1" max="50" step="1" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-input" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Delay (ms)</label>
              <input type="number" value={delay} onChange={e => setDelay(Number(e.target.value))} min="0" max="5000" step="50" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-input" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '1.1rem' }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Max Names</label>
              <input type="number" value={maxNames} onChange={e => setMaxNames(Number(e.target.value))} min="1" max="5000" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-input" />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</label>
              <select value={mode} onChange={e => setMode(e.target.value)} style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem' }} className="mobile-select">
                <option value="scan">Scan</option>
                <option value="claim">Claim</option>
              </select>
            </div>
          </div>

          <div style={{ marginBottom: '1.1rem' }}>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '0.35rem', color: '#777', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Custom Wordlist</label>
            <textarea value={wordlist} onChange={e => setWordlist(e.target.value)} placeholder="One username per line" style={{ width: '100%', background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.6rem 0.75rem', borderRadius: '5px', fontSize: '0.9rem', resize: 'vertical', minHeight: '70px' }} className="mobile-textarea" />
          </div>

          <div style={{ background: 'rgba(249,166,43,0.06)', border: '1px solid rgba(249,166,43,0.2)', borderRadius: '5px', padding: '0.75rem', fontSize: '0.78rem', color: '#f9a62b', marginBottom: '1rem', lineHeight: 1.5 }}>
            <strong>Note:</strong> Discord has no check-only endpoint. PATCH /users/@me will claim available names instantly.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <button onClick={() => { setSidebarOpen(false); startScan(); }} disabled={running} style={{ background: running ? '#333' : '#5865F2', color: 'white', border: 'none', padding: '0.65rem 1rem', borderRadius: '5px', fontSize: '0.85rem', fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }} className="mobile-btn">
              {running ? 'Scanning...' : 'Start Scan'}
            </button>
            <button onClick={stopScan} disabled={!running} style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.65rem 1rem', borderRadius: '5px', fontSize: '0.85rem', fontWeight: 700, cursor: !running ? 'not-allowed' : 'pointer', textTransform: 'uppercase' }} className="mobile-btn">
              Stop
            </button>
          </div>
        </div>

        <div style={{ background: '#0a0a0a', padding: '1.5rem', overflowY: 'auto' }} className="mobile-pad">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1px', background: '#2a2a2a', borderRadius: '6px', overflow: 'hidden', marginBottom: '1rem' }} className="mobile-stat-grid">
            <div style={{ background: '#141414', padding: '0.9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#00b0f4' }}>{stats.checked}</div>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#777', marginTop: '0.15rem' }}>Checked</div>
            </div>
            <div style={{ background: '#141414', padding: '0.9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#3ba55d' }}>{stats.available}</div>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#777', marginTop: '0.15rem' }}>Available</div>
            </div>
            <div style={{ background: '#141414', padding: '0.9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#ed4245' }}>{stats.taken}</div>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#777', marginTop: '0.15rem' }}>Taken</div>
            </div>
            <div style={{ background: '#141414', padding: '0.9rem', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f9a62b' }}>{stats.remaining}</div>
              <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#777', marginTop: '0.15rem' }}>Remaining</div>
            </div>
          </div>

          <div style={{ height: '3px', background: '#141414', borderRadius: '2px', overflow: 'hidden', marginBottom: '1rem' }}>
            <div style={{ height: '100%', background: '#5865F2', width: pct + '%', transition: 'width 0.3s' }}></div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', borderBottom: '1px solid #2a2a2a', paddingBottom: '0.5rem' }}>
            <button onClick={() => setActiveTab('log')} style={{ background: activeTab === 'log' ? 'rgba(88,101,242,0.1)' : 'none', border: 'none', color: activeTab === 'log' ? '#5865F2' : '#777', padding: '0.35rem 0.7rem', borderRadius: '4px', cursor: 'pointer', fontWeight: activeTab === 'log' ? 600 : 400 }}>Live Log</button>
            <button onClick={() => setActiveTab('results')} style={{ background: activeTab === 'results' ? 'rgba(88,101,242,0.1)' : 'none', border: 'none', color: activeTab === 'results' ? '#5865F2' : '#777', padding: '0.35rem 0.7rem', borderRadius: '4px', cursor: 'pointer', fontWeight: activeTab === 'results' ? 600 : 400 }}>Results</button>
          </div>

          {activeTab === 'log' && (
            <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: '5px', height: '280px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.78rem', padding: '0.6rem' }} className="mobile-log">
              {logs.map((l, i) => (
                <div key={i} style={{ padding: '0.15rem 0', borderBottom: '1px solid rgba(255,255,255,0.02)', display: 'flex', gap: '0.5rem' }}>
                  <span style={{ color: '#777', whiteSpace: 'nowrap', flexShrink: 0 }}>[{l.time}]</span>
                  <span style={{ color: l.type === 'ok' ? '#3ba55d' : l.type === 'taken' ? '#ed4245' : l.type === 'warn' ? '#f9a62b' : '#00b0f4', wordBreak: 'break-all' }}>{l.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          )}

          {activeTab === 'results' && (
            <div>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                <button onClick={() => exportResults('json')} style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.35rem 0.7rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>Export JSON</button>
                <button onClick={() => exportResults('txt')} style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.35rem 0.7rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>Export TXT</button>
                <button onClick={() => { setResults([]); addLog('Results cleared.', 'info'); }} style={{ background: '#141414', border: '1px solid #2a2a2a', color: '#e8e8e8', padding: '0.35rem 0.7rem', borderRadius: '5px', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700 }}>Clear</button>
              </div>
              <div style={{ maxHeight: '380px', overflowY: 'auto' }} className="mobile-results">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ background: '#141414' }}>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.7rem', borderBottom: '1px solid #2a2a2a', color: '#777', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Username</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.7rem', borderBottom: '1px solid #2a2a2a', color: '#777', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Status</th>
                      <th style={{ textAlign: 'left', padding: '0.5rem 0.7rem', borderBottom: '1px solid #2a2a2a', color: '#777', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.length === 0 ? (
                      <tr><td colSpan="3" style={{ textAlign: 'center', padding: '2.5rem', color: '#777' }}>No results yet.</td></tr>
                    ) : results.map((r, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #2a2a2a' }}>
                        <td style={{ padding: '0.5rem 0.7rem', wordBreak: 'break-all' }}>{r.username}</td>
                        <td style={{ padding: '0.5rem 0.7rem' }}>
                          <span style={{ display: 'inline-block', padding: '0.1rem 0.4rem', borderRadius: '3px', fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', background: badgeBg(r.status), color: badgeColor(r.status) }}>{r.status}</span>
                        </td>
                        <td style={{ padding: '0.5rem 0.7rem', color: '#777', whiteSpace: 'nowrap' }}>{new Date(r.time).toLocaleTimeString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
