"""Generate a Synapse config for a new local PostgreSQL-backed installation.

For local development only. Existing non-PostgreSQL configurations require an
explicit migration; they are never replaced by a new, empty database.
"""
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile

import yaml

DATA = Path('/data')
CONFIG = DATA / 'homeserver.yaml'
SQLITE = DATA / 'homeserver.db'
MEDIA = DATA / 'media_store'


def database_settings():
    password = os.environ.get('ORIGRAMI_DB_PASSWORD')
    if not password or password == 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD':
        raise RuntimeError('Set a real ORIGRAMI_DB_PASSWORD in .env (see README).')
    return {
        'name': 'psycopg2',
        'args': {
            'user': 'synapse', 'password': password, 'database': 'synapse',
            'host': 'postgres', 'port': 5432, 'cp_min': 5, 'cp_max': 10,
        },
    }


def dump_config(config):
    # mkstemp uses exclusive creation with mode 0600, even with a public umask.
    # Keep it beside CONFIG so replacement is atomic on the same filesystem.
    fd, name = tempfile.mkstemp(prefix=f'.{CONFIG.name}.', suffix='.tmp', dir=CONFIG.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            os.fchmod(stream.fileno(), 0o600)
            yaml.safe_dump(config, stream, default_flow_style=False, sort_keys=False, allow_unicode=True)
        # Synapse Docker defaults to UID/GID 991; preserve the existing file owner.
        if CONFIG.exists():
            stat = CONFIG.stat()
            uid, gid = (stat.st_uid or 991), (stat.st_gid or 991)
        else:
            uid, gid = 991, 991
        os.chown(temp, uid, gid)
        temp.replace(CONFIG)
    finally:
        # Failed serialization or replacement must not leave secrets behind.
        temp.unlink(missing_ok=True)


def main():
    # Validate credentials before generating any persistent configuration.
    desired = database_settings()
    fresh = not CONFIG.exists()
    if fresh:
        print('[Origrami] Generating Synapse configuration and signing keys')
        subprocess.run([sys.executable, '/start.py', 'generate'], check=True)
    cfg = yaml.safe_load(CONFIG.read_text(encoding='utf-8'))
    old = cfg.get('database', {})
    engine = old.get('name', 'sqlite3')
    if engine != 'psycopg2':
        # An existing SQLite configuration can name any database file, including
        # an external path or a temporarily unavailable mount. Checking only the
        # default /data/homeserver.db would silently hide that installation.
        # Only the configuration generated during this run may be converted.
        if not fresh or (SQLITE.is_file() and SQLITE.stat().st_size > 0):
            print('''
[Origrami] STOP: An existing non-PostgreSQL installation was found.
Accounts and messages will NOT be deleted or silently replaced.
Back up the database, configuration and media, then perform an explicit migration.
Reset is intended only for deliberately disposable local test data.
''', file=sys.stderr)
            return 3
        cfg['database'] = desired
    else:
        saved = old.get('args', {})
        # Changing credentials behind an initialized Postgres cluster isn't safe.
        if any(saved.get(k) != v for k, v in desired['args'].items() if k in ('host','user','database','password')):
            print('[Origrami] PostgreSQL configuration does not match .env. Original left unchanged.', file=sys.stderr)
            return 4

    # Changing an existing media path without copying its content would make
    # uploaded files disappear. Require a deliberate migration instead.
    configured_media = cfg.get('media_store_path')
    if not fresh and configured_media is not None and Path(configured_media) != MEDIA:
        print('''
[Origrami] STOP: The existing media path differs from /data/media_store.
Configuration and media are unchanged. Back up the media before migrating
it explicitly to the intended volume; do not use a reset.
''', file=sys.stderr)
        return 5

    # The media volume must be writable by the Synapse image's runtime UID.
    MEDIA.mkdir(parents=True, exist_ok=True)
    os.chown(MEDIA, 991, 991)
    cfg['media_store_path'] = str(MEDIA)
    cfg['enable_registration'] = False
    # Closed installation: no inbound federation listener or outbound peers.
    cfg['federation_domain_whitelist'] = []
    cfg['listeners'] = [{
        'port': 8008, 'tls': False, 'type': 'http',
        'x_forwarded': False, 'bind_addresses': ['0.0.0.0'],
        'resources': [{'names': ['client'], 'compress': False}],
    }]
    cfg.setdefault('registration_shared_secret', secrets.token_hex(32))
    if fresh or engine != 'psycopg2' or cfg != yaml.safe_load(CONFIG.read_text(encoding='utf-8')):
        dump_config(cfg)
    print('[Origrami] Synapse configured for PostgreSQL; old credentials/keys remain intact.')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:
        print(f'[Origrami] Bootstrap failure: {e}', file=sys.stderr)
        sys.exit(1)
