import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEncryptedGroup, getDisplayName, readRooms, sendEncryptedText } from './matrix.js';

describe('encrypted groups', () => {
  function clientWith(createRoom) {
    return { getUserId: () => '@alice:localhost:8448', createRoom };
  }

  it('creates a private, named encrypted room with distinct invitees and joined-only history', async () => {
    let request;
    const client = clientWith(async (body) => { request = body; return { room_id: '!group:localhost' }; });
    const id = await createEncryptedGroup(client, ' Weekend plans ', 'bob; @bob:localhost:8448,\ncharlie\n@dana:example.org');
    assert.equal(id, '!group:localhost');
    assert.equal(request.name, 'Weekend plans');
    assert.equal(request.is_direct, false);
    assert.equal(request.visibility, 'private');
    assert.equal(request.preset, 'private_chat');
    assert.deepEqual(request.invite, ['@bob:localhost:8448', '@charlie:localhost:8448', '@dana:example.org']);
    const state = Object.fromEntries(request.initial_state.map((event) => [event.type, event.content]));
    assert.equal(state['m.room.encryption'].algorithm, 'm.megolm.v1.aes-sha2');
    assert.equal(state['m.room.history_visibility'].history_visibility, 'joined');
    assert.ok(request.initial_state.every((event) => event.state_key === ''));
  });

  it('validates every recipient before creating a room', async () => {
    let calls = 0;
    const client = clientWith(async () => { calls++; });
    for (const [name, recipients] of [
      ['', 'bob,charlie'], ['  ', 'bob,charlie'], ['x'.repeat(101), 'bob,charlie'],
      ['Group', ''], ['Group', ',;\n'], ['Group', 'bob'], ['Group', 'bob,@bob:localhost:8448'],
      ['Group', 'bob,alice'], ['Group', 'bob,charlie,@alice:localhost:8448'],
      ['Group', 'bob,charlie,bad user'], ['Group', 'bob,charlie,bad:localhost'],
    ]) await assert.rejects(createEncryptedGroup(client, name, recipients));
    assert.equal(calls, 0);
  });

  it('propagates creation failures so the caller can keep the draft and show the error', async () => {
    const error = new Error('Homeserver unavailable');
    await assert.rejects(createEncryptedGroup(clientWith(async () => { throw error; }), 'Group', 'bob,charlie'), (value) => value === error);
  });
});

describe('group names and room list', () => {
  function roomWith(name, members, membership = 'join') {
    return {
      roomId: '!group:localhost', name: name || 'Fallback room name',
      currentState: { getStateEvents: (type) => type === 'm.room.name'
        ? { getContent: () => ({ name }) }
        : { getContent: () => ({ algorithm: 'm.megolm.v1.aes-sha2' }) } },
      getMembers: () => members,
      getMyMembership: () => membership,
      getLiveTimeline: () => ({ getEvents: () => [] }),
    };
  }
  const alice = { userId: '@alice:localhost', name: 'Alice', membership: 'join' };
  const bob = { userId: '@bob:localhost', name: 'Bob', membership: 'invite' };

  it('retains the explicit name before other members join and after members leave', () => {
    for (const members of [[alice], [alice, bob]]) {
      const room = roomWith('Weekend plans', members);
      assert.equal(getDisplayName(room, alice.userId), 'Weekend plans');
      const [entry] = readRooms({ getRooms: () => [room], getUserId: () => alice.userId });
      assert.equal(entry.isGroup, true);
      assert.equal(entry.name, 'Weekend plans');
    }
  });

  it('keeps invitations visible and excludes departed members from the member list', () => {
    const room = roomWith('Weekend plans', [alice, bob, { userId: '@charlie:localhost', membership: 'leave' }], 'invite');
    const [entry] = readRooms({ getRooms: () => [room], getUserId: () => bob.userId });
    assert.equal(entry.membership, 'invite');
    assert.equal(entry.encrypted, true);
    assert.deepEqual(entry.members, [alice.userId, bob.userId]);
  });

  it('preserves direct-chat display names and recognises unnamed groups', () => {
    assert.equal(getDisplayName(roomWith(undefined, [alice, bob]), alice.userId), 'Bob');
    const group = roomWith(undefined, [alice, bob, { userId: '@charlie:localhost', membership: 'join' }]);
    const [entry] = readRooms({ getRooms: () => [group], getUserId: () => alice.userId });
    assert.equal(entry.isGroup, true);
    assert.equal(entry.name, 'Fallback room name');
  });

  it('removes inaccessible rooms from the conversation list', () => {
    const rooms = ['join', 'invite', 'leave', 'ban', 'knock'].map((membership) => ({
      ...roomWith('Group', [alice, bob], membership), roomId: `!${membership}:localhost`,
    }));
    const entries = readRooms({ getRooms: () => rooms, getUserId: () => alice.userId });
    assert.deepEqual(entries.map((entry) => entry.roomId), ['!join:localhost', '!invite:localhost']);
  });

  it('orders conversations by recent activity even when one timeline is empty', () => {
    const empty = { ...roomWith('Empty group', [alice]), roomId: '!empty:localhost' };
    const older = {
      ...roomWith('Older group', [alice, bob]), roomId: '!older:localhost',
      getLiveTimeline: () => ({ getEvents: () => [{ getTs: () => 100 }] }),
    };
    const recent = {
      ...roomWith('Recent group', [alice, bob]), roomId: '!recent:localhost',
      getLiveTimeline: () => ({ getEvents: () => [{ getTs: () => 200 }] }),
    };
    const entries = readRooms({ getRooms: () => [empty, older, recent], getUserId: () => alice.userId });
    assert.deepEqual(entries.map((entry) => entry.name), ['Recent group', 'Older group', 'Empty group']);
  });

  it('renders malformed room-name metadata as safe text', () => {
    const room = roomWith({ invalid: 'name' }, [alice, bob]);
    room.name = undefined;
    assert.equal(getDisplayName(room, alice.userId), 'Bob');
    room.getMembers = () => [alice, bob, { userId: '@charlie:localhost', membership: 'join' }];
    assert.equal(getDisplayName(room, alice.userId), 'Group conversation');
  });

  it('permits group sending only while the user is joined, including after a membership change', async () => {
    let membership = 'invite';
    let sent = 0;
    const room = roomWith('Group', [alice, bob]);
    room.getMyMembership = () => membership;
    const client = {
      getRoom: () => room,
      getCrypto: () => ({ isEncryptionEnabledInRoom: async () => true }),
      makeTxnId: () => 'group-transaction',
      sendTextMessage: async () => { sent++; },
    };
    await assert.rejects(sendEncryptedText(client, room.roomId, 'Not joined yet'));
    membership = 'join';
    await sendEncryptedText(client, room.roomId, 'Joined');
    membership = 'leave';
    await assert.rejects(sendEncryptedText(client, room.roomId, 'No longer a member'));
    assert.equal(sent, 1);
  });
});
