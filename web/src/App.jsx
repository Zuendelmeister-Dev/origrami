import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ChevronDown, CircleHelp, Feather, LockKeyhole,
  LogOut, MessageCircle, Moon, Plus, Send, ShieldCheck, Sun, Users, X,
} from 'lucide-react';
import BrandMark from './BrandMark.jsx';
import AdminPanel from './AdminPanel.jsx';
import Registration from './Registration.jsx';
import { managementRequest } from './management-api.js';
import { version as APP_VERSION } from '../package.json';
import {
  MATRIX_URL, createEncryptedChat, createEncryptedGroup, forgetSession, loadSession, loginMatrix,
  readMessages, readRooms, saveSession, startMatrix, sendEncryptedText, endMatrixSession,
} from './matrix.js';

const simpleTime = (ms) => (ms ? new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(ms)) : '');
const shortUser = (id) => id?.split(':')[0]?.replace('@', '') || 'You';
const friendlyError = (error) => error?.errcode === 'M_FORBIDDEN'
  ? 'Access denied. Please check your credentials and permissions.'
  : error?.data?.error || error?.message || 'Something went wrong.';

function Brand({ inverse = false, compact = false }) {
  return (
    <div className={`brand ${inverse ? 'brand-inverse' : ''}`}>
      <span className="brand-icon"><BrandMark size={compact ? 30 : 37} /></span>
      <span className="brand-name">origrami<span>.</span></span>
    </div>
  );
}

function ThemeToggle({ theme, onChange }) {
  return (
    <button
      className="icon-button theme-switch" type="button"
      title={theme === 'burgundy' ? 'Switch to black and gold' : 'Switch to burgundy and silver'}
      aria-label="Change colour palette"
      onClick={() => onChange(theme === 'burgundy' ? 'noir' : 'burgundy')}
    >
      {theme === 'burgundy' ? <Moon size={18} /> : <Sun size={18} />}
    </button>
  );
}

function LoginScreen({ onLogin, busy, error, theme, setTheme }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [registering, setRegistering] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (username.trim() && password) await onLogin(username, password);
  }

  return (
    <div className="auth-screen">
      <aside className="auth-story">
        <div className="auth-top"><Brand inverse /> <span className="small-pill"><span className="dot-online" /> SELF-HOSTED</span></div>
        <div className="auth-story-content">
          <div className="story-tag"><Feather size={14} /> SPACE FOR WHAT MATTERS</div>
          <h1>Your words.<br />Your server.<br /><em>Your conversation.</em></h1>
          <p>Your conversations belong to you. Host them yourself, on infrastructure you control.</p>
          <div className="hero-art" aria-hidden="true">
            <span className="hero-halo" />
            <span className="hero-frame"><BrandMark size={205} /></span>
            <span className="hero-spark one">✦</span><span className="hero-spark two">✧</span>
            <span className="hero-art-caption">FOLDED WITH CARE · OPENED FOR YOU</span>
          </div>
        </div>
        <div className="auth-foot"><ShieldCheck size={16}/> End-to-end encrypted chats on your Matrix server</div>
      </aside>

      <main className="auth-main">
        <div className="auth-actions"><span>TEST VERSION · v{APP_VERSION}</span><ThemeToggle theme={theme} onChange={setTheme}/></div>
        <div className="login-box">
          {registering ? <Registration onClose={() => setRegistering(false)} /> : <>
          <div className="login-overline">GOOD TO HAVE YOU HERE</div>
          <h2>Welcome back.</h2>
          <p>A good place for the conversations that matter.</p>
          <div className="prototype-note" role="note"><strong>Try it out with test content.</strong> Device verification and key recovery are not available yet. Protection against a malicious operator is not yet guaranteed. Images and videos are not supported yet.</div>
          <form onSubmit={submit} className="auth-form">
            <label htmlFor="username">Username</label>
            <input id="username" autoComplete="username" placeholder="e.g. alice" value={username} onChange={(e) => setUsername(e.target.value)} required />
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            {error && <div role="alert" className="error-note">{error}</div>}
            <button className="primary-button login-button" disabled={busy} type="submit">
              {busy ? 'Connecting to Matrix …' : 'Sign in'} {!busy && <ArrowRight size={18} />}
            </button>
          </form>
          <button className="help-link" type="button" onClick={() => setShowInfo(!showInfo)}><CircleHelp size={16} /> How do I get access? <ChevronDown size={15} className={showInfo ? 'rotate' : ''}/></button>
          {showInfo && <div className="help-panel">This is a private server. Request an account below; an administrator will review it. Local test accounts are described in <code>README.md</code>.</div>}
          <button type="button" className="help-link" disabled={busy} onClick={() => setRegistering(true)}>Request an account →</button>
          </>}
        </div>
        <div className="footer-minimal"><LockKeyhole size={14} /> Homeserver <code>{MATRIX_URL}</code></div>
      </main>
    </div>
  );
}

