# Verification

## Automated checks — 2026-10-20

| Check | Result |
|---|---|
| Web client | 31 tests passed, including ten group-chat regressions |
| Account management | 16 tests passed |
| Synapse bootstrap | 14 tests passed |
| Production web build | Passed; large Matrix SDK/WASM bundles remain a known build warning |
| Compose base/test and tooling definitions | Validated successfully |
| PowerShell helper scripts | All three parsed without errors |
| Documentation | All local file, image and heading references resolve |

All 61 tests and the production build ran in disposable containers. No dependency trees or generated web builds were written into the project directory.

The web suite checks encrypted sending, room creation, group-name retention, recipient validation and deduplication, event rendering, sign-out, browser locks and session storage. Backend tests cover registration, approval, roles, superuser protection, blocklists, throttling and persistence. Bootstrap tests cover configuration, credentials, private temporary files and preservation of existing databases, keys and media.

## Group-chat browser check — 2026-10-20

A separate Compose instance with disposable accounts and volumes was checked using three isolated Chrome browser contexts. The packaged production web client and real Synapse cryptography were used.

- Duplicate invitees and self-invitation were rejected before room creation; valid duplicate IDs produced only one invitation each.
- Alice created a named group; Bob and Charlie received and accepted invitations.
- Each participant sent a message that all three clients could read. All three outgoing message events used `m.room.encrypted`.
- Unicode, emoji and literal HTML text remained readable, and messages remained readable after reloading the same session and reopening the group.
- The dialog and conversation were checked at desktop and 390 px mobile widths, with both colour palettes. No browser exceptions occurred.
- All three sessions signed out successfully at the server.

This verifies the tested three-user workflow. It does not establish device verification, recovery or support for every browser and device.

## Run the checks

From the project root:

```sh
docker compose -f compose.tools.yaml run --rm --build web-tests
docker compose -f compose.tools.yaml run --rm --build management-tests
docker compose -f compose.tools.yaml run --rm --build bootstrap-tests
docker compose -f compose.tools.yaml run --rm --build web-build
docker compose -f compose.yaml -f compose.test.yaml config --quiet
```

The tools file supplies dependencies without application credentials or application-data mounts. The bootstrap test container has a read-only root filesystem and temporary scratch storage. See the [build guide](builds.md).

## Earlier integration checks

Earlier two-user checks covered encrypted exchange, Unicode and literal HTML handling, invitations, drafts, reload and sign-out. A read-only storage check found three encrypted message events with ciphertext and no plaintext body in that test conversation. The [browser test checklist](manual-tests.md) describes how to repeat the current workflows.

Integration checks on 2026-10-19 covered account requests, search, approval, activation, display names, promotion without native Matrix administrator access, superuser protection, metrics permissions, demotion, deactivation with token revocation and the registration blocklist. Packaged runtime images, healthchecks, Nginx configuration and the containerised development proxy were also checked.

These dated observations are evidence for those workflows, not a security certification.

## Outstanding checks and limitations

- Device verification, resistance to substituted devices and trustworthy client distribution require implementation and independent review.
- Key backup, transfer and recovery are not available. A new sign-in creates a new Matrix device; server backups do not recover private device keys.
- Media sending, older-history pagination and comprehensive offline/retry behaviour remain incomplete. A failed send does not always prove non-delivery.
- Public HTTPS operation, container hardening, larger load tests, full mobile/browser coverage and coordinated restoration of Synapse and management data need further validation.

The client does not yet provide complete protection against an actively malicious infrastructure operator or modified client code. See the [security model and release criteria](../SECURITY.md#release-criteria).
