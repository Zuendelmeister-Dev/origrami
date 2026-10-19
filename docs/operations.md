# Operations guide

This guide describes the supplied local Compose deployment. It is not approval for public operation. See [architecture and goals](architecture.md) for the purpose and [the security model](../SECURITY.md) for protection boundaries.

## Requirements

- Docker with a running Linux engine and Docker Compose v2 or later. On Windows/macOS, Docker Desktop must be running in Linux-container mode.
- Available local ports `5173`, `8008` and `8090`; optional live development also uses `5174`.
- A terminal: PowerShell on Windows, or a normal Linux/macOS shell. The container setup requires no host OpenSSL installation.
- A current browser supporting WebAssembly, IndexedDB, session storage and Web Locks, using loopback or HTTPS as a secure context.
- Project files in a writable local directory, with disk space for images and persistent volumes.
- Network access for the first image downloads and package installation during the web image build.

Check `docker version`, `docker compose version` and `docker info --format '{{.OSType}}'`; the engine type must be `linux`. A source archive is sufficient to run the application; Git is only needed for cloning and source management.

Setup, builds, tests and live development use containers. No host Node.js, npm, Python, PostgreSQL, Nginx or OpenSSL installation is required. Build dependencies and generated files remain in Docker, rather than the project directory. See the [prerequisite overview](../README.md#prerequisites) and [container build guide](builds.md).

The Compose project is named `origrami`. Run commands from the project directory. A second installation on the same machine needs its own project name, volumes and host ports.

## Components and persistent data

| Service | Purpose | Persistent data |
|---|---|---|
| `web` | React client served by Nginx | No server-side database |
| `synapse` | Matrix accounts, rooms, events and media API | `synapse-config`, `synapse-media` |
| `postgres` | Account, event and metadata database | `postgres-data` |
| `synapse-init` | Generate and validate configuration | Updates configuration; exits after completion |
| `management` | Requests, roles, blocklist, audit and load metrics | `management-state`; read-only Synapse configuration |
| `management-init` | Set management volume permissions | One-time initialisation |
| `test-users` | Create missing local test accounts with the test overlay | Accounts stored through Synapse; exits after completion |

`synapse-config` contains server signing keys, database credentials and the registration secret. These are confidential operational data. During normal operation, the server does not hold participants' private message keys; those remain on their devices.

`management-state` contains roles, requests, the blocklist, permissions, audit entries and the private service credential. Include it in coordinated backups and restores. Alice is the default Origrami superuser, while Bob remains an ordinary user; neither is a native Matrix administrator. See [administration](administration.md).

Bootstrap preserves existing keys. It stops when it finds an existing non-PostgreSQL installation, mismatched database credentials or a different media path. Plan migrations explicitly: bootstrap does not copy existing data to a new database.

Published endpoints are bound to `127.0.0.1`: web on `5173`, Synapse on `8008`, and management on `8090` for the local Vite proxy. PostgreSQL has no host port. Synapse uses a client listener and an empty federation allowlist. Its API includes administrative endpoints authenticated by Synapse. Loopback is not a substitute for secure administration on a shared computer.

## New installation

**Purpose:** create a local test instance without deleting existing volumes.

Windows / PowerShell:

```powershell
docker compose -f compose.tools.yaml run --rm setup
docker compose -f compose.yaml -f compose.test.yaml config --quiet
docker compose -f compose.yaml -f compose.test.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.test.yaml ps
```

Linux/macOS:

```sh
docker compose -f compose.tools.yaml run --rm --user "$(id -u):$(id -g)" setup
docker compose -f compose.yaml -f compose.test.yaml config --quiet
docker compose -f compose.yaml -f compose.test.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.test.yaml ps
```

The setup container creates `.env` with a random PostgreSQL password if necessary. On Linux/macOS, `--user` preserves host ownership. Existing files are not overwritten. Do not commit or share `.env`. The setup container creates the file with restrictive POSIX permissions; on Windows, the project directory's permissions apply and should be restricted appropriately.

**Expected result:** PostgreSQL, Synapse and management are healthy, the one-time jobs have exited successfully, and [localhost:5173](http://localhost:5173) is available. The [Matrix versions endpoint](http://localhost:8008/_matrix/client/versions) returns JSON.

The `test-users` job waits for healthy Synapse and creates both accounts without native admin privileges. The web service waits for seeding and management. The overlay shares the base services and volumes; it is not a separate installation.

## Local test accounts

| Account | Test password | Matrix ID | Origrami role | Native Matrix admin |
|---|---|---|---|---|
| alice | alice | `@alice:localhost` | Superuser by default | No |
| bob | bob | `@bob:localhost` | User | No |

These passwords are for local testing only. Repeated seeding skips existing accounts and creates missing ones without changing passwords or permissions. Existing accounts retain their original credentials. Other errors stop seeding; rerun after resolving the cause.

Alternatively, use the base configuration without the overlay and seed manually after startup:

```powershell
.\scripts\seed-users.ps1
```

```sh
sh scripts/seed-users.sh
```

Direct public Matrix registration is disabled. The shared registration secret stays in administration and must never be sent to the browser or used as an ordinary invitation code: it can create native administrator accounts. Origrami offers a separate [request and approval workflow](administration.md#registration-and-decisions). Its limited admin dashboard does not replace every native Synapse administration tool.

See the [user guide](usage.md) for chat instructions and [superuser configuration](administration.md#configure-superusers) for owner accounts.

## Updates

**Purpose:** update the application and containers while preserving data.

1. Review changes, image versions and pending migrations.
2. Make a consistent backup and preserve existing browser profiles.
3. Validate and rebuild using the same configuration files as startup. The web client, management code and bootstrap code are packaged into images, so source updates take effect after an image rebuild:

```sh
docker compose -f compose.yaml -f compose.test.yaml config --quiet
docker compose -f compose.yaml -f compose.test.yaml up --build -d --wait
docker compose -f compose.yaml -f compose.test.yaml ps
docker compose -f compose.yaml -f compose.test.yaml logs --tail=100 synapse-init synapse management
```

For an installation without the test overlay, omit `-f compose.test.yaml` consistently from every command.

**Expected result:** services run the new version without deleted volumes. Version pinning does not replace regular review of security advisories.

### Sessions and key stores

Compared with the original implementation, version 0.1 explicitly binds saved sessions to a homeserver using session format `v2`. Old session references are not loaded automatically. Signing in again creates a new Matrix device and may make old messages unreadable even if old IndexedDB data remains.

The crypto store is separated by server, account and device. There is no automatic migration from the original shared store. **A complete key transfer or safe migration assistant is not available yet.** If history matters, preserve the old browser profile and client version and develop a verified transfer first. Signing in or copying server volumes does not perform this transfer.

Changing `VITE_MATRIX_URL`, the client origin (`localhost` versus `127.0.0.1`, port or domain), or the browser profile may select different session and key stores. Plan the consequences for existing devices before switching.

### Server configuration and credentials

Synapse is pinned to `v1.163.0` and Nginx to `1.30.6-alpine`. Other base images use version series; complete digest pinning is not implemented. Web packages are installed with `package-lock.json` and `npm ci`.

Initialisation also enforces the closed, non-federated configuration on existing installations. Review custom listener and federation settings before updating. A non-default media path is preserved and requires an explicit migration before startup can continue.

Changing `.env` alone does not rotate the password of an initialised PostgreSQL database. Update the database credentials, Synapse configuration and `.env` together during planned maintenance. Bootstrap stops on inconsistencies.

## Backups and recovery

**Back up:** PostgreSQL, `synapse-config`, `synapse-media`, `management-state`, and confidential operational parameters from `.env`. Do not copy live PostgreSQL data files without coordination. Database, configuration, media and management state must form a consistent set, for example through a maintenance window or a verified snapshot procedure.

**Restore:** first test in a separate installation with its own Compose project, volumes and ports. Verify accounts, room access, event history, media, roles and service credentials. Replace a live installation only after a successful restoration test. A fully automated backup/restore workflow is not supplied.

**Limit:** server backups do not restore private message keys held only on devices. Future encrypted key recovery is a separate product capability whose recovery secret should remain under user control.

## Shutdown

Use the same Compose files used to start the installation:

```sh
docker compose -f compose.yaml -f compose.test.yaml down
```

This preserves data volumes. **Do not add `-v` for routine shutdown.** With the current configuration, that would also delete management state.

## Troubleshooting

```sh
docker compose -f compose.yaml -f compose.test.yaml ps -a
docker compose -f compose.yaml -f compose.test.yaml logs --tail=100 synapse-init
docker compose -f compose.yaml -f compose.test.yaml logs --tail=100 postgres synapse management web
```

Inspect logs for tokens, personal information and secrets before sharing them.

| Symptom | Check or remedy |
|---|---|
| Docker unavailable | Start Docker Desktop and the Linux engine; check local access permissions. |
| Bootstrap reports a PostgreSQL conflict | Restore the original parameters or perform a coordinated password rotation. |
| Bootstrap reports a SQLite/media conflict | Back up and migrate deliberately. Do not replace existing data with an empty database or reset valuable data. |
| Browser reports a locked crypto store | Close other tabs using that session, then choose **Try again**. Preserve site data. |
| Browser does not support Web Locks | Use a compatible current browser in a secure context. Do not bypass the protection. |
| Session expired or revoked | Sign in again, considering the consequences of a new Matrix device. |
| Network error during sign-out | Restore connectivity and retry. The server session remains valid until revocation is confirmed. |
| Old messages cannot be decrypted | Check device and key history. Server resets, new passwords and signing in again do not recover missing keys. |
| User already exists | Use the existing account; seeding deliberately does not overwrite it. |
| `network … not found` when starting `test-users` | A stale container may refer to a removed network ID. Remove only that container with `docker compose -f compose.yaml -f compose.test.yaml rm --stop --force test-users`, then run `up -d --wait` with the same files. Do not delete volumes. Use both files for shutdown too. |

## Reset a disposable test installation

**Precondition:** all data in this local installation is deliberately disposable. Check backups and the affected Compose volumes first.

**Effect:** reset deletes accounts, rooms, messages, media, server keys and management state from volumes in the current configuration. It is not an update or recovery procedure.

Only for an intentionally disposable installation, remove its volumes and start again:

```sh
docker compose -f compose.yaml -f compose.test.yaml down -v --remove-orphans
docker compose -f compose.yaml -f compose.test.yaml up --build -d --wait
```

These commands have no interactive confirmation. Review the selected project and volumes before running them. Keep the existing `.env`; normal setup never overwrites it. All current data volumes, including management state, are removed. Old unreferenced volumes are not deleted automatically.

Old browser sessions no longer match the reset server. Clear the relevant site data only for that discarded test installation. This is unsuitable when device keys must be retained.

## Requirements for public operation

Choose a permanent Matrix server name before creating real accounts; `@alice:localhost` is not automatically migrated to another domain. HTTPS, trustworthy client distribution, device verification, recovery, protected administration and independent security review remain prerequisites. See the full [release criteria](../SECURITY.md#release-criteria).
