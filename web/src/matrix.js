import * as sdk from 'matrix-js-sdk';
import { acquireCryptoLock, getCryptoStoreName } from './client-lifecycle.js';
import { loadSession as readSession, saveSession as writeSession, forgetSession } from './session.js';

export const MATRIX_URL = import.meta.env?.VITE_MATRIX_URL || 'http://localhost:8008';
export const loadSession = () => readSession(MATRIX_URL);
export const saveSession = (session) => writeSession(session, MATRIX_URL);
export { forgetSession };

export async function loginMatrix(username, password) {
  const loginClient = sdk.createClient({ baseUrl: MATRIX_URL });
  const response = await loginClient.login('m.login.password', {
    user: username.trim(),
    password,
    initial_device_display_name: 'Origrami Web',
  });
  if (!response.access_token || !response.user_id || !response.device_id) {
    throw new Error('The server did not return a complete session.');
  }
  return {
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  };
}

export async function startMatrix(session, { signal, onSessionLoggedOut } = {}) {
  signal?.throwIfAborted();
  const cryptoDatabasePrefix = getCryptoStoreName(MATRIX_URL, session);
  const client = sdk.createClient({
    baseUrl: MATRIX_URL,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    timelineSupport: true,
  });
  const release = await acquireCryptoLock(cryptoDatabasePrefix);
  const stop = client.stopClient.bind(client);
  let stopped = false;
  client.stopClient = () => {
    if (stopped) return;
    stopped = true;
    try { stop(); } finally { void release(); }
  };
  if (onSessionLoggedOut) client.on(sdk.HttpApiEvent.SessionLoggedOut, onSessionLoggedOut);
  try {
    signal?.throwIfAborted();
    const identity = await client.whoami();
    if (identity.user_id !== session.userId || identity.device_id !== session.deviceId) {
      throw new Error('The server session does not match this account and device. Please sign in again.');
    }
    signal?.throwIfAborted();
    await client.initRustCrypto({ cryptoDatabasePrefix });
    signal?.throwIfAborted();
    await client.startClient({ initialSyncLimit: 30 });
    signal?.throwIfAborted();
  } catch (error) {
    client.stopClient();
    await release();
    throw error;
  }
  return client;
}

export async function endMatrixSession(session, activeClient) {
  const client = activeClient || sdk.createClient({ baseUrl: MATRIX_URL, accessToken: session.accessToken });
  try {
    // A network error must leave a usable crypto client for a later retry.
    await client.logout(false);
  } catch (error) {
    if (!['M_UNKNOWN_TOKEN', 'M_MISSING_TOKEN'].includes(error?.errcode)) throw error;
  }
  client.stopClient();
}

export function normalizeUserId(value, ownUserId) {
  const name = value.trim();
  if (!name) throw new Error('Please enter a username.');
  if (/\s/.test(name)) throw new Error('A Matrix ID must not contain spaces.');
  if (name.includes(':')) {
    if (!/^@[^:@]+:[^\s/]+$/.test(name)) throw new Error('Please enter a complete Matrix ID, such as @bob:localhost.');
    return name;
  }
  if (!/^@?[^@:/]+$/.test(name)) throw new Error('Please enter a valid username.');
  const domain = ownUserId.split(':').slice(1).join(':');
  return `@${name.replace(/^@/, '')}:${domain}`;
}

export async function createEncryptedChat(client, target) {
  const userId = normalizeUserId(target, client.getUserId());
  if (userId === client.getUserId()) throw new Error('Please choose another person.');
  const response = await client.createRoom({
    preset: sdk.Preset.PrivateChat,
    is_direct: true,
    invite: [userId],
    initial_state: [
      {
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      },
    ],
  });
  return response.room_id;
}

