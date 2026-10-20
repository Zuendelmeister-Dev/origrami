# Browser test checklist

Use a disposable local installation with the [three test accounts](operations.md#local-test-accounts). Open the same client URL in separate browser profiles for Alice, Bob and Charlie. Use clearly labelled test messages. Do not reset an installation containing valuable data.

Record each check as passed, failed, known limitation or not tested. The expected results below are a checklist; dated observations are in the [verification report](verification.md).

## Private conversations

| Check | Expected result |
|---|---|
| Sign in with an incorrect password | An error is shown; no chat session opens. |
| Sign in as Alice and Bob | Each profile shows its own identity and a connected status. |
| Invite yourself | Validation rejects the recipient without creating a room. |
| Alice invites Bob; Bob accepts | Both see an encrypted conversation and both member IDs. |
| Exchange Unicode, emoji and text containing `<tags>` | Both clients display the original text without interpreting HTML. |
| Submit whitespace only | Sending remains disabled. |
| Search for a conversation and a missing name | Matching chats appear; missing names show an empty result. |
| Write a draft, switch chats and return | The unsent draft remains in that view. |

## Group conversations

| Check | Expected result |
|---|---|
| Open New conversation, then Group chat | Group name and recipient fields appear. |
| Enter an empty name, one distinct invitee, an invalid ID or your own ID | No room is created; an error appears inside the dialog. |
| Invite `bob, charlie, @bob:localhost` | Exactly Bob and Charlie receive invitations. |
| Use commas, semicolons and new lines as separators | All valid recipients are included once. |
| Create a named group before invitees accept | Its name and group icon remain visible. |
| Bob accepts, Alice sends a message, then Charlie accepts | Charlie cannot read the message sent before joining. |
| Send a new message from each account after everyone joins | All three participants can read all three new messages with sender IDs. |
| Inspect outgoing Matrix message requests | Message events use `m.room.encrypted`, without plaintext message bodies. |
| Open the member list | Joined and invited member IDs are visible. |
| Reload and reopen the group in the same session | The group name and previously readable messages remain available. |

## Dialogs, themes and small screens

| Check | Expected result |
|---|---|
| Use Tab and Shift+Tab in the new-conversation dialog | Focus remains inside the dialog. |
| Press Escape or close the dialog | It closes and returns focus to its opener. |
| Submit and wait for room creation | Repeated submission and closing are disabled while the request is pending. |
| Change between private and group creation | The fields and submit label match the selected type. |
| Inspect the dialog and conversation at 390 px width | Fields, messages and controls are usable without horizontal page overflow. |
| Change the palette and reload | The selected palette persists. |

## Sessions and keys

| Check | Expected result |
|---|---|
| Reload the same session | Existing readable messages remain readable after reopening the conversation. |
| Open the same device session in another tab | The additional client is blocked by the crypto-store lock. |
| Sign out | The server session is revoked and the sign-in screen returns. |
| Sign in again | A new Matrix device is created. Old messages may be unreadable because key transfer and recovery are not implemented. |
| Interrupt connectivity during sending or sign-out | Failure is reported; drafts are preserved after failed sends and sign-out can be retried. Check delivery before resending. |

Device verification, key recovery, media sending and protection against an actively malicious operator require separate implementation and validation. See the [security model](../SECURITY.md).
