export const SESSION_KEY = 'origrami.matrix.session.v2';
const LEGACY_SESSION_KEY = 'origrami.matrix.session.v1';

function defaultStorage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function validString(value) {
  return typeof value === 'string' && value.length > 0 && !/\s/.test(value);
}

function validSession(session, baseUrl) {
  return session && typeof session === 'object' && !Array.isArray(session)
    && ['accessToken', 'userId', 'deviceId'].every((key) => validString(session[key]))
    && /^@[^:]+:.+$/.test(session.userId)
    && validString(baseUrl);
}

function storedSession(session, baseUrl) {
  return {
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
    homeserverUrl: baseUrl,
  };
}

export function loadSession(baseUrl, storage = defaultStorage()) {
  try {
    const session = JSON.parse(storage?.getItem(SESSION_KEY) || 'null');
    // A legacy token is not proof of the identity of a new crypto store.
    // Deliberately do not read v1 or migrate an old device implicitly.
    if (!validSession(session, baseUrl) || session.homeserverUrl !== baseUrl) return null;
    return storedSession(session, baseUrl);
  } catch {
    return null;
  }
}

export function saveSession(session, baseUrl, storage = defaultStorage()) {
  if (!validSession(session, baseUrl)) {
    throw new Error('The session contains invalid account, device or server data and cannot be saved.');
  }
  try {
    if (typeof storage?.setItem !== 'function') throw new Error('Storage unavailable');
    storage.setItem(SESSION_KEY, JSON.stringify(storedSession(session, baseUrl)));
  } catch {
    throw new Error('The session could not be saved in your browser. Please allow session storage for this website and sign in again.');
  }
}

export function forgetSession(storage = defaultStorage()) {
  try {
    if (typeof storage?.removeItem !== 'function') throw new Error('Storage unavailable');
    storage.removeItem(SESSION_KEY);
    storage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    throw new Error('The local session could not be removed. Please clear the site data in your browser settings.');
  }
}
