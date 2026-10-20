# Security model

| Scope | Status |
|---|---|
| Origrami 0.1, local text-chat prototype with management | Not approved for confidential real-world data or public operation |

## Goal and current protection

Origrami aims to enable self-hosted communication whose private content can be decrypted only by its participants. Administrators should manage infrastructure and accounts without receiving private content keys. This goal covers text and, in future, images, videos and files.

Origrami currently creates rooms with Matrix end-to-end encryption and encrypts text on devices. Normal server operation does not require these message keys. Database access alone therefore does not reveal the plaintext of encrypted messages.

**This is not complete protection against a malicious operator.** The client does not verify device identities. It uses the SDK's default device policy, which permits unverified devices. A substituted device may receive future message keys. The party supplying the web client can also modify its code to capture plaintext or keys. Both limitations are central to the security goal.

## Which data is protected?

| Data | Current handling | Server visibility |
|---|---|---|
| Text encrypted by Origrami | Megolm E2EE; decrypted on devices | Encrypted events and delivery metadata |
| Plaintext messages from other clients | Labelled individually; not encrypted retroactively | Plaintext visible |
| Images, videos, files and thumbnails | Client-side media sending not implemented | Protection requires encryption **before** upload |
| Accounts, membership, room state, profiles and public device keys | Not comprehensively end-to-end encrypted | Visible or administrable |
| IP addresses, timestamps, sizes and connection data | Operational and traffic metadata | May be visible to the operator |
| Local private keys | IndexedDB per server/account/device, without an additional storage passphrase | Not uploaded as plaintext by the normal client |

An encrypted room does not automatically encrypt arbitrary uploads or prevent plaintext events from other clients. Media and private thumbnails must be encrypted on the client, with file keys carried inside an E2EE message. Filenames and sensitive descriptions must not accidentally be transmitted without encryption. See [encrypted attachments in the Matrix specification](https://spec.matrix.org/latest/client-server-api/#sending-encrypted-attachments).

## Trust boundaries

The [management API](docs/administration.md) exposes only account metadata and explicitly checked operations. Origrami admins and superusers are ordinary Matrix accounts without native admin privileges; only the internal backend holds a technical admin credential. The API exposes no messages, media, private keys, device-management or impersonation endpoint. Roles and superuser permission for load statistics are enforced server-side. Native Matrix admins and infrastructure operators are outside this hierarchy. This does not add protection against modified client code or substituted devices.

| Threat | Protection or remaining limitation |
|---|---|
| Reading server databases or backups | Encrypted content needs additional private keys; metadata remains accessible. |
| Origrami sending plaintext | Sending checks the encryption algorithm, membership and active SDK cryptography; otherwise it fails closed. |
| Two tabs using one device identity | A Web Lock is acquired before opening the crypto store and held until shutdown. Additional instances are rejected. Without Web Locks, the client will not start. |
| Account or server changes | Sessions are server-bound; crypto stores are additionally separated by account and device. Old session formats are not adopted automatically. |
| Token stolen after confirmed sign-out | The server token is revoked. Network failures are reported and allow retry. Closing a tab is not server sign-out. |
| Forged or additional devices | No reliable protection yet: verification and a binding trust policy are missing. |
| Modified web client or XSS | Plaintext or keys may be exposed. Independent client distribution and additional browser hardening remain open. |
| Compromised browser profile or device | Local keys and plaintext may be accessible. E2EE does not replace device security. |
| Lost keys or a new device | No key backup or transfer interface. Older messages may become permanently unreadable. |
| Administrator suspends accounts or deletes data | E2EE does not protect availability. Backups and recovery are operational responsibilities. |
| Participant shares content | E2EE cannot prevent copying, screenshots or disclosure by authorised recipients. |

Server signing keys, registration secrets, account passwords and private message keys serve different purposes. A server signing key does not decrypt a Megolm message. Resetting a password does not recover lost message keys.

## Release criteria

Before a strong security claim or public release, implement and independently verify:

1. **Identity and recipients:** cross-signing, SAS/QR verification, visible identity/device changes, and sending policies for unknown devices. A device signature alone is insufficient proof of trust.
2. **Key recovery:** encrypted backups with user-controlled recovery secrets, device transfer, safe sign-out and planned migration of existing stores. No administrative master keys.
3. **Trustworthy clients:** distribution verifiable independently of the homeserver, signed releases, reproducible or traceable builds, and update-chain protection.
4. **Media:** encryption before every upload, protected thumbnails and file keys, and checks for unencrypted side channels. Do not advertise secure media support before this is implemented.
5. **Operations:** HTTPS, restrictive browser policies, protected administration, safe admission, secret rotation, updates and tested recovery.
6. **Evidence:** two-user and multi-device tests including substituted devices, token expiry, offline operation, key loss and media; an external security review.

The [verification report](docs/verification.md) records dated test results. The [browser test checklist](docs/manual-tests.md) describes reproducible workflows. Passing tests or a clean dependency advisory report is not proof of overall system security.

## Reporting security issues

Do not publish tokens, passwords, plaintext, registration secrets or database exports. A confidential contact address and vulnerability-handling process must be established before public release; no dedicated contact address is currently published.

Further references: [Matrix E2EE guide](https://matrix.org/docs/matrix-concepts/end-to-end-encryption/), [SDK warning about concurrent crypto stores](https://github.com/matrix-org/matrix-js-sdk#end-to-end-encryption), [Synapse configuration](https://element-hq.github.io/synapse/latest/usage/configuration/config_documentation.html).
