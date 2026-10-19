import { useEffect, useState } from 'react';
import { managementRequest } from './management-api.js';

const RECEIPT_KEY = 'origrami.registration.receipt.v1';

export default function Registration({ onClose }) {
  const [receipt, setReceipt] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(RECEIPT_KEY) || 'null'); }
    catch { return null; }
  });
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [request, setRequest] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);

  async function refresh(signal) {
    if (!receipt?.claim_token) return;
    try {
      const result = await managementRequest('/registration', { token: receipt.claim_token, signal });
      if (!signal?.aborted) { setRequest(result); setError(''); }
    } catch (e) { if (!signal?.aborted) setError(e.message); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = setInterval(() => { void refresh(controller.signal); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [receipt?.claim_token]);

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (receipt) {
        await managementRequest('/registration/activate', { token: receipt.claim_token, method: 'POST', body: { password } });
        setPassword(''); setComplete(true);
        sessionStorage.removeItem(RECEIPT_KEY);
      } else {
        // Check storage before submitting: the receipt is needed to claim approval.
        sessionStorage.setItem(RECEIPT_KEY, 'null');
        const result = await managementRequest('/registration', { method: 'POST', body: { username: username.trim(), display_name: displayName.trim() } });
        sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(result));
        setReceipt(result); setRequest({ ...result, username: username.trim() });
      }
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function discard() {
    sessionStorage.removeItem(RECEIPT_KEY); setReceipt(null); setRequest(null); setError('');
  }

  return <section className="registration-panel" aria-labelledby="registration-title">
    <button type="button" className="help-link" onClick={onClose}>← Back to sign in</button>
    <div className="login-overline">YOUR OWN SPACE</div>
    <h2 id="registration-title">Request an account.</h2>
    {error && <p role="alert" className="error-note">{error}</p>}
    {complete ? <><p>Your account is ready. Sign in with your username and chosen password.</p><button type="button" className="primary-button" onClick={onClose}>Go to sign in</button></> : <>
      {receipt ? <>
        <p role="status"><strong>{request?.username || 'Your request'}</strong> · {request?.status || 'Checking status …'}</p>
        {request?.status === 'pending' && <p>An administrator will review your request. Keep this tab open or save the receipt below; you will choose a password after approval.</p>}
        {request?.status === 'rejected' && <p>Your request was declined. Contact the server administrator if you think this was a mistake.</p>}
        {request?.status === 'activated' && <p>Your account has already been activated. You can sign in.</p>}
        {request?.status === 'accepted' && <form className="auth-form" onSubmit={submit}>
          <p>Your request was approved. Choose a password to activate your account.</p>
          <label htmlFor="new-password">Password (at least 12 characters)</label>
          <input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} />
          <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Activating …' : 'Activate account'}</button>
        </form>}
        <details className="receipt"><summary>Save or restore your request receipt</summary>
          <p>This private receipt lets you claim your account. Keep it secret. It is stored in this browser tab until activation.</p>
          <label htmlFor="receipt-token">Private receipt</label><input id="receipt-token" value={receipt.claim_token} readOnly />
        </details>
        <button type="button" className="help-link" disabled={busy} onClick={() => { void refresh(); }}>Check status</button>
        {['rejected', 'activated'].includes(request?.status) && <button type="button" className="help-link" onClick={discard}>Clear receipt</button>}
      </> : <form className="auth-form" onSubmit={submit}>
        <p>Choose a username and tell the administrators your name. Only approved requests can create an account.</p>
        <label htmlFor="request-username">Username</label><input id="request-username" autoComplete="username" pattern="[a-z0-9][a-z0-9._\-]*" maxLength={64} required value={username} onChange={e => setUsername(e.target.value)} placeholder="e.g. charlie" />
        <label htmlFor="request-name">Display name</label><input id="request-name" autoComplete="name" maxLength={100} required value={displayName} onChange={e => setDisplayName(e.target.value)} />
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Submitting …' : 'Request access'}</button>
        <details className="receipt"><summary>Already have a receipt?</summary>
          <label htmlFor="restore-receipt">Private receipt</label><input id="restore-receipt" type="password" autoComplete="off" />
          <button type="button" className="help-link" onClick={() => {
            const token = document.getElementById('restore-receipt').value.trim();
            if (!token) return;
            const next = { claim_token: token };
            try { sessionStorage.setItem(RECEIPT_KEY, JSON.stringify(next)); setReceipt(next); }
            catch { setError('Please allow session storage to restore your receipt.'); }
          }}>Restore request</button>
        </details>
      </form>}
    </>}
  </section>;
}
