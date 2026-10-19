"""Origrami management API. No room, message, media or impersonation endpoints.

Only this private service holds a native Synapse administration credential.
Human roles are checked here on every request against a live Matrix identity.
"""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sqlite3
import threading
import time
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlencode, urlsplit
from urllib.request import Request, urlopen


class APIError(Exception):
    def __init__(self, status, message, code=None):
        self.status, self.message, self.code = status, message, code


class Synapse:
    def __init__(self, base_url, shared_secret, service_password):
        self.base_url = base_url.rstrip('/')
        self.secret = shared_secret
        self.password = service_password
        self.token = None

    def call(self, method, path, body=None, token=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        request = Request(self.base_url + path, method=method, headers=headers,
                          data=None if body is None else json.dumps(body).encode())
        try:
            with urlopen(request, timeout=20) as response:
                return json.load(response)
        except HTTPError as error:
            try:
                code = json.load(error).get('errcode')
            except (ValueError, AttributeError):
                code = None
            # Never relay upstream bodies, tokens or diagnostic internals.
            raise APIError(error.code, 'The homeserver could not complete this operation.', code) from None
        except (URLError, TimeoutError):
            raise APIError(503, 'The homeserver is unavailable. Please try again.') from None

    def register(self, username, password, admin=False, display_name=None):
        path = '/_synapse/admin/v1/register'
        nonce = self.call('GET', path)['nonce']
        payload = '\0'.join((nonce, username, password, 'admin' if admin else 'notadmin'))
        mac = hmac.new(self.secret.encode(), payload.encode(), hashlib.sha1).hexdigest()
        return self.call('POST', path, {'nonce': nonce, 'username': username,
                                      'password': password, 'admin': admin, 'mac': mac,
                                      **({'displayname': display_name} if display_name else {})})

    def connect(self):
        try:
            self.register('origrami.management', self.password, admin=True)
        except APIError as error:
            if error.code != 'M_USER_IN_USE':
                raise
        self.token = self.call('POST', '/_matrix/client/v3/login', {
            'type': 'm.login.password',
            'identifier': {'type': 'm.id.user', 'user': 'origrami.management'},
            'password': self.password, 'device_id': 'ORIGRAMI_MANAGEMENT',
        })['access_token']

    def admin(self, method, path, body=None):
        try:
            return self.call(method, '/_synapse/admin' + path, body, self.token)
        except APIError as error:
            if error.status != 401:
                raise
            self.connect()
            return self.call(method, '/_synapse/admin' + path, body, self.token)


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


class Management:
    def __init__(self, database, matrix, superusers, server_name='localhost'):
        self.database = str(database)
        self.matrix = matrix
        self.superusers = frozenset(superusers)
        self.server_name = server_name
        self.service_id = '@origrami.management:' + server_name
        if not self.superusers or self.service_id in self.superusers:
            raise ValueError('Configure at least one human ORIGRAMI_SUPERUSERS account.')
        if any(not re.fullmatch(r'@[a-z0-9._=/-]+:' + re.escape(server_name), uid) for uid in self.superusers):
            raise ValueError('Superusers must be complete local Matrix IDs.')
        self.lock = threading.RLock()
        with self.db() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS roles (user_id TEXT PRIMARY KEY, role TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL,
                    display_name TEXT NOT NULL, claim_hash TEXT UNIQUE NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL,
                    decided_at INTEGER, decided_by TEXT);
                CREATE INDEX IF NOT EXISTS requests_status ON requests(status, id);
                CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests(username)
                    WHERE status IN ('pending', 'accepted');
                CREATE TABLE IF NOT EXISTS blocklist (username TEXT PRIMARY KEY, created_by TEXT, created_at INTEGER);
                CREATE TABLE IF NOT EXISTS audit (
                    id INTEGER PRIMARY KEY, actor TEXT, action TEXT, target TEXT, created_at INTEGER);
                CREATE TABLE IF NOT EXISTS rate_limits (source TEXT, created_at INTEGER);
                CREATE INDEX IF NOT EXISTS rate_limits_time ON rate_limits(created_at);
            ''')
            db.execute("INSERT OR IGNORE INTO settings VALUES ('admins_view_metrics', 'false')")
            db.execute("INSERT OR IGNORE INTO settings VALUES ('rate_salt', ?)", (secrets.token_hex(32),))

    @contextmanager
    def db(self):
        # Serialize policy decisions and mutations, including simultaneous bulk actions.
        with self.lock:
            connection = sqlite3.connect(self.database, timeout=30)
            connection.row_factory = sqlite3.Row
            try:
                with connection:
                    yield connection
            finally:
                connection.close()

    def role(self, db, user_id):
        if user_id in self.superusers:
            return 'superuser'
        row = db.execute('SELECT role FROM roles WHERE user_id=?', (user_id,)).fetchone()
        return row['role'] if row else 'user'

    def identity(self, token):
        if not token or len(token) > 8192:
            raise APIError(401, 'Please sign in.')
        user_id = self.matrix.call('GET', '/_matrix/client/v3/account/whoami', token=token)['user_id']
        if user_id == self.service_id or not user_id.endswith(':' + self.server_name):
            raise APIError(403, 'This account cannot use management.')
        return user_id

    def require(self, db, actor, superuser=False):
        role = self.role(db, actor)
        if role not in (('superuser',) if superuser else ('admin', 'superuser')):
            raise APIError(403, 'You do not have permission for this action.')
        return role

    def audit(self, db, actor, action, target):
        db.execute('INSERT INTO audit(actor,action,target,created_at) VALUES (?,?,?,?)',
                   (actor, action, str(target), int(time.time())))

    def metrics_allowed(self, db, actor):
        role = self.require(db, actor)
        return role == 'superuser' or db.execute(
            "SELECT value FROM settings WHERE key='admins_view_metrics'").fetchone()[0] == 'true'

    def username(self, value):
        if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', value):
            raise APIError(400, 'Use 1–64 lowercase letters, numbers, dots, hyphens or underscores; start with a letter or number.')
        if '@' + value + ':' + self.server_name in self.superusers or value == 'origrami.management':
            raise APIError(409, 'This username is reserved.')
        return value

    def public_registration(self, method, path, body, token, source):
        with self.db() as db:
            if method == 'POST' and path == '/api/registration':
                now = int(time.time())
                salt = db.execute("SELECT value FROM settings WHERE key='rate_salt'").fetchone()[0]
                source_hash = hmac.new(salt.encode(), source.encode(), hashlib.sha256).hexdigest()
                db.execute('DELETE FROM rate_limits WHERE created_at < ?', (now - 3600,))
                attempts = db.execute('SELECT COUNT(*) FROM rate_limits WHERE source=? AND created_at>?',
                                      (source_hash, now - 3600)).fetchone()[0]
                total = db.execute('SELECT COUNT(*) FROM rate_limits WHERE created_at>?', (now - 3600,)).fetchone()[0]
                if attempts >= 10 or total >= 1000:
                    raise APIError(429, 'Too many registration requests. Please try again later.')
                # Commit the attempt before validation; malformed/bot attempts count too.
                db.execute('INSERT INTO rate_limits VALUES (?,?)', (source_hash, now))
                db.commit()
                username = self.username(body.get('username'))
                name = body.get('display_name', '').strip() if isinstance(body.get('display_name', ''), str) else ''
                if not name or len(name) > 100:
                    raise APIError(400, 'Enter a display name of up to 100 characters.')
                if db.execute('SELECT 1 FROM blocklist WHERE username=?', (username,)).fetchone():
                    raise APIError(403, 'Registration is unavailable for this username.')
                if db.execute("SELECT COUNT(*) FROM requests WHERE status='pending'").fetchone()[0] >= 10000:
                    raise APIError(429, 'The review queue is full. Please try again later.')
                try:
                    self.matrix.admin('GET', '/v2/users/' + quote('@' + username + ':' + self.server_name, safe=''))
                except APIError as error:
                    if error.status != 404:
                        raise
                else:
                    raise APIError(409, 'This username already belongs to an account.')
                claim = secrets.token_urlsafe(32)
                try:
                    cursor = db.execute('INSERT INTO requests(username,display_name,claim_hash,created_at) VALUES (?,?,?,?)',
                                        (username, name, digest(claim), now))
                except sqlite3.IntegrityError:
                    raise APIError(409, 'An open request already exists for this username.') from None
                return {'request_id': cursor.lastrowid, 'claim_token': claim, 'status': 'pending'}
            if not token or len(token) > 200:
                raise APIError(401, 'The request receipt is missing or invalid.')
            request = db.execute('SELECT * FROM requests WHERE claim_hash=?', (digest(token),)).fetchone()
            if request is None:
                raise APIError(404, 'Registration request not found.')
            if method == 'GET' and path == '/api/registration':
                return {key: request[key] for key in ('id', 'username', 'display_name', 'status')}
            if method == 'POST' and path == '/api/registration/activate':
                self.username(request['username'])
                if request['status'] != 'accepted':
                    raise APIError(409, 'This request is not approved for activation.')
                if db.execute('SELECT 1 FROM blocklist WHERE username=?', (request['username'],)).fetchone():
                    raise APIError(403, 'Registration is blocked for this username.')
                password = body.get('password')
                if not isinstance(password, str) or not 12 <= len(password) <= 256:
                    raise APIError(400, 'Choose a password of 12–256 characters.')
                # Registration refuses existing accounts. Never use a create-or-update
                # API here: a pending request must not take over an existing identity.
                result = self.matrix.register(request['username'], password, display_name=request['display_name'])
                db.execute("UPDATE requests SET status='activated' WHERE id=?", (request['id'],))
                self.audit(db, '@' + request['username'] + ':' + self.server_name, 'activate', request['id'])
                # The account now exists even if logout or the connection fails.
                # Persist activation before any optional follow-up network call.
                db.commit()
                # Shared-secret registration may return a login token. Revoke it;
                # the applicant signs in normally and creates their own crypto device.
                if result.get('access_token'):
                    try:
                        self.matrix.call('POST', '/_matrix/client/v3/logout', {}, result['access_token'])
                    except APIError:
                        self.audit(db, self.service_id, 'registration_logout_failed', request['id'])
                return {'status': 'activated', 'username': request['username']}
        raise APIError(404, 'Endpoint not found.')

    def handle(self, method, path, query, body, token, source='local'):
        if path in ('/api/registration', '/api/registration/activate'):
            return self.public_registration(method, path, body, token, source)
        actor = self.identity(token)
        with self.db() as db:
            if method == 'GET' and path == '/api/me':
                role = self.role(db, actor)
                return {'user_id': actor, 'role': role,
                        'can_view_metrics': role != 'user' and self.metrics_allowed(db, actor)}
            role = self.require(db, actor)
            q = str(query.get('q', [''])[0])[:100]
            if method == 'GET' and path == '/api/admin/overview':
                counts = dict(db.execute('SELECT status,COUNT(*) FROM requests GROUP BY status').fetchall())
                users = self.matrix.admin('GET', '/v2/users?' + urlencode({'limit': 1, 'deactivated': 'true'}))
                return {'requests': sum(counts.values()), 'pending': counts.get('pending', 0),
                        'accepted': counts.get('accepted', 0) + counts.get('activated', 0),
                        'rejected': counts.get('rejected', 0),
                        'users': max(0, users['total'] - 1),
                        'blocked': db.execute('SELECT COUNT(*) FROM blocklist').fetchone()[0],
                        'admins_view_metrics': db.execute("SELECT value FROM settings WHERE key='admins_view_metrics'").fetchone()[0] == 'true'}
            if method == 'GET' and path == '/api/admin/metrics':
                if not self.metrics_allowed(db, actor):
                    raise APIError(403, 'Only the superuser can view server load unless access is granted.')
                return system_metrics(Path(self.database).parent)
            if method == 'POST' and path == '/api/admin/settings':
                self.require(db, actor, superuser=True)
                allowed = body.get('admins_view_metrics')
                if not isinstance(allowed, bool):
                    raise APIError(400, 'A checkbox value is required.')
                db.execute("UPDATE settings SET value=? WHERE key='admins_view_metrics'", (json.dumps(allowed),))
                self.audit(db, actor, 'metrics_permission', allowed)
                return {'ok': True}
            if path == '/api/admin/requests' and method == 'GET':
                status = query.get('status', ['pending'])[0]
                if status not in ('pending', 'accepted', 'rejected', 'activated'):
                    raise APIError(400, 'Invalid request status.')
                offset = page_offset(query)
                where, args = request_filter(q, status)
                rows = db.execute('SELECT id,username,display_name,status,created_at,decided_at,decided_by FROM requests WHERE ' + where + ' ORDER BY id DESC LIMIT 50 OFFSET ?', (*args, offset)).fetchall()
                total, cutoff = db.execute('SELECT COUNT(*),COALESCE(MAX(id),0) FROM requests WHERE ' + where, args).fetchone()
                return {'items': [dict(row) for row in rows], 'total': total, 'cutoff': cutoff}
            if path == '/api/admin/requests/decide' and method == 'POST':
                decision = body.get('decision')
                if decision not in ('accepted', 'rejected'):
                    raise APIError(400, 'Choose accept or reject.')
                if body.get('all') is True:
                    cutoff = body.get('cutoff')
                    if type(cutoff) is not int or cutoff < 0:
                        raise APIError(400, 'Refresh the request list before a bulk decision.')
                    where, args = request_filter(str(body.get('q', ''))[:100], 'pending')
                    where += ' AND id<=?'
                    args += (cutoff,)
                else:
                    ids = body.get('ids')
                    if not isinstance(ids, list) or not 1 <= len(ids) <= 500 or any(type(i) is not int or i < 1 for i in ids):
                        raise APIError(400, 'Select between 1 and 500 requests.')
                    where = "status='pending' AND id IN (" + ','.join('?' for _ in ids) + ')'
                    args = tuple(ids)
                if decision == 'accepted':
                    where += ' AND username NOT IN (SELECT username FROM blocklist)'
                cursor = db.execute('UPDATE requests SET status=?,decided_by=?,decided_at=? WHERE ' + where,
                                    (decision, actor, int(time.time()), *args))
                self.audit(db, actor, 'requests_' + decision, cursor.rowcount)
                return {'changed': cursor.rowcount}
            if path == '/api/admin/users' and method == 'GET':
                params = {'limit': 50, 'from': page_offset(query), 'name': q, 'deactivated': 'true'}
                result = self.matrix.admin('GET', '/v2/users?' + urlencode(params))
                items = []
                for user in result['users']:
                    if user['name'] == self.service_id:
                        continue
                    # Explicit allowlist: no emails, devices, access tokens or media.
                    items.append({'user_id': user['name'], 'display_name': user.get('displayname') or '',
                                  'deactivated': bool(user.get('deactivated')),
                                  'role': self.role(db, user['name']), 'native_admin': bool(user.get('admin'))})
                return {'items': items, 'next': result.get('next_token'), 'total': result['total']}
            if path == '/api/admin/users/action' and method == 'POST':
                target, action = body.get('user_id'), body.get('action')
                if not isinstance(target, str) or not re.fullmatch(r'@[^:]+:' + re.escape(self.server_name), target):
                    raise APIError(400, 'Select a local user.')
                if target in self.superusers or target == self.service_id or target == actor:
                    raise APIError(403, 'This account is protected.')
                target_role = self.role(db, target)
                if target_role == 'admin' and role != 'superuser':
                    raise APIError(403, 'Only a superuser can manage administrators.')
                user = self.matrix.admin('GET', '/v2/users/' + quote(target, safe=''))
                if user.get('admin'):
                    raise APIError(403, 'Native Matrix administrators must be managed outside Origrami.')
                if action == 'promote':
                    if user.get('deactivated'):
                        raise APIError(409, 'A deactivated account cannot become an administrator.')
                    db.execute("INSERT INTO roles VALUES (?, 'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin'", (target,))
                elif action == 'demote':
                    self.require(db, actor, superuser=True)
                    db.execute('DELETE FROM roles WHERE user_id=?', (target,))
                elif action == 'deactivate':
                    self.matrix.admin('POST', '/v1/deactivate/' + quote(target, safe=''), {'erase': False})
                    db.execute('DELETE FROM roles WHERE user_id=?', (target,))
                else:
                    raise APIError(400, 'Unknown user action.')
                self.audit(db, actor, action, target)
                return {'ok': True}
            if path == '/api/admin/blocklist':
                if method == 'GET':
                    rows = db.execute('SELECT * FROM blocklist WHERE instr(username,?)>0 ORDER BY username LIMIT 50 OFFSET ?', (q, page_offset(query))).fetchall()
                    total = db.execute('SELECT COUNT(*) FROM blocklist WHERE instr(username,?)>0', (q,)).fetchone()[0]
                    return {'items': [dict(row) for row in rows], 'total': total}
                if method in ('POST', 'DELETE'):
                    username = self.username(body.get('username'))
                    target = '@' + username + ':' + self.server_name
                    if target == actor or self.role(db, target) != 'user':
                        raise APIError(403, 'Privileged accounts cannot be added to the blocklist.')
                    if method == 'POST':
                        db.execute('INSERT OR IGNORE INTO blocklist VALUES (?,?,?)', (username, actor, int(time.time())))
                        db.execute("UPDATE requests SET status='rejected', decided_by=?, decided_at=? WHERE username=? AND status IN ('pending','accepted')", (actor, int(time.time()), username))
                    else:
                        db.execute('DELETE FROM blocklist WHERE username=?', (username,))
                    self.audit(db, actor, 'block' if method == 'POST' else 'unblock', username)
                    return {'ok': True}
            if path == '/api/admin/audit' and method == 'GET':
                return {'items': [dict(row) for row in db.execute('SELECT * FROM audit ORDER BY id DESC LIMIT 100')]}
        raise APIError(404, 'Endpoint not found.')


def page_offset(query):
    try:
        value = int(query.get('offset', ['0'])[0])
        if not 0 <= value <= 10_000_000:
            raise ValueError()
        return value
    except (TypeError, ValueError):
        raise APIError(400, 'Invalid page offset.') from None


def request_filter(q, status):
    return 'status=? AND (instr(username,?)>0 OR instr(lower(display_name),lower(?))>0)', (status, q, q)


def system_metrics(path):
    def cpu():
        values = list(map(int, Path('/proc/stat').read_text().splitlines()[0].split()[1:9]))
        return sum(values), values[3] + values[4]
    result = {'scope': 'Docker Linux environment', 'disk_scope': 'Management volume filesystem',
              'sampled_at': int(time.time()), 'cpu_percent': None, 'memory': None, 'disk': None}
    try:
        first, idle_first = cpu()
        time.sleep(0.15)
        last, idle_last = cpu()
        if last > first:
            result['cpu_percent'] = round(max(0, min(100, 100 * (1 - (idle_last - idle_first) / (last - first)))), 1)
        memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if ':' in line}
        result['memory'] = {'total': memory['MemTotal'], 'used': memory['MemTotal'] - memory['MemAvailable']}
    except (OSError, ValueError, KeyError, IndexError):
        pass
    try:
        disk = shutil.disk_usage(path)
        result['disk'] = {'total': disk.total, 'used': disk.used, 'free': disk.free}
    except OSError:
        pass
    return result


class Handler(BaseHTTPRequestHandler):
    server_version = 'Origrami'

    def log_message(self, *_):
        # Never write query strings, receipts or bearer credentials to logs.
        pass

    def do_GET(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def dispatch(self):
        try:
            url = urlsplit(self.path)
            if url.path == '/health' and self.command == 'GET':
                return self.respond(200, {'ok': True})
            if self.command != 'GET':
                origin = self.headers.get('Origin')
                if origin and origin not in self.server.allowed_origins:
                    raise APIError(403, 'This origin is not allowed.')
                if self.headers.get_content_type() != 'application/json':
                    raise APIError(415, 'Send JSON content.')
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 <= length <= 32768:
                raise APIError(413, 'Request too large.')
            body = json.loads(self.rfile.read(length)) if length else {}
            if not isinstance(body, dict):
                raise APIError(400, 'Send a JSON object.')
            authorization = self.headers.get('Authorization', '')
            token = authorization[7:] if authorization.startswith('Bearer ') else ''
            # The service is private; only Nginx/Vite proxies reach it. Nginx
            # overwrites this header instead of trusting client-supplied values.
            source = self.headers.get('X-Real-IP') or self.client_address[0]
            data = self.server.app.handle(self.command, url.path, parse_qs(url.query), body, token, source)
            self.respond(200, data)
        except APIError as error:
            self.respond(error.status, {'error': error.message})
        except (ValueError, TypeError):
            self.respond(400, {'error': 'Invalid request.'})
        except Exception:
            self.respond(503, {'error': 'Management is unavailable. Please try again.'})

    def respond(self, status, data):
        encoded = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main():
    import yaml  # Supplied by the pinned Synapse runtime image.
    os.umask(0o077)
    state = Path(os.environ.get('ORIGRAMI_STATE', '/state'))
    state.mkdir(parents=True, exist_ok=True)
    config = yaml.safe_load(Path('/data/homeserver.yaml').read_text())
    credential = state / 'service-password'
    if not credential.exists():
        with credential.open('x') as stream:
            stream.write(secrets.token_urlsafe(48))
    matrix = Synapse(os.environ.get('SYNAPSE_URL', 'http://synapse:8008'),
                     config['registration_shared_secret'], credential.read_text().strip())
    matrix.connect()
    superusers = os.environ.get('ORIGRAMI_SUPERUSERS', '').split(',')
    app = Management(state / 'management.sqlite3', matrix, [uid.strip() for uid in superusers if uid.strip()], config['server_name'])
    server = ThreadingHTTPServer(('0.0.0.0', 8090), Handler)
    server.app = app
    server.allowed_origins = set(os.environ.get('ORIGRAMI_ALLOWED_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(','))
    server.serve_forever()


if __name__ == '__main__':
    main()
