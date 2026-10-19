# Verification report

This report records the scope, results and limitations of project checks. Historical results are not a current security certification.

## Container workflow — 2026-10-19

- Built the dedicated web build/test, management test and bootstrap test targets successfully.
- All 51 existing tests passed inside the new disposable containers: 21 web, 16 management and 14 bootstrap tests.
- Verified setup on a temporary container filesystem: a new credential is generated with mode 0600 and an existing file is preserved. Running the Compose setup against existing local configuration also preserved it.
- Started the packaged web, management and bootstrap runtime images in a separate instance with disposable volumes and different host ports. Healthchecks and Nginx configuration passed; the live registration/roles check passed again.
- Verified the containerised development page, transformed source, internal management proxy and source-watcher updates. Source mounts are read-only; Vite cache remains in the container.
- Confirmed that the host project contains no `web/node_modules` or `web/dist` directories after builds, tests and live development.

The checks used a separate test project and did not reset or replace the existing application installation. Images and build cache still require Docker-managed disk space. Large Matrix SDK/WASM bundles remain a known build warning.

## Documentation checks — 2026-10-19

Validation found 70 valid local file/image references, including heading anchors. All 14 existing bootstrap tests passed again in an isolated, read-only Synapse container without access to application data. No application deployment or data reset was needed for these checks.

## Management features — 2026-10-19

This implementation added a roles/admission backend, account-request interface and admin/superuser dashboard. Direct Matrix registration remains closed; Origrami approval is a separate workflow.

| Check | Result and limitation |
|---|---|
| Existing web tests | 21 passed |
| Backend tests (`python -B -m unittest discover -s management -v`) | 16 passed: roles, superuser/system-account protection, immediate demotion, load permissions, metadata allowlist, absent content endpoints, search/bulk decisions, blocklist, throttling, persistence and safe activation |
| Production build in Docker | Passed with 1,900 transformed modules; large SDK/WASM artifacts remain a known build warning |
| Nginx (`nginx -t`) | Passed with the API proxy |
| Compose | Base/test combination validated; Synapse, PostgreSQL, seeding and management started in the separate `origrami-admin-check` project |
| Live check against Synapse | Request, search, approval, activation and display name verified; promotion without native Matrix admin access; superuser protection; metrics grant/revocation; demotion; deactivation with token revocation; blocklist |
| Browser with the built image | Alice sign-in, superuser indicator, actual metrics, protected account actions, submitting a request, name search and returning to connected chat checked |

Live checks used newly created test volumes and disposable accounts only. A [dashboard preview](../brand/origrami-admin-preview.png) was saved. Local Windows Vite builds stalled during transformation and were stopped; the full Linux Docker build succeeded. Backend unit tests require no additional local Python packages.

Still outstanding: independent security review, public TLS operation, larger bot/load scenarios, coordinated management/Synapse restoration, complete mobile testing and previously documented E2EE/multi-device limitations. CPU/memory describe the Docker Linux environment; disk describes the management filesystem. API role tests do not protect against infrastructure operators or native Matrix administrator credentials. See [administration](administration.md).

## Follow-up review — 2026-10-19

The web client, server bootstrap and helper scripts were reviewed again. `compose.test.yaml` adds a one-time `test-users` service that creates `alice/alice` and `bob/bob` without native administrator privileges after a healthy Synapse check. The web client waits for successful seeding. Existing accounts remain unchanged; missing accounts are created even when the other test account exists. Manual seed scripts also use `--exists-ok`.

| Check | Recorded result and limitation |
|---|---|
| Web tests (`node --test src/*.test.js`, equivalent to `npm test`) | 21 passed, no failures |
| Base Compose and test combination (`config --quiet`) | Passed with a temporary validation password; no `.env` created |
| Resolved configuration | Healthcheck dependencies, seeding dependency, read-only configuration volume and test accounts checked |
| PowerShell scripts | All three parsed without errors |
| Web build during this phase | Stopped during transformation without further output; no successful new build established in this phase |
| Container startup, real registration and repeated seeding | Not performed in this phase: Docker Desktop/Linux engine unavailable |
| Bootstrap tests | Not repeated in this phase: Docker unavailable and local PyYAML missing |

