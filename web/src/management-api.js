export async function managementRequest(path, { token, method = 'GET', body, signal } = {}) {
  const response = await fetch(`/api${path}`, {
    method, signal, cache: 'no-store', credentials: 'omit',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error('Management is unavailable. Please try again later.'); }
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}
