import { useEffect, useState } from 'react';
import { ArrowLeft, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { managementRequest } from './management-api.js';

const bytes = value => value == null ? 'Unavailable' : `${(value / 1024 ** 3).toFixed(1)} GB`;
const date = value => new Date(value * 1000).toLocaleString('en-GB');

function Meter({ title, value, detail }) {
  return <article className="load-card"><span>{title}</span><strong>{value == null ? 'Unavailable' : `${value.toFixed(1)}%`}</strong><progress max="100" value={value ?? 0} aria-label={title} /><small>{detail}</small></article>;
}

export default function AdminPanel({ session, onClose }) {
  const [identity, setIdentity] = useState(null);
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState('requests');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [selected, setSelected] = useState([]);
  const [blockName, setBlockName] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const api = (path, options = {}) => managementRequest(path, { ...options, token: session.accessToken });

  useEffect(() => {
    const controller = new AbortController();
    const options = { signal: controller.signal };
    let refreshing = false;
    async function load() {
      if (refreshing) return;
      refreshing = true;
      try {
        const me = await api('/me', options);
        if (controller.signal.aborted) return;
        setIdentity(me);
        if (me.role === 'user') { setData(null); setMetrics(null); setOverview(null); throw new Error('Your management access has been removed. You can still return to your chats.'); }
        const [summary, listing] = await Promise.all([
          api('/admin/overview', options),
          api(`/admin/${tab}?${new URLSearchParams({ q, status, offset: String(offset) })}`, options),
        ]);
        if (controller.signal.aborted) return;
        setOverview(summary); setData(listing); setError('');
        if (me.can_view_metrics) {
          try { const next = await api('/admin/metrics', options); if (!controller.signal.aborted) setMetrics(next); }
          catch { if (!controller.signal.aborted) setMetrics(null); }
        } else setMetrics(null);
      } catch (e) { if (!controller.signal.aborted) { setError(e.message); setMetrics(null); setData(null); } }
      finally { refreshing = false; if (!controller.signal.aborted) setLoading(false); }
    }
    setLoading(true); setData(null); setSelected([]);
    void load();
    const timer = setInterval(() => { void load(); }, 15000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [session.accessToken, tab, q, status, offset, revision]);

  async function mutate(path, body, message, method = 'POST') {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(path, { method, body });
      setNotice(typeof result.changed === 'number' ? `${result.changed} request(s) updated.` : message);
      setRevision(previous => previous + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  function decide(decision, ids, all = false) {
    const count = all ? data?.total : ids.length;
    if (!count || !window.confirm(`${decision === 'accepted' ? 'Accept' : 'Reject'} ${count} ${all ? 'matching pending' : 'selected'} request(s)? New requests arriving after this list was loaded are excluded.`)) return;
    void mutate('/admin/requests/decide', { decision, ids, all, q, cutoff: data.cutoff });
  }

  function userAction(user, action) {
    const description = action === 'deactivate' ? 'Deactivate this account, revoke its sessions and remove it from rooms? Its password will be removed; this is not a temporary kick.' : action === 'promote' ? 'Grant this user Origrami administrator rights?' : 'Remove this user’s Origrami administrator rights?';
    if (window.confirm(`${description}\n\n${user.user_id}`)) void mutate('/admin/users/action', { user_id: user.user_id, action }, 'User updated.');
  }

  function switchTab(next) { setTab(next); setQ(''); setSearch(''); setOffset(0); setNotice(''); }
  const superuser = identity?.role === 'superuser';
  const canManage = identity && identity.role !== 'user';
  const showPager = tab !== 'audit' && data;

  return <main className="admin-shell">
    <header className="admin-header"><button type="button" className="help-link" onClick={onClose}><ArrowLeft size={16} /> Back to chats</button><span className="role-badge"><ShieldCheck size={16} /> {superuser ? 'SUPERUSER' : 'ADMINISTRATION'}</span></header>
    <div className="admin-content">
      <div className="admin-title"><div><div className="eyebrow">ORIGRAMI · SERVER MANAGEMENT</div><h1>A clear view. A private space.</h1><p>Manage access and accounts. Private conversations and media have no place in this dashboard.</p></div><button type="button" className="admin-button" disabled={loading || busy} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} /> Refresh</button></div>
      {error && <div className="error-note" role="alert">{error}</div>}
      {notice && <div className="admin-notice" role="status">{notice}</div>}
      {overview && canManage && <section className="admin-stats" aria-label="Server overview">{[
        ['Users', overview.users], ['All requests', overview.requests], ['Pending', overview.pending],
        ['Accepted', overview.accepted], ['Rejected', overview.rejected], ['Blocked names', overview.blocked],
      ].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>}
      {canManage && <section className="admin-load" aria-labelledby="server-load-title">
        <div className="admin-section-heading"><h2 id="server-load-title">Server load</h2>{superuser && overview && <label className="metrics-permission"><input type="checkbox" checked={overview.admins_view_metrics} disabled={busy || loading} onChange={event => { void mutate('/admin/settings', { admins_view_metrics: event.target.checked }, 'Server-load permission updated.'); }} /> Allow administrators to view server load</label>}</div>
        {identity.can_view_metrics ? metrics ? <><div className="load-grid">
          <Meter title="CPU" value={metrics.cpu_percent} detail={metrics.scope} />
          <Meter title="Memory" value={metrics.memory ? metrics.memory.used / metrics.memory.total * 100 : null} detail={metrics.memory ? `${bytes(metrics.memory.used)} / ${bytes(metrics.memory.total)}` : metrics.scope} />
          <Meter title="Disk" value={metrics.disk ? metrics.disk.used / metrics.disk.total * 100 : null} detail={metrics.disk ? `${bytes(metrics.disk.free)} free of ${bytes(metrics.disk.total)}` : 'Unavailable'} />
        </div><p className="admin-caption">CPU and memory: {metrics.scope}. Disk: {metrics.disk_scope}. Updated {date(metrics.sampled_at)}. Refreshes every 15 seconds.</p></> : <p className="admin-caption">Load measurements are currently unavailable.</p> : <p className="admin-caption">Server load is private to the superuser. They can grant administrators access above.</p>}
      </section>}
      {canManage && <section className="admin-workspace">
        <nav className="admin-tabs" aria-label="Management sections">{[['requests', 'Registration requests'], ['users', 'Users & roles'], ['blocklist', 'Blocklist'], ['audit', 'Activity']].map(([key, label]) => <button key={key} type="button" disabled={busy} aria-current={tab === key ? 'page' : undefined} onClick={() => switchTab(key)}>{label}</button>)}</nav>
        {tab !== 'audit' && <form className="admin-toolbar" onSubmit={event => { event.preventDefault(); setQ(search.trim()); setOffset(0); }}>
          <label className="admin-search"><Search size={16} /><input aria-label="Search usernames or names" placeholder={tab === 'blocklist' ? 'Search blocked usernames …' : 'Search usernames or names …'} value={search} onChange={event => setSearch(event.target.value)} /></label><button className="admin-button" disabled={busy} type="submit">Search</button>
          {tab === 'requests' && <select aria-label="Request status" value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setOffset(0); }}>{['pending', 'accepted', 'rejected', 'activated'].map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}</select>}
        </form>}
        {tab === 'requests' && status === 'pending' && <div className="admin-bulk"><span>{selected.length} selected · {data?.total ?? '…'} matching{q && ` “${q}”`}</span><button type="button" className="admin-button" disabled={busy || !selected.length} onClick={() => decide('accepted', selected)}>Accept selected</button><button type="button" className="admin-button danger" disabled={busy || !selected.length} onClick={() => decide('rejected', selected)}>Reject selected</button><button type="button" className="admin-button" disabled={busy || loading || !data?.total} onClick={() => decide('accepted', [], true)}>Accept all matching</button><button type="button" className="admin-button danger" disabled={busy || loading || !data?.total} onClick={() => decide('rejected', [], true)}>Reject all matching</button></div>}
        {tab === 'blocklist' && <form className="admin-toolbar" onSubmit={event => { event.preventDefault(); if (window.confirm(`Block registration for “${blockName}” and reject its open requests? Existing accounts are not deactivated.`)) { void mutate('/admin/blocklist', { username: blockName.trim() }, 'Username blocked.'); setBlockName(''); } }}><input aria-label="Username to block" placeholder="Exact local username" required maxLength={64} value={blockName} onChange={event => setBlockName(event.target.value)} /><button type="submit" className="admin-button danger" disabled={busy}>Block username</button></form>}
        {tab === 'blocklist' && <p className="admin-caption">Exact usernames, not message filters. Blocking rejects open requests and prevents account activation. Deactivate an existing account separately to revoke access.</p>}
        {tab === 'users' && <p className="admin-caption">Admins may promote users and deactivate ordinary accounts. Only superusers can demote or deactivate admins. Superusers are protected and configured by the server operator.</p>}
        {loading && <p className="admin-caption" role="status">Loading …</p>}
        {data?.items?.length === 0 && <p className="admin-empty">Nothing here yet{q ? ` matching “${q}”` : ''}.</p>}
        {!!data?.items?.length && <div className="admin-table-wrap"><table className="admin-table">
          <thead><tr>{(tab === 'requests' ? ['Select', 'Person', 'Status', 'Requested', 'Actions'] : tab === 'users' ? ['Person', 'Role', 'Account', 'Actions'] : tab === 'blocklist' ? ['Username', 'Blocked by', 'Added', 'Actions'] : ['When', 'Actor', 'Action', 'Target']).map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{data.items.map(row => tab === 'requests' ? <tr key={row.id}>
            <td>{row.status === 'pending' && <input type="checkbox" aria-label={`Select ${row.username}`} disabled={busy} checked={selected.includes(row.id)} onChange={event => setSelected(previous => event.target.checked ? [...previous, row.id] : previous.filter(id => id !== row.id))} />}</td>
            <td><strong>{row.display_name}</strong><small>{row.username} · #{row.id}</small></td><td><span className={`status-badge ${row.status}`}>{row.status}</span></td><td>{date(row.created_at)}</td><td>{row.status === 'pending' && <div className="row-actions"><button type="button" className="admin-button" disabled={busy} onClick={() => decide('accepted', [row.id])}>Accept</button><button type="button" className="admin-button danger" disabled={busy} onClick={() => decide('rejected', [row.id])}>Reject</button></div>}</td>
          </tr> : tab === 'users' ? <tr key={row.user_id}>
            <td><strong>{row.display_name || row.user_id}</strong><small>{row.user_id}</small></td><td><span className="role-badge">{row.native_admin ? 'Native Matrix admin' : row.role}</span></td><td>{row.deactivated ? 'Deactivated' : 'Active'}</td><td>{row.role === 'superuser' || row.native_admin || row.user_id === session.userId ? <span className="admin-caption">Protected</span> : <div className="row-actions">
              {!row.deactivated && row.role === 'user' && <button type="button" className="admin-button" disabled={busy} onClick={() => userAction(row, 'promote')}>Make admin</button>}
              {superuser && row.role === 'admin' && <button type="button" className="admin-button" disabled={busy} onClick={() => userAction(row, 'demote')}>Remove admin</button>}
              {!row.deactivated && (superuser || row.role === 'user') && <button type="button" className="admin-button danger" disabled={busy} onClick={() => userAction(row, 'deactivate')}>Deactivate</button>}
            </div>}</td>
          </tr> : tab === 'blocklist' ? <tr key={row.username}><td><strong>{row.username}</strong></td><td>{row.created_by}</td><td>{date(row.created_at)}</td><td><button type="button" className="admin-button" disabled={busy} onClick={() => { void mutate('/admin/blocklist', { username: row.username }, 'Username unblocked.', 'DELETE'); }}>Unblock</button></td></tr> : <tr key={row.id}><td>{date(row.created_at)}</td><td>{row.actor}</td><td>{row.action.replaceAll('_', ' ')}</td><td>{row.target}</td></tr>)}</tbody>
        </table></div>}
        {showPager && <div className="admin-pagination"><button type="button" className="admin-button" disabled={busy || loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>Page {Math.floor(offset / 50) + 1}{tab !== 'users' && ` · ${data.total} results`}</span><button type="button" className="admin-button" disabled={busy || loading || (tab === 'users' ? !data.next : offset + 50 >= data.total)} onClick={() => setOffset(tab === 'users' ? Number(data.next) : offset + 50)}>Next</button></div>}
      </section>}
    </div>
  </main>;
}
