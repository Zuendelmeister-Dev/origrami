import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { acquireCryptoLock, getCryptoStoreName } from './client-lifecycle.js';

function createLocks() {
  const active = new Set();
  return {
    active,
    async request(name, options, callback) {
      assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true });
      if (active.has(name)) return callback(null);
      active.add(name);
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        active.delete(name);
      }
    },
  };
}

describe('exclusive crypto lifecycle', () => {
  it('rejects a second instance and allows a new one after release', async () => {
    const locks = createLocks();
    const release = await acquireCryptoLock('device-a', locks);
    assert.equal(locks.active.has('device-a'), true);
    await assert.rejects(acquireCryptoLock('device-a', locks), /another tab/);
    await release();
    assert.equal(locks.active.has('device-a'), false);
    const nextRelease = await acquireCryptoLock('device-a', locks);
    await nextRelease();
  });

  it('holds independent device stores separately and releases idempotently', async () => {
    const locks = createLocks();
    const releaseA = await acquireCryptoLock('device-a', locks);
    const releaseB = await acquireCryptoLock('device-b', locks);
    assert.equal(locks.active.size, 2);
    await Promise.all([releaseA(), releaseA()]);
    assert.deepEqual([...locks.active], ['device-b']);
    await releaseB();
    assert.equal(locks.active.size, 0);
  });

  it('fails closed without Web Locks instead of starting unsafely', async () => {
    await assert.rejects(acquireCryptoLock('device-a', null), /Web Locks/);
    await assert.rejects(acquireCryptoLock('device-a', {}), /Web Locks/);
  });

  it('propagates synchronous and asynchronous lock-manager failures', async () => {
    await assert.rejects(acquireCryptoLock('device-a', { request() { throw new Error('denied'); } }), /denied/);
    await assert.rejects(acquireCryptoLock('device-a', { request() { return Promise.reject(new Error('blocked')); } }), /blocked/);
  });

  it('separates crypto stores by server, user and device without changing existing names', () => {
    const session = { userId: '@alice:localhost', deviceId: 'ONE' };
    const baseUrl = 'http://localhost:8008';
    const name = getCryptoStoreName(baseUrl, session);
    assert.equal(name, 'origrami.crypto.http%3A%2F%2Flocalhost%3A8008.%40alice%3Alocalhost.ONE');
    assert.notEqual(name, getCryptoStoreName('https://example.org', session));
    assert.notEqual(name, getCryptoStoreName(baseUrl, { ...session, userId: '@bob:localhost' }));
    assert.notEqual(name, getCryptoStoreName(baseUrl, { ...session, deviceId: 'TWO' }));
  });
});
