import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MatrixEvent, EventStatus } from 'matrix-js-sdk';
import { normalizeUserId, createEncryptedChat, sendEncryptedText, readMessages, endMatrixSession } from './matrix.js';

describe('private chat creation', () => {
  it('never calls the send API without encryption, membership and crypto', async () => {
    let sent = 0;
    let encrypted = false, membership = 'join', crypto = { isEncryptionEnabledInRoom: async () => true };
    const client = {
      getRoom: () => ({ currentState: { getStateEvents: () => encrypted ? { getContent: () => ({ algorithm: 'm.megolm.v1.aes-sha2' }) } : null }, getMyMembership: () => membership }),
      getCrypto: () => crypto,
      makeTxnId: () => 'test-transaction',
      sendTextMessage: async () => { sent++; },
    };
    await assert.rejects(sendEncryptedText(client, '!room:localhost', 'test'));
    encrypted = true; membership = 'invite';
    await assert.rejects(sendEncryptedText(client, '!room:localhost', 'test'));
    membership = 'join'; crypto = null;
    await assert.rejects(sendEncryptedText(client, '!room:localhost', 'test'));
    assert.equal(sent, 0);
    crypto = { isEncryptionEnabledInRoom: async () => false };
    await assert.rejects(sendEncryptedText(client, '!room:localhost', 'test'));
    crypto = { isEncryptionEnabledInRoom: async () => true };
    await sendEncryptedText(client, '!room:localhost', 'test');
    assert.equal(sent, 1);
  });
  it('removes only the matching failed local echo after a generic network or crypto error', async () => {
    const unrelated = { getTxnId: () => 'other', status: EventStatus.NOT_SENT };
    const failed = { getTxnId: () => 'transaction', status: EventStatus.NOT_SENT };
    const failure = new Error('offline');
    let cancelled;
    const client = {
      getRoom: () => ({
        currentState: { getStateEvents: () => ({ getContent: () => ({ algorithm: 'm.megolm.v1.aes-sha2' }) }) },
        getMyMembership: () => 'join',
        getLiveTimeline: () => ({ getEvents: () => [unrelated, failed] }),
      }),
      getCrypto: () => ({ isEncryptionEnabledInRoom: async () => true }),
      makeTxnId: () => 'transaction',
      sendTextMessage: async (id, body, txn) => { assert.equal(txn, 'transaction'); throw failure; },
      cancelPendingEvent: (event) => { cancelled = event; },
    };
    await assert.rejects(sendEncryptedText(client, '!room:localhost', 'test'), (error) => error === failure);
    assert.equal(cancelled, failed);
  });
  it('keeps server ports and rejects malformed identifiers', () => {
    assert.equal(normalizeUserId(' bob ', '@alice:localhost:8448'), '@bob:localhost:8448');
    assert.equal(normalizeUserId('@bob:example.org', '@alice:localhost'), '@bob:example.org');
    for (const value of ['', 'bob smith', 'bob:localhost', '@:localhost', '@', '@@bob', 'bob/path', '@@bob:localhost']) {
      assert.throws(() => normalizeUserId(value, '@alice:localhost'));
    }
  });
  it('creates encryption in the initial room state', async () => {
    let request;
    const client = { getUserId: () => '@alice:localhost', createRoom: async (body) => { request = body; return { room_id: '!test:localhost' }; } };
    assert.equal(await createEncryptedChat(client, 'bob'), '!test:localhost');
    assert.deepEqual(request.invite, ['@bob:localhost']);
    assert.equal(request.initial_state[0].type, 'm.room.encryption');
    assert.equal(request.initial_state[0].content.algorithm, 'm.megolm.v1.aes-sha2');
    await assert.rejects(createEncryptedChat(client, 'alice'));
  });
});

describe('message provenance and malformed events', () => {
  const roomWith = (events) => ({ getLiveTimeline: () => ({ getEvents: () => events }) });
  it('marks received plaintext and renders malformed bodies as safe text', () => {
    const event = new MatrixEvent({ type: 'm.room.message', content: { body: { bad: true } }, sender: '@bob:localhost' });
    const [message] = readMessages(roomWith([event]));
    assert.equal(message.unencrypted, true);
    assert.equal(typeof message.message, 'string');
    assert.match(message.message, /Invalid/);
  });
  it('does not label an unsent local echo as received plaintext', () => {
    const event = new MatrixEvent({ type: 'm.room.message', content: { body: 'test' } });
    event.status = EventStatus.NOT_SENT;
    const [message] = readMessages(roomWith([event]));
    assert.equal(message.unencrypted, false);
    assert.equal(message.sendStatus, EventStatus.NOT_SENT);
  });
  it('keeps encrypted events distinct from cleartext events', () => {
    const event = new MatrixEvent({ type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
    const [message] = readMessages(roomWith([event]));
    assert.equal(message.unencrypted, false);
    assert.equal(message.pending, true);
  });
  it('explains a failed decryption even when the SDK exposes its fallback as m.room.message', async () => {
    const event = new MatrixEvent({ type: 'm.room.encrypted', content: { algorithm: 'm.megolm.v1.aes-sha2' } });
    await event.attemptDecryption({ decryptEvent: async () => { throw new Error('missing key on new device'); } });
    assert.equal(event.getType(), 'm.room.message');
    assert.equal(event.isDecryptionFailure(), true);
    const [message] = readMessages(roomWith([event]));
    assert.match(message.message, /Unable to decrypt this message/);
    assert.match(message.message, /Key recovery/);
    assert.equal(message.pending, false);
    assert.equal(message.unencrypted, false);
    assert.doesNotMatch(message.message, /missing key on new device/);
  });
});

describe('logout lifecycle', () => {
  it('does not stop crypto when revocation fails and supports retry', async () => {
    let stopped = 0, failing = true;
    const client = { logout: async (stopFirst) => { assert.equal(stopFirst, false); if (failing) throw new Error('offline'); }, stopClient: () => { stopped++; } };
    await assert.rejects(endMatrixSession({}, client), /offline/);
    assert.equal(stopped, 0);
    failing = false;
    await endMatrixSession({}, client);
    assert.equal(stopped, 1);
  });
  it('cleans up a session whose token is already invalid', async () => {
    let stopped = false;
    await endMatrixSession({}, { logout: async () => { throw { errcode: 'M_UNKNOWN_TOKEN' }; }, stopClient: () => { stopped = true; } });
    assert.equal(stopped, true);
  });
});