function NoChat({ startChat }) {
  return (
    <div className="no-chat">
      <div className="no-chat-art"><BrandMark size={112}/></div>
      <div className="eyebrow">A SMALL BEGINNING</div>
      <h2>A folded letter.<br/>A personal conversation.</h2>
      <p>Choose a conversation on the left or start an encrypted chat.</p>
      <button className="primary-button" type="button" onClick={startChat}><Plus size={18}/> New conversation</button>
    </div>
  );
}

function Avatar({ name, large = false, group = false }) {
  return <span className={`avatar ${large ? 'avatar-large' : ''}`} aria-hidden="true">{group ? <Users size={21} /> : (name || '?').slice(0, 1).toUpperCase()}</span>;
}

function ChatScreen({ session, client, onLogout, loggingOut, theme, setTheme }) {
  const [rooms, setRooms] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [drafts, setDrafts] = useState({});
  const draft = drafts[selectedId] || '';
  const setDraft = (value) => setDrafts((previous) => ({ ...previous, [selectedId]: value }));
  const [syncState, setSyncState] = useState(client.getSyncState());
  const [recipient, setRecipient] = useState('');
  const [conversationType, setConversationType] = useState('direct');
  const [groupName, setGroupName] = useState('');
  const [groupRecipients, setGroupRecipients] = useState('');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyCreate, setBusyCreate] = useState(false);
  const busyCreateRef = useRef(false);
  busyCreateRef.current = busyCreate;
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const [managementIdentity, setManagementIdentity] = useState(null);
  const [managementOpen, setManagementOpen] = useState(false);
  const endRef = useRef(null);
  const openerRef = useRef(null);
  const pendingRoomRef = useRef(null);
  const openCreate = (event) => { openerRef.current = event?.currentTarget; setCreating(true); setCreateError(''); };

  useEffect(() => {
    const controller = new AbortController();
    const refresh = () => managementRequest('/me', { token: session.accessToken, signal: controller.signal })
      .then(identity => { if (!controller.signal.aborted) setManagementIdentity(identity); })
      .catch(() => { if (!controller.signal.aborted) setManagementIdentity(null); });
    void refresh();
    const timer = setInterval(refresh, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [session.accessToken]);

  // Refresh from SDK events, including late decryption and redactions.
  useEffect(() => {
    const refresh = () => {
      const next = readRooms(client);
      setRooms(next);
      setSelectedId((previous) => {
        if (next.some((room) => room.roomId === previous)) { pendingRoomRef.current = null; return previous; }
        if (previous && pendingRoomRef.current === previous) return previous;
        return next.find((room) => room.membership === 'join')?.roomId || null;
      });
    };
    refresh();
    const events = ['Room', 'Room.timeline', 'Room.name', 'RoomMember.membership', 'RoomState.events', 'Event.decrypted', 'Room.redaction', 'Room.localEchoUpdated'];
    events.forEach((event) => client.on(event, refresh));
    const sync = (state) => { setSyncState(state); refresh(); };
    client.on('sync', sync);
    return () => { events.forEach((event) => client.removeListener(event, refresh)); client.removeListener('sync', sync); };
  }, [client]);

  const selected = rooms.find((r) => r.roomId === selectedId);
  const messages = useMemo(() => selected?.room ? readMessages(selected.room) : [], [selected, rooms]);
  const filteredRooms = rooms.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [selectedId, messages.length]);

  useEffect(() => {
    if (!creating) return;
    const previous = openerRef.current;
    const dialog = document.querySelector('[role="dialog"]');
    const keydown = (event) => {
      if (event.key === 'Escape' && !busyCreateRef.current) setCreating(false);
      if (event.key !== 'Tab' || !dialog) return;
      const items = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')];
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, [creating]);

  async function create(event) {
    event.preventDefault();
    if (busyCreateRef.current || loggingOut) return;
    busyCreateRef.current = true;
    setBusyCreate(true); setCreateError('');
    try {
      const roomId = conversationType === 'group'
        ? await createEncryptedGroup(client, groupName, groupRecipients)
        : await createEncryptedChat(client, recipient);
      pendingRoomRef.current = roomId;
      setRooms(readRooms(client));
      setCreating(false); setRecipient(''); setGroupName(''); setGroupRecipients('');
      setSelectedId(roomId); setMobileChatOpen(true);
    } catch (e) { setCreateError(friendlyError(e)); }
    finally { busyCreateRef.current = false; setBusyCreate(false); }
  }

  async function send(event) {
    event.preventDefault();
    if (!selected || !draft.trim() || sending || loggingOut) return;
    if (selected.membership !== 'join') return;
    if (!selected.room.hasEncryptionStateEvent()) {
      setError('This room is not encrypted. Sending has been blocked.');
      return;
    }
    const text = draft.trim();
    setSending(true); setError('');
    try { await sendEncryptedText(client, selected.roomId, text); setDraft(''); }
    catch (e) { setError(friendlyError(e)); }
    finally { setSending(false); }
  }

  async function joinInvite() {
    setError('');
    try { await client.joinRoom(selected.roomId); }
    catch (e) { setError(friendlyError(e)); }
  }

  if (managementOpen) return <AdminPanel session={session} onClose={() => setManagementOpen(false)} />;

  return (
    <div className="app-frame">
      <div className={`sidebar ${mobileChatOpen ? 'mobile-hidden' : ''}`} inert={creating}>
        <div className="sidebar-header"><Brand compact /><div className="top-icons"><ThemeToggle theme={theme} onChange={setTheme}/><button type="button" className="icon-button" title="Sign out" disabled={loggingOut} onClick={onLogout}><LogOut size={18}/></button></div></div>
        <div className="user-card"><Avatar name={shortUser(session.userId)}/><div><strong>{shortUser(session.userId)}</strong><span>{managementIdentity?.role === 'superuser' ? 'Superuser · Your private space' : managementIdentity?.role === 'admin' ? 'Admin · Your private space' : 'Your private space'}</span></div><span className={`online-indicator ${['SYNCING', 'PREPARED'].includes(syncState) ? '' : 'offline'}`} title={['SYNCING', 'PREPARED'].includes(syncState) ? 'Connected' : 'Connecting'}/></div>
        {['admin', 'superuser'].includes(managementIdentity?.role) && <button type="button" className="management-entry" onClick={() => setManagementOpen(true)}><ShieldCheck size={17} /> Server management <ArrowRight size={16} /></button>}
        <div className="sidebar-section-title"><span>YOUR CONVERSATIONS</span><button className="add-chat" title="New encrypted chat" type="button" onClick={openCreate}><Plus size={19}/></button></div>
        <input className="search-input" aria-label="Search chats" placeholder="Search conversations …" value={search} onChange={(e) => setSearch(e.target.value)}/>
        <div className="sync-status" role="status">{['SYNCING', 'PREPARED'].includes(syncState) ? 'Connected to the homeserver' : 'Disconnected or connecting …'}</div><div className="room-list">
          {filteredRooms.length === 0 ? <div className="empty-list"><MessageCircle size={25}/><span>{rooms.length ? 'No matching chats.' : 'Your conversations will appear here.'}</span></div> : filteredRooms.map((room) => (
            <button type="button" key={room.roomId} className={`room-item ${room.roomId === selectedId ? 'selected' : ''}`} onClick={() => { setSelectedId(room.roomId); setMobileChatOpen(true); setError(''); }}>
              <Avatar name={room.name} group={room.isGroup}/>
              <span className="room-label"><strong>{room.name}</strong><small>{room.membership === 'invite' ? 'Invitation received' : room.encrypted ? (room.isGroup ? 'Encrypted group' : 'Encrypted conversation') : 'Not encrypted'}</small></span>
              {room.encrypted && <LockKeyhole size={14} className="room-lock"/>}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom"><span className="privacy-check"><ShieldCheck size={16}/> Self-hosted prototype</span><span>Signing in again creates a new device. Older messages may remain unreadable without key recovery.</span><span>Origrami {APP_VERSION} · Powered by Matrix</span></div>
      </div>

      <main className={`conversation ${!mobileChatOpen ? 'mobile-hidden' : ''}`} inert={creating}>
        {!selected ? <NoChat startChat={openCreate}/> : <>
          <div className="conversation-header">
            <button className="icon-button mobile-back" type="button" onClick={() => setMobileChatOpen(false)} aria-label="Back to chats"><ArrowLeft size={21}/></button>
            <Avatar name={selected.name} group={selected.isGroup}/>
            <div className="conversation-heading"><strong>{selected.name}</strong><span>{selected.encrypted ? <><LockKeyhole size={13}/> Encrypted · Devices not verified</> : 'Not encrypted'} · {selected.members.length} members</span></div>
            <span className="encryption-chip"><ShieldCheck size={15}/> {selected.encrypted ? 'ENCRYPTED' : 'UNPROTECTED'}</span>
          </div>
          {selected.membership === 'invite' ? (
            <div className="invite-area"><div className="invite-icon"><Feather size={28}/></div><h2>You have an invitation.</h2><p>{selected.name} wants to chat with you. Check the encryption status before joining.</p>{error && <div className="error-note" role="alert">{error}</div>}<button className="primary-button" type="button" onClick={joinInvite}><Check size={16}/> Accept invitation</button></div>
          ) : <>
            <div className="messages-scroller"><div className="messages-flow">
              <div className="chat-start"><div className="chat-start-logo"><BrandMark size={66}/></div><h3>A new conversation unfolds.</h3><p>{selected.encrypted ? 'This room uses end-to-end encryption. Device verification and key recovery are not available in Origrami yet.' : 'This room is not encrypted. Sending messages is therefore blocked.'}</p></div>
              <details className="participants"><summary>Show conversation members</summary><ul>{selected.members.map((id) => <li key={id}>{id}</li>)}</ul></details>
              {messages.map((message) => <div key={message.id || `${message.sender}${message.time}`} className={`message-row ${message.sender === session.userId ? 'mine' : ''}`}><div className={`bubble ${message.pending ? 'pending' : ''} ${message.unencrypted ? 'unencrypted' : ''}`}>
                {message.unencrypted && <strong className="message-warning">Received without encryption · Readable by the server</strong>}
                <span>{message.message}</span><small>{simpleTime(message.time)} · {message.sender === session.userId ? 'You' : message.sender}{message.sendStatus && ` · ${message.sendStatus === 'not_sent' ? 'Not sent' : 'Sending …'}`}</small></div></div>)}
              <div ref={endRef}/>
            </div></div>
            <div className="composer-area">
              {error && <div role="alert" className="error-note composer-error">{error}<button className="dismiss-error" aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
              <form className="composer" onSubmit={send}><input aria-label="Message" placeholder={selected.encrypted ? 'Your message …' : 'Not encrypted'} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!selected.encrypted || sending || loggingOut} /><button type="submit" className="send-button" disabled={!draft.trim() || !selected.encrypted || sending || loggingOut} aria-label="Send message"><Send size={18}/></button></form>
              <p><LockKeyhole size={12}/> {selected.encrypted ? 'Encrypted · Device identities not yet verified' : 'Unencrypted room · Sending blocked'}</p>
            </div>
          </>}
        </>}
      </main>

      {creating && <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busyCreate) setCreating(false); }}>
        <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-chat-title" aria-busy={busyCreate}>
          <button className="modal-close icon-button" type="button" aria-label="Close" disabled={busyCreate} onClick={() => setCreating(false)}><X size={19}/></button>
          <div className="modal-symbol"><BrandMark size={58}/></div><div className="eyebrow">A NEW CONVERSATION</div>
          <h2 id="new-chat-title">{conversationType === 'group' ? 'Bring your people together.' : 'Reach out to someone.'}</h2>
          <fieldset className="conversation-type" disabled={busyCreate}>
            <legend>Conversation type</legend>
            <button type="button" aria-pressed={conversationType === 'direct'} onClick={() => { setConversationType('direct'); setCreateError(''); }}><MessageCircle size={16}/> Private chat</button>
            <button type="button" aria-pressed={conversationType === 'group'} onClick={() => { setConversationType('group'); setCreateError(''); }}><Users size={16}/> Group chat</button>
          </fieldset>
          <form onSubmit={create}>
            {conversationType === 'group' ? <>
              <label htmlFor="group-name">Group name</label>
              <input id="group-name" autoFocus maxLength={100} placeholder="e.g. Weekend plans" value={groupName} onChange={(e) => setGroupName(e.target.value)} disabled={busyCreate} required />
              <label htmlFor="group-recipients">Usernames or Matrix IDs</label>
              <textarea id="group-recipients" rows={3} placeholder={'bob, charlie\n@dana:localhost'} value={groupRecipients} onChange={(e) => setGroupRecipients(e.target.value)} aria-describedby="group-hint" disabled={busyCreate} required />
              <p id="group-hint" className="group-hint">Invite at least two other people. Separate names with commas, semicolons or new lines. You are included automatically. Invitees must join before receiving messages. The group name and membership are visible to the server.</p>
            </> : <>
              <p>Enter the username of someone on your local Matrix server.</p>
              <label htmlFor="recipient">Username or Matrix ID</label>
              <input id="recipient" autoFocus placeholder="e.g. bob" value={recipient} onChange={(e) => setRecipient(e.target.value)} disabled={busyCreate} required />
            </>}
            {createError && <div className="error-note" role="alert">{createError}</div>}
            <button disabled={busyCreate || loggingOut} className="primary-button" type="submit">{busyCreate ? 'Creating chat …' : conversationType === 'group' ? 'Create encrypted group' : 'Start private chat'} <ArrowRight size={17}/></button>
          </form>
        </div>
      </div>}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('origrami.theme.v2') === 'burgundy' ? 'burgundy' : 'noir'; }
    catch { return 'noir'; }
  });
  const [session, setSession] = useState(loadSession);
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [error, setError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('origrami.theme.v2', theme); } catch { /* Palette remains usable without storage. */ }
  }, [theme]);

  function clearLocalSession(message = '') {
    try { forgetSession(); } catch (e) { message = `${message} ${friendlyError(e)}`.trim(); }
    setClient(null); setSession(null); setLoading(false); setError(message);
  }

  useEffect(() => {
    if (!session) { setClient(null); setLoading(false); return; }
    let cancelled = false;
    let activeClient;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    startMatrix(session, {
      signal: controller.signal,
      onSessionLoggedOut: () => {
        if (cancelled) return;
        activeClient?.stopClient();
        clearLocalSession('Your server session has expired or been revoked. Please sign in again.');
      },
    }).then((c) => {
      activeClient = c;
      if (cancelled) { c.stopClient(); return; }
      setClient(c); setLoading(false); setError('');
    }).catch((e) => {
      if (cancelled) return;
      setError(friendlyError(e)); setLoading(false);
    });
    return () => { cancelled = true; controller.abort(); activeClient?.stopClient(); };
  }, [session?.accessToken, attempt]);

  async function signIn(username, password) {
    setLoading(true); setError('');
    try {
      const next = await loginMatrix(username, password);
      try { saveSession(next); }
      catch (storageError) {
        try { await endMatrixSession(next); }
        catch { throw new Error(`${friendlyError(storageError)} The new server session could not be revoked. Please sign out using device management.`); }
        throw storageError;
      }
      setSession(next);
    }
    catch (e) { setError(friendlyError(e)); setLoading(false); }
  }

  async function signOut() {
    if (loggingOut) return;
    setLoggingOut(true);
    try { await endMatrixSession(session, client); clearLocalSession(); }
    catch (e) { setError(`Signing out from the server failed: ${friendlyError(e)} Please try again.`); }
    finally { setLoggingOut(false); }
  }

  if (session && (loading || !client)) return <div className="splash"><BrandMark size={85}/><Brand/>{error ? <><p className="error-note" role="alert">{error}</p><button className="primary-button" onClick={() => setAttempt((value) => value + 1)}>Try again</button><button className="help-link" disabled={loggingOut} onClick={signOut}>Sign out from the server</button></> : <p>Unfolding your private space …</p>}</div>;
  if (session && client) return <>{error && <div className="session-error error-note" role="alert">{error}</div>}<ChatScreen client={client} session={session} onLogout={signOut} loggingOut={loggingOut} theme={theme} setTheme={setTheme}/></>;
  return <LoginScreen onLogin={signIn} busy={loading} error={error} theme={theme} setTheme={setTheme}/>;
}
