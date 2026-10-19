# Manual tests — version 0.1

This is a historical record of the checks performed on 2026-10-18. UI labels and observations are described in English below; some original test data and historical screenshots used German. Translating this record does not repeat the tests or change the recorded results.

| Item | Recorded setup |
|---|---|
| Date | 2026-10-18 |
| Application | Origrami 0.1.0, locally built web client |
| Environment | Existing local Synapse, two separate browser origins |
| Alice | `http://127.0.0.1:5174/`, test account `alice` |
| Bob | `http://localhost:5174/`, test account `bob` |
| Test data | A new conversation and messages explicitly labelled as manual tests |

The visible interface was used for these workflows. Different origins separate local browser and key storage; this is not a test on two physical devices. Use a fixed client address for normal operation and separate browser profiles for your own repetitions.

## Workflows performed

| ID | Workflow | Observation | Result |
|---|---|---|---|
| M01 | Open sign-in | Version 0.1.0 and notices about test content, missing device verification/recovery, operator limitations and unsupported media were visible | Passed |
| M02 | Sign in as Alice with an incorrect password | Rejected; the initial English error was localised to the then-current German UI and checked again | Passed after correction |
| M03 | Sign in as Alice and Bob simultaneously | Both accounts synchronised independently with the correct username | Passed |
| M04 | As Alice, start a chat with `alice` | The client asked for another person and created no self-chat | Passed |
| M05 | As Alice, start a chat with `bob` | New encrypted conversation; Bob received an invitation | Passed |
| M06 | As Bob, open and accept the invitation | Joined successfully; both participants could use the room | Passed |
| M07 | Open the participant list | `@alice:localhost` and `@bob:localhost`, two members shown | Passed |
| M08 | Send Alice-to-Bob text containing umlauts and emoji | The labelled Unicode test message was readable by Bob with the sender ID | Passed |
| M09 | Reply from Bob to Alice | The labelled reply was readable by Alice | Passed |
| M10 | Enter whitespace only | Send button remained disabled | Passed |
| M11 | Send text containing HTML characters and umlauts | Both clients displayed literal tags, an ampersand and Unicode characters without HTML formatting | Passed |
| M12 | Search for a missing chat, then `bob` | First no matching chats, then the expected conversation | Passed |
| M13 | Write a draft, switch to the chat list and return | Unsent draft remained in the message field | Passed |
| M14 | Reload Alice's page and reopen the chat | All three test messages remained readable in the same running session | Passed |
| M15 | Change the colour palette and reload | Burgundy persisted; black/gold was restored afterwards | Passed |
| M16 | Sign Alice out | Sign-in screen returned; signing in again was possible | Passed |
| M17 | Sign Alice in after confirmed sign-out | The new device could not decrypt the three earlier messages. A raw SDK error was replaced by an explanation of missing keys and unavailable recovery | Known limitation; notice corrected |
| M18 | Send a new message after signing in again | Bob received readable new text; missing old keys did not block new sending | Passed |
| M19 | Sign out both test sessions | Both clients returned to sign-in | Passed |

## Additional server-storage check

After the first three messages, an aggregate read-only database query examined only the new local conversation created by Alice. No message keys were read and no message content was exported. The extra message sent after signing in again was not yet part of this query.

| Observation | Result |
|---|---|
| Message events | 3 × `m.room.encrypted` |
| `ciphertext` field | Present in all three |
| Plaintext `body` field | Absent in all three |
| `m.room.message` events in this conversation | None |

This confirms encrypted event-content storage for those three messages. It does not demonstrate protection against modified client code, substituted devices or metadata analysis.

## Known limitations and further checks

Version 0.1 remains a test prototype. Device verification, key recovery/transfer, media sending and protection against an actively malicious operator are incomplete. Notices appear before sign-in and in the [security model](../SECURITY.md). The sidebar also explains that signing in again creates a new device and may leave old messages unreadable.

The observed distinction is: **reloading the same session preserves readable history; signing out and signing in again does not automatically transfer existing keys.** Version 0.1 has no complete recovery workflow. Add one before relying on valuable history.

Not manually checked in this phase: disconnection during sending, parallel tabs with the same session, sending in an unencrypted room, manipulated device identities, very large histories, server restart, backup and recovery. Some cases have unit tests; these do not replace whole-system checks.

The newly created conversation and messages were retained for further local testing. No reset was performed. Earlier automated and infrastructure checks are recorded separately in the [verification report](verification.md).

Historical reference images: [Bob's readable test chat](../brand/origrami-v0.1-chat-test.png), [key notice after a new sign-in](../brand/origrami-v0.1-key-hint.png), and [sign-in notices](../brand/origrami-v0.1-preview.png). The [current English chat screenshot](images/encrypted-chat.png) and [sign-in screenshot](images/login.png) illustrate the subsequently translated interface.

The version was rebuilt after these corrections; 21 client tests passed, including the added SDK-decryption-error regression. The 14 earlier bootstrap tests were not repeated during this manual phase because server initialisation was unchanged.

## Repeat the core workflows

1. Open the same client URL in two separate browser profiles and sign in with Alice and Bob.
2. As Alice, create a new chat with Bob; as Bob, accept the invitation.
3. Send clearly labelled text with Unicode characters and emoji in both directions and verify receipt.
4. Check recipients, empty messages, search and draft retention when switching to the chat list.
5. Reload and confirm that history remains readable in the same session.
6. Sign both sessions out at the server. Signing in again creates a new Matrix device; old keys are not adopted automatically.

Record observations as passed, failed, known limitation or not tested. Missing functionality and unperformed checks do not count as passing.
