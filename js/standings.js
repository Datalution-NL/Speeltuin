// Pure functies voor de competitiestand. Geen DOM, geen netwerk: testbaar met node.

export const PUNTEN = { winst: 3, gelijk: 1, verlies: 0 };

/** Maak een id van een spelersnaam: "Wesley H" -> "wesley-h". */
export function maakId(naam) {
  return String(naam)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Resultaat van een team in een wedstrijd: 'winst' | 'gelijk' | 'verlies'. */
export function resultaat(eigen, tegen) {
  if (eigen > tegen) return 'winst';
  if (eigen < tegen) return 'verlies';
  return 'gelijk';
}

/**
 * Valideer een wedstrijd. Geeft een lijst met foutmeldingen (leeg = geldig).
 * @param {object} wedstrijd
 * @param {object} data volledige competitie-data (voor datum-uniciteit); optioneel
 */
export function valideerWedstrijd(wedstrijd, data, { negeerDatum } = {}) {
  const fouten = [];
  if (!wedstrijd || typeof wedstrijd !== 'object') return ['Geen wedstrijd'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(wedstrijd.datum || '')) fouten.push('Ongeldige datum');
  if (!Array.isArray(wedstrijd.teams) || wedstrijd.teams.length !== 2) {
    fouten.push('Een wedstrijd heeft precies twee teams');
    return fouten;
  }
  const gezien = new Set();
  wedstrijd.teams.forEach((team, i) => {
    const label = team?.naam || `Team ${i + 1}`;
    if (!team?.naam?.trim()) fouten.push(`Team ${i + 1} heeft geen naam`);
    if (!Number.isInteger(team?.doelpunten) || team.doelpunten < 0) fouten.push(`${label}: ongeldig aantal doelpunten`);
    if (!Array.isArray(team?.spelers) || team.spelers.length === 0) fouten.push(`${label}: geen spelers`);
    for (const id of team?.spelers || []) {
      if (gezien.has(id)) fouten.push(`Speler "${id}" staat in beide teams`);
      gezien.add(id);
    }
  });
  if (data?.wedstrijden) {
    const dubbel = data.wedstrijden.some((w) => w.datum === wedstrijd.datum && w.datum !== negeerDatum);
    if (dubbel) fouten.push(`Er is al een wedstrijd op ${wedstrijd.datum}`);
  }
  return fouten;
}

/**
 * Bereken de stand uit de wedstrijden.
 * @returns {Array<{id, naam, gast, gespeeld, winst, gelijk, verlies, dv, dt, saldo, punten, perDag: Record<string, number|null>}>}
 * gesorteerd op punten, saldo, dv (aflopend) en daarna naam.
 */
export function berekenStand(data) {
  const rijen = new Map();
  const rij = (id, naam, gast = false) => {
    if (!rijen.has(id)) {
      rijen.set(id, { id, naam, gast, gespeeld: 0, winst: 0, gelijk: 0, verlies: 0, dv: 0, dt: 0, saldo: 0, punten: 0, perDag: {} });
    }
    return rijen.get(id);
  };
  for (const s of data.spelers || []) rij(s.id, s.naam, !!s.gast);

  const wedstrijden = [...(data.wedstrijden || [])].sort((a, b) => a.datum.localeCompare(b.datum));
  for (const w of wedstrijden) {
    if (!w.teams || w.teams.length !== 2) continue;
    const [a, b] = w.teams;
    const kanten = [[a, b], [b, a]];
    for (const [eigen, tegen] of kanten) {
      const res = resultaat(eigen.doelpunten, tegen.doelpunten);
      const punten = PUNTEN[res];
      for (const id of eigen.spelers || []) {
        const r = rij(id, naamVoor(data, id), !(data.spelers || []).some((s) => s.id === id));
        r.gespeeld += 1;
        r[res] += 1;
        r.dv += eigen.doelpunten;
        r.dt += tegen.doelpunten;
        r.saldo = r.dv - r.dt;
        r.punten += punten;
        r.perDag[w.datum] = punten;
      }
    }
  }
  return [...rijen.values()].sort(vergelijkRij);
}

export function vergelijkRij(a, b) {
  return b.punten - a.punten || b.saldo - a.saldo || b.dv - a.dv || a.naam.localeCompare(b.naam, 'nl');
}

/** Naam van een speler-id; onbekende ids (gasten) worden netjes weergegeven. */
export function naamVoor(data, id) {
  const s = (data.spelers || []).find((p) => p.id === id);
  if (s) return s.naam;
  return id.split('-').map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(' ');
}

/** Eerstvolgende speeldag zonder wedstrijd, op of na `vandaag` (ISO-datum). Valt terug op de laatste. */
export function volgendeSpeeldag(data, vandaag = new Date().toISOString().slice(0, 10)) {
  const gespeeld = new Set((data.wedstrijden || []).map((w) => w.datum));
  const open = (data.speeldagen || []).filter((d) => !gespeeld.has(d));
  return open.find((d) => d >= vandaag) || open.at(-1) || (data.speeldagen || []).at(-1) || vandaag;
}

/** "2026-09-25" -> "vr 25 sep 2026" */
export function formatDatum(iso, { kort = false } = {}) {
  const [j, m, d] = iso.split('-').map(Number);
  const datum = new Date(Date.UTC(j, m - 1, d));
  const opties = kort ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  return new Intl.DateTimeFormat('nl-NL', { ...opties, timeZone: 'UTC' }).format(datum);
}
