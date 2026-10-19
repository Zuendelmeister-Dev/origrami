/** Keep the SDK's persistent crypto identity separate for every server, user and device. */
export function getCryptoStoreName(baseUrl, session) {
  return `origrami.crypto.${encodeURIComponent(baseUrl)}.${encodeURIComponent(session.userId)}.${encodeURIComponent(session.deviceId)}`;
}

/**
 * Only one SDK instance may open a device's crypto store at a time.
 * Keep the returned lock until the client has been stopped, including on startup errors.
 * Await release() before trying to acquire the same store again.
 */
export async function acquireCryptoLock(name, locks = globalThis.navigator?.locks) {
  if (typeof locks?.request !== 'function') {
    throw new Error('This browser cannot safely lock the key store across tabs. Please use a current browser with Web Locks support over HTTPS or localhost.');
  }

  let resolveAcquired;
  let rejectAcquired;
  const acquired = new Promise((resolve, reject) => {
    resolveAcquired = resolve;
    rejectAcquired = reject;
  });
  let releaseHeld;
  const held = new Promise((resolve) => { releaseHeld = resolve; });
  let request;

  try {
    request = Promise.resolve(locks.request(name, { mode: 'exclusive', ifAvailable: true }, (lock) => {
      if (!lock) {
        rejectAcquired(new Error('This session is already open in another tab or browser window. Please close this tab and use the session there.'));
        return;
      }

      resolveAcquired(() => {
        // Resolving a promise repeatedly is harmless: release is deliberately idempotent.
        releaseHeld();
        return request;
      });
      return held;
    }));
    // Observe failures even after acquisition so no detached rejection remains.
    request.catch(rejectAcquired);
  } catch (error) {
    rejectAcquired(error);
  }

  return acquired;
}