export async function createEncryptedGroup(client, name, recipients) {
  const groupName = name.trim();
  if (!groupName || groupName.length > 100) throw new Error('Please enter a group name of 1 to 100 characters.');
  const ownUserId = client.getUserId();
  const invite = [...new Set(recipients.split(/[,;\n]/).map((value) => value.trim()).filter(Boolean)
    .map((value) => normalizeUserId(value, ownUserId)))];
  if (invite.includes(ownUserId)) throw new Error('You are already included in the group. Please invite other people.');
  if (invite.length < 2) throw new Error('Please invite at least two different people to the group.');
  const response = await client.createRoom({
    preset: sdk.Preset.PrivateChat,
    visibility: 'private',
    is_direct: false,
    name: groupName,
    invite,
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
      { type: 'm.room.history_visibility', state_key: '', content: { history_visibility: 'joined' } },
    ],
  });
  return response.room_id;
}

export async function sendEncryptedText(client, roomId, text) {
  const room = client.getRoom(roomId);
  const crypto = client.getCrypto();
  if (!crypto || !isEncryptedRoom(room) || room.getMyMembership() !== 'join' || !await crypto.isEncryptionEnabledInRoom(roomId)) {
    throw new Error('You must join an encrypted room with active cryptography. Sending is blocked.');
  }
  const transactionId = client.makeTxnId();
  try {
    return await client.sendTextMessage(roomId, text, transactionId);
  } catch (error) {
    // Network and crypto errors do not always attach their local echo to Error.
    const echo = room.getLiveTimeline().getEvents().find((event) => event.getTxnId() === transactionId && event.status === sdk.EventStatus.NOT_SENT);
    if (echo) client.cancelPendingEvent(echo);
    throw error;
  }
}

export function isEncryptedRoom(room) {
  return room?.currentState.getStateEvents('m.room.encryption', '')?.getContent()?.algorithm === 'm.megolm.v1.aes-sha2';
}

export function getDisplayName(room, userId) {
  const explicitName = room.currentState.getStateEvents('m.room.name', '')?.getContent()?.name;
  if (typeof explicitName === 'string' && explicitName.trim()) return explicitName;
  const members = room.getMembers().filter((member) => ['join', 'invite'].includes(member.membership));
  if (members.length > 2) return typeof room.name === 'string' ? room.name : 'Group conversation';
  const member = members.find((m) => m.userId !== userId);
  const name = member?.name || member?.userId?.split(':')[0]?.replace('@', '');
  return typeof name === 'string' && name ? name : typeof room.name === 'string' && room.name ? room.name : 'Conversation';
}

export function readRooms(client) {
  return client.getRooms()
    .filter((room) => ['join', 'invite'].includes(room.getMyMembership()))
    .map((room) => ({
      roomId: room.roomId,
      name: getDisplayName(room, client.getUserId()),
      membership: room.getMyMembership(),
      encrypted: isEncryptedRoom(room),
      isGroup: Boolean(room.currentState.getStateEvents('m.room.name', '')?.getContent()?.name)
        || room.getMembers().filter((member) => ['join', 'invite'].includes(member.membership)).length > 2,
      members: room.getMembers().filter((member) => ['join', 'invite'].includes(member.membership)).map((member) => member.userId),
      room,
    }))
    .sort((a, b) => (b.room.getLiveTimeline().getEvents().at(-1)?.getTs() || 0) - (a.room.getLiveTimeline().getEvents().at(-1)?.getTs() || 0));
}

export function readMessages(room) {
  return room.getLiveTimeline().getEvents()
    .filter((event) => ['m.room.message', 'm.room.encrypted'].includes(event.getType()))
    .map((event) => ({
      id: event.getId(),
      sender: event.getSender(),
      message: event.isRedacted() ? 'Message deleted' : event.isDecryptionFailure() ? 'Unable to decrypt this message. Keys are missing or could not be used. Key recovery is not available yet.' : event.getType() === 'm.room.message' ? (typeof event.getContent()?.body === 'string' ? event.getContent().body : 'Invalid or unsupported message content') : 'Decrypting …',
      pending: event.getType() === 'm.room.encrypted' && !event.isDecryptionFailure(),
      unencrypted: !event.isEncrypted() && !event.status,
      sendStatus: event.status,
      time: event.getTs(),
    }));
}