Support for `--exists-ok` and preservation of existing accounts were checked in the [official source for the pinned Synapse version](https://github.com/element-hq/synapse/blob/v1.163.0/synapse/_scripts/register_new_matrix_user.py). Container execution and the complete encrypted exchange were still outstanding at that point; later results are recorded separately. Existing server data was not changed.

## Earlier review — 2026-10-18

| Item | Recorded scope |
|---|---|
| Date | 2026-10-18 |
| Subject | Implementation after another code/documentation review, subsequently recorded as Origrami 0.1 |
| Environment | Windows/PowerShell, Node.js 24, npm 11, Docker Desktop with a Linux engine |
| Release decision | Local development prototype; no public or security-critical approval |

The review covered the web client, SDK integration, bootstrap, Compose, scripts and documentation. The supplied source directory had no Git repository or commit ID. Findings apply to that working state and are neither certification nor an independent penetration test.

Recording version 0.1 did not repeat the earlier checks. Subsequent observations are documented in the [manual test log](manual-tests.md).

### Results

| Check | Result | Limitation |
|---|---|---|
| `npm test` | 20 passed in this earlier phase | Unit/regression tests, not complete cryptographic or multi-device verification |
| `npm run build` | Passed | Large SDK/WASM artifacts; optimisation outstanding |
| `npm audit --json` | No known warnings on that check date | Advisory snapshot only; no container or whole-system assessment |
| Synapse bootstrap | 14 passed in an isolated container | Temporary test files; no restoration of a real installation |
| `docker compose config --quiet` | Passed with a validation password | Structural check, not startup of all newly configured services |
| Separate Docker web build | Passed, including `npm ci` and Nginx 1.30.6 | Existing web deployment not replaced |
| `nginx -t` in the built image | Passed | Syntax only; no public TLS deployment |
| PowerShell scripts | No parser errors | Destructive reset not executed |
| Local browser | Sign-in, sync, reload, dialog and sign-out checked | No message sending, media or device-identity attack test in this phase |
| Responsive sign-in | Checked at 360 px and 1280 px | Not a complete device/browser compatibility assessment |
| Documentation | Local references and naming checked | External pages may change later |

Existing services and volumes were not reset or reprovisioned. Browser checks used the documented local test account and ended with server sign-out. A [historical version 0.1 preview](../brand/origrami-v0.1-preview.png) records that phase.

### Corrected findings

| Finding | Change and evidence |
|---|---|
| Concurrent SDK clients could corrupt one crypto store | Exclusive Web Lock per server/account/device; contention, release and missing-API tests |
| Saved tokens were not server-bound | Validated session format v2 with exact server binding; old formats not adopted automatically |
| Failed sign-out stopped the client before contacting the server | Revoke first, then stop; failure/retry and invalid-token tests |
| Expired sessions stayed active in the UI | Handle SDK `Session.logged_out` and clear the local session |
| Room encryption was confused with encryption of every message | Label received plaintext events; distinguish encrypted and unsent local events |
| Invalid message bodies could crash React | Type checking and safe fallback text; regression using an actual SDK event |
| Participants and senders were insufficiently visible | Participant list/count and full sender IDs |
| Failed local echoes remained beside retries | Cancel only the matching failed echo by transaction ID, including generic network/crypto failures; preserve the draft |
| A custom existing SQLite path could be overlooked | Reject existing non-PostgreSQL configurations before migration |
| Custom media paths could be silently overwritten | Stop with migration guidance before changes; data-preservation tests |
| Temporary configuration could expose secrets through permissive file modes | Exclusive temporary file with mode 0600, atomic replacement and failure cleanup |
| Outdated webserver image and unclear reset guidance | Update Nginx, validate Compose before reset, prioritise preservation of existing data |

## Run the tests

From the project root, use disposable containers:

```sh
docker compose -f compose.tools.yaml run --rm --build web-tests
docker compose -f compose.tools.yaml run --rm --build management-tests
docker compose -f compose.tools.yaml run --rm --build bootstrap-tests
docker compose -f compose.tools.yaml run --rm --build web-build
```

The web suite covers sending safeguards, initial encryption, user IDs, event rendering, sign-out, tab locks and session persistence. Management tests cover admission and roles; bootstrap tests cover configuration and data preservation. Images supply all dependencies. No host runtime installation, application credentials or host dependency directories are needed.

The bootstrap test container has no network or application-data mounts, a read-only root filesystem and a temporary `/tmp`. The tools never reset application volumes. See the [container build guide](builds.md) for details. Earlier commands in historical results describe how those earlier checks were performed, not the recommended host workflow.

## Outstanding evidence and product limitations

The earlier infrastructure review did not establish a complete encrypted two-user exchange, extra devices, verified identities, resistance to a malicious homeserver, key backup/transfer, or whole-system offline/retry behaviour. Later text-chat observations appear in the [manual tests](manual-tests.md). Automatic retries cannot universally exclude duplicate delivery.

Media sending is not implemented, so secure media transmission has not been demonstrated. Container security analysis, full browser hardening, load tests, backup restoration and public HTTPS operation remain outstanding.

**Central unresolved issue:** the goal that administration cannot read private content is not yet met against an actively malicious operator. Verified devices, an appropriate trust policy and trustworthy client distribution are missing. See the [release criteria](../SECURITY.md#release-criteria).

Technical references: [SDK concurrency warning](https://github.com/matrix-org/matrix-js-sdk), [Matrix E2EE and attachments](https://spec.matrix.org/latest/client-server-api/#end-to-end-encryption), [official Nginx image versions](https://github.com/docker-library/official-images/blob/master/library/nginx).
