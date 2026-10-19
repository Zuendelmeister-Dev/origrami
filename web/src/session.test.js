import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_KEY, loadSession, saveSession, forgetSession } from './session.js';

const baseUrl = 'https://chat.example.org';
const session = { accessToken: 'token', userId: '@alice:example.org', deviceId: 'ONE' };

function createStorage(entries = []) {
  const values = new Map(entries);
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('server-bound sessions', () => {
  it('stores only credentials and the exact homeserver URL and loads them again', () => {
    const storage = createStorage();
    saveSession({ ...session, unwanted: 'ignored', homeserverUrl: 'https://other.example' }, baseUrl, storage);
    assert.deepEqual(loadSession(baseUrl, storage), { ...session, homeserverUrl: baseUrl });
    assert.deepEqual(JSON.parse(storage.getItem(SESSION_KEY)), { ...session, homeserverUrl: baseUrl });
    assert.equal(loadSession(`${baseUrl}/`, storage), null);
    assert.equal(loadSession('https://other.example', storage), null);
  });

  it('ignores malformed JSON and sessions without a matching server', () => {
    for (const value of ['{', 'null', '[]', '42', '"token"', JSON.stringify(session)]) {
      const storage = createStorage([[SESSION_KEY, value]]);
      assert.equal(loadSession(baseUrl, storage), null);
    }
  });

  it('rejects empty, incorrectly typed or whitespace-bearing credentials', () => {
    for (const key of ['accessToken', 'userId', 'deviceId']) {
      for (const value of ['', ' ', 'with space', null, 42, false, [], {}]) {
        const invalid = { ...session, [key]: value };
        const storage = createStorage([[SESSION_KEY, JSON.stringify({ ...invalid, homeserverUrl: baseUrl })]]);
        assert.equal(loadSession(baseUrl, storage), null);
        assert.throws(() => saveSession(invalid, baseUrl, storage), /invalid/);
      }
    }
    assert.throws(() => saveSession({ ...session, userId: 'alice' }, baseUrl, createStorage()), /invalid/);
  });

  it('never restores or migrates the v1 session', () => {
    const storage = createStorage([['origrami.matrix.session.v1', JSON.stringify(session)]]);
    assert.equal(loadSession(baseUrl, storage), null);
    assert.equal(storage.getItem(SESSION_KEY), null);
    assert.equal(storage.values.size, 1);
  });

  it('clears the current and legacy stored tokens', () => {
    const storage = createStorage([['origrami.matrix.session.v1', JSON.stringify(session)]]);
    saveSession(session, baseUrl, storage);
    forgetSession(storage);
    assert.equal(storage.values.size, 0);
  });

  it('handles unavailable or denied browser storage safely and explains write failures', () => {
    const denied = {
      getItem() { throw new Error('denied'); },
      setItem() { throw new Error('denied'); },
      removeItem() { throw new Error('denied'); },
    };
    assert.equal(loadSession(baseUrl, null), null);
    assert.equal(loadSession(baseUrl, denied), null);
    assert.equal(loadSession(baseUrl), null);
    for (const storage of [null, {}, denied]) {
      assert.throws(() => saveSession(session, baseUrl, storage), /session storage/);
      assert.throws(() => forgetSession(storage), /site data/);
    }
  });
});
