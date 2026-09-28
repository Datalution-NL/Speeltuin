// Lezen/schrijven van data/competitie.json via de GitHub Contents API.
// Bezoekers lezen zonder token (de gepubliceerde site), de beheerder schrijft met een token.

export const REPO = { owner: 'Datalution-NL', repo: 'Speeltuin', branch: 'main', pad: 'data/competitie.json' };
const TOKEN_SLEUTEL = 'ovh.githubToken';

export function leesToken() {
  try { return localStorage.getItem(TOKEN_SLEUTEL) || ''; } catch { return ''; }
}
export function bewaarToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_SLEUTEL, token.trim());
    else localStorage.removeItem(TOKEN_SLEUTEL);
  } catch { /* privémodus: token blijft alleen in geheugen */ }
}

function apiUrl() {
  return `https://api.github.com/repos/${REPO.owner}/${REPO.repo}/contents/${REPO.pad}`;
}

function kop(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** Laad de data. Met token: rechtstreeks uit de repo (altijd actueel); anders de gepubliceerde kopie. */
export async function laadData({ token, fetchImpl = fetch } = {}) {
  if (token) {
    const r = await fetchImpl(`${apiUrl()}?ref=${REPO.branch}`, { headers: kop(token), cache: 'no-store' });
    if (r.ok) {
      const body = await r.json();
      return { data: JSON.parse(decodeBase64(body.content)), sha: body.sha, bron: 'github' };
    }
    if (r.status !== 401 && r.status !== 403 && r.status !== 404) throw new Error(`GitHub gaf ${r.status}`);
    // Token ongeldig of geen rechten: val terug op de gepubliceerde kopie.
  }
  const r = await fetchImpl(`data/competitie.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Kon data niet laden (${r.status})`);
  return { data: await r.json(), sha: null, bron: 'site' };
}

/**
 * Sla de data op in de repo. Haalt eerst de actuele sha op zodat we nooit een
 * tussentijdse wijziging overschrijven zonder het te merken.
 */
export async function bewaarData(data, { token, bericht, fetchImpl = fetch }) {
  if (!token) throw new Error('Geen GitHub-token ingesteld (zie Instellingen)');
  const huidig = await fetchImpl(`${apiUrl()}?ref=${REPO.branch}`, { headers: kop(token), cache: 'no-store' });
  if (huidig.status === 401) throw new Error('Token ongeldig of verlopen');
  if (huidig.status === 403) throw new Error('Token heeft geen toegang tot deze repo');
  const sha = huidig.ok ? (await huidig.json()).sha : undefined;

  const r = await fetchImpl(apiUrl(), {
    method: 'PUT',
    headers: { ...kop(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: bericht || 'Competitie bijgewerkt',
      content: encodeBase64(JSON.stringify(data, null, 2) + '\n'),
      sha,
      branch: REPO.branch,
    }),
  });
  if (r.status === 409) throw new Error('Iemand anders heeft net iets opgeslagen. Laad de pagina opnieuw en probeer nog eens.');
  if (r.status === 401 || r.status === 403) throw new Error('Token heeft geen schrijfrechten op deze repo');
  if (!r.ok) throw new Error(`Opslaan mislukt (${r.status})`);
  const body = await r.json();
  return { sha: body.content?.sha, commit: body.commit?.html_url };
}

/** Controleer of een token werkt en schrijfrechten heeft. */
export async function controleerToken(token, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://api.github.com/repos/${REPO.owner}/${REPO.repo}`, { headers: kop(token), cache: 'no-store' });
  if (!r.ok) return { ok: false, reden: r.status === 401 ? 'Token ongeldig' : `GitHub gaf ${r.status}` };
  const info = await r.json();
  const push = !!info.permissions?.push;
  return { ok: push, reden: push ? '' : 'Token kan lezen maar niet schrijven' };
}

function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeBase64(b64) {
  const bin = atob(String(b64).replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
