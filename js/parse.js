// Parser voor teamindelingen: tekst/CSV uit de Shake-app of ruwe OCR-tekst.
// Pure functies, testbaar met node.

import { maakId } from './standings.js';

const TEAM_KOPPEN = ['rood', 'blauw', 'geel', 'groen', 'wit', 'zwart', 'oranje', 'red', 'blue', 'yellow', 'green', 'white', 'black', 'team 1', 'team 2', 'team a', 'team b'];
const NEGEER = new Set(['ovh', 'shake', 'teams', 'team', 'text size', 'columns', 'textsize']);

/** Normaliseer een naam voor vergelijking: kleine letters, geen accenten/leestekens. */
export function normaliseer(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Maak een regel schoon: verwijder sterktes "(3)", cijfers en rommel aan de randen. */
function schoonNaam(regel) {
  return regel
    .replace(/\(.*?\)/g, ' ')          // "(sterkte 3)"
    .replace(/[|•·\-–—_*#:]+$/g, ' ')   // rommel aan het eind
    .replace(/^[|•·\-–—_*#:\d.]+/g, ' ')// opsommingstekens / nummering vooraan
    .replace(/\s+/g, ' ')
    .trim();
}

function isTeamKop(regel) {
  const n = normaliseer(regel.replace(/:$/, ''));
  if (!n) return false;
  if (TEAM_KOPPEN.includes(n)) return true;
  // "Team Rood", "Rood:" etc.
  return TEAM_KOPPEN.some((k) => n === `team ${k}`) || /^team\s+\S+$/.test(n);
}

function kopNaam(regel) {
  const s = regel.replace(/:$/, '').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parseer vrije tekst/CSV naar teams.
 * Ondersteunt:
 *  - kop per team ("Rood" / "Blauw" / "Team 1") gevolgd door één naam per regel
 *  - "Rood: Bas, Dave, Mark" (namen gescheiden door komma's)
 *  - CSV/TSV met kolommen team,naam (met of zonder kopregel), ook ";"-gescheiden
 * @returns {{ teams: Array<{naam: string, spelers: string[]}> }} ruwe namen (niet gematcht)
 */
export function parseTeamsTekst(tekst) {
  const regels = String(tekst || '')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter(Boolean);

  const csv = probeerCsv(regels);
  if (csv) return csv;

  const teams = [];
  let huidig = null;
  const nieuwTeam = (naam) => {
    huidig = { naam, spelers: [] };
    teams.push(huidig);
  };

  // Staat er een teamkop in de tekst? Dan is alles dáárvoor (statusbalk, app-titel) ruis.
  const eersteKop = regels.findIndex((r) => {
    const m = r.match(/^([^:,]{2,30}):\s*(.+)$/);
    return (m && isTeamKop(m[1])) || isTeamKop(r.replace(/:\s*$/, ''));
  });
  const bruikbaar = eersteKop > 0 ? regels.slice(eersteKop) : regels;

  for (const regel of bruikbaar) {
    const zonderDubbelePunt = regel.replace(/:\s*$/, '');
    if (NEGEER.has(normaliseer(zonderDubbelePunt))) continue;

    // "Rood: Bas, Dave"
    const m = regel.match(/^([^:,]{2,30}):\s*(.+)$/);
    if (m && isTeamKop(m[1])) {
      nieuwTeam(kopNaam(m[1]));
      voegNamenToe(huidig, m[2]);
      continue;
    }
    if (isTeamKop(zonderDubbelePunt)) {
      nieuwTeam(kopNaam(zonderDubbelePunt));
      continue;
    }
    if (!huidig) nieuwTeam(teams.length === 0 ? 'Rood' : 'Blauw');
    voegNamenToe(huidig, regel);
  }
  return { teams: teams.filter((t) => t.spelers.length > 0 || teams.length <= 2) };
}

function voegNamenToe(team, tekst) {
  const delen = tekst.includes(',') ? tekst.split(',') : [tekst];
  for (const deel of delen) {
    const naam = schoonNaam(deel);
    if (!naam || naam.length < 2) continue;
    if (!/[a-z]/i.test(naam)) continue; // OCR-ruis zonder letters
    if (isRuis(naam)) continue;
    team.spelers.push(naam);
  }
}

/** OCR-ruis: regels met veel losse lettertjes ("ST r x", "to ie O Cohmms") zijn geen namen. */
function isRuis(naam) {
  const woorden = naam.split(' ');
  if (woorden.length > 3) return true;
  const kort = woorden.filter((w) => w.length <= 2).length;
  return woorden.length >= 2 && kort >= woorden.length - 1 && !/^[A-Za-z]+ [A-Za-z]$/.test(naam); // "Wesley H" blijft
}

/** Herken CSV/TSV met een team- en naamkolom. */
function probeerCsv(regels) {
  if (regels.length < 2) return null;
  // "Rood: Bas, Dave" is geen CSV maar een teamregel.
  if (regels.some((r) => { const m = r.match(/^([^:,]{2,30}):/); return m && isTeamKop(m[1]); })) return null;
  const scheiding = [';', '\t', ','].find((s) => regels.every((r) => r.includes(s)));
  if (!scheiding) return null;
  const rijen = regels.map((r) => r.split(scheiding).map((c) => c.replace(/^"|"$/g, '').trim()));
  if (rijen.some((r) => r.length < 2)) return null;

  let start = 0;
  const kop = rijen[0].map(normaliseer);
  let teamKol = kop.findIndex((c) => /^(team|kleur|color)$/.test(c));
  let naamKol = kop.findIndex((c) => /^(naam|name|speler|player|spelers|players)$/.test(c));
  if (teamKol >= 0 || naamKol >= 0) {
    start = 1;
    if (teamKol < 0) teamKol = naamKol === 0 ? 1 : 0;
    if (naamKol < 0) naamKol = teamKol === 0 ? 1 : 0;
  } else {
    // Geen kopregel: de kolom met de minste unieke waarden is het team.
    const uniek = (i) => new Set(rijen.map((r) => normaliseer(r[i] || ''))).size;
    teamKol = uniek(0) <= uniek(1) ? 0 : 1;
    naamKol = teamKol === 0 ? 1 : 0;
  }
  const teams = [];
  for (const r of rijen.slice(start)) {
    const teamNaam = kopNaam(r[teamKol] || '');
    const naam = schoonNaam(r[naamKol] || '');
    if (!teamNaam || !naam) continue;
    let team = teams.find((t) => t.naam === teamNaam);
    if (!team) teams.push((team = { naam: teamNaam, spelers: [] }));
    team.spelers.push(naam);
  }
  return teams.length >= 1 ? { teams } : null;
}

/** Levenshtein-afstand tussen twee strings. */
export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let vorige = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const huidig = [i];
    for (let j = 1; j <= n; j++) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      huidig[j] = Math.min(vorige[j] + 1, huidig[j - 1] + 1, vorige[j - 1] + kosten);
    }
    vorige = huidig;
  }
  return vorige[n];
}

/**
 * Koppel een ruwe naam aan een speler uit het roster.
 * @returns {{ id: string|null, naam: string, zeker: boolean, suggesties: Array<{id, naam}> }}
 */
export function matchSpeler(ruweNaam, spelers) {
  const n = normaliseer(ruweNaam);
  const kandidaten = spelers.map((s) => ({ s, n: normaliseer(s.naam) }));

  const exact = kandidaten.find((k) => k.n === n);
  if (exact) return { id: exact.s.id, naam: exact.s.naam, zeker: true, suggesties: [] };

  // Volledige naam als voorvoegsel/onderdeel: "Wesley" past bij "Wesley H" én "Wesley L" -> onzeker.
  const scores = kandidaten
    .map((k) => ({ ...k, d: afstandNaam(n, k.n) }))
    .sort((a, b) => a.d - b.d);
  const beste = scores[0];
  const drempel = n.length >= 6 ? 2 : n.length >= 4 ? 1 : 0;
  const goede = scores.filter((k) => k.d <= drempel);

  if (beste && beste.d <= drempel) {
    const gelijkwaardig = goede.filter((k) => k.d === beste.d);
    if (gelijkwaardig.length === 1) {
      return { id: beste.s.id, naam: beste.s.naam, zeker: beste.d === 0, suggesties: goede.slice(1, 4).map(pl) };
    }
    return { id: null, naam: ruweNaam, zeker: false, suggesties: gelijkwaardig.slice(0, 4).map(pl) };
  }
  return { id: null, naam: ruweNaam, zeker: false, suggesties: scores.slice(0, 3).filter((k) => k.d <= 4).map(pl) };
}

const pl = (k) => ({ id: k.s.id, naam: k.s.naam });

/** Afstand die spaties en het "H"/"L"-achtervoegsel eerlijk behandelt. */
function afstandNaam(a, b) {
  const d = levenshtein(a, b);
  // "wesley" vs "wesley h": ontbrekend achtervoegsel telt als 1 (via Levenshtein al 2 door spatie): corrigeer.
  const [kort, lang] = a.length <= b.length ? [a, b] : [b, a];
  if (lang.startsWith(kort + ' ') && lang.length - kort.length <= 2) return 1;
  return d;
}

/**
 * Koppel alle namen uit een geparseerd resultaat aan het roster.
 * @returns {{ teams: Array<{naam, spelers: Array<{id, naam, ruw, zeker, suggesties}>}> }}
 */
export function koppelTeams(geparsed, spelers) {
  return {
    teams: geparsed.teams.map((t) => ({
      naam: t.naam,
      spelers: t.spelers.flatMap((ruw) => koppelRegel(ruw, spelers)),
    })),
  };
}

/**
 * Koppel één regel. OCR plakt bij twee kolommen soms namen aan elkaar ("Bas Hilbert");
 * als de hele regel niet matcht, proberen we de losse woorden (met "Wesley H" als paar).
 */
function koppelRegel(ruw, spelers) {
  const heel = matchSpeler(ruw, spelers);
  if (heel.id) return [{ ruw, ...heel }];
  const woorden = ruw.split(/\s+/).filter(Boolean);
  if (woorden.length < 2) return [{ ruw, ...heel }];
  const delen = [];
  for (let i = 0; i < woorden.length; i++) {
    if (i + 1 < woorden.length && woorden[i + 1].length === 1) {
      const paar = matchSpeler(`${woorden[i]} ${woorden[i + 1]}`, spelers);
      if (paar.id) { delen.push({ ruw: `${woorden[i]} ${woorden[i + 1]}`, ...paar }); i++; continue; }
    }
    if (woorden[i].length === 1) continue; // los letterteken: OCR-ruis
    delen.push({ ruw: woorden[i], ...matchSpeler(woorden[i], spelers) });
  }
  // Alleen splitsen als dat iets oplevert; anders de hele regel als onbekend tonen.
  return delen.some((d) => d.id) ? delen : [{ ruw, ...heel }];
}

/** Id voor een nieuwe gastspeler op basis van de ingevoerde naam. */
export function gastId(naam) {
  return maakId(naam);
}
