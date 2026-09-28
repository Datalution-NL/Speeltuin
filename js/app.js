import { berekenStand, valideerWedstrijd, volgendeSpeeldag, formatDatum, naamVoor, maakId } from './standings.js';
import { parseTeamsTekst, koppelTeams } from './parse.js';
import { laadData, bewaarData, leesToken, bewaarToken, controleerToken, REPO } from './github.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, attrs = {}, ...kinderen) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const kind of kinderen.flat()) e.append(kind instanceof Node ? kind : document.createTextNode(String(kind)));
  return e;
};

const state = {
  data: null,
  token: leesToken(),
  bron: '',
  // editor voor de invoerflow
  editor: null, // { bewerkDatum, datum, teams: [{naam, spelers:[{id, naam, zeker, suggesties, ruw}]}], opmerking, doelpunten:[a,b] }
};

/* ---------- Meldingen ---------- */
let meldingTimer;
function melding(tekst, soort = 'info', duur = 6000) {
  const m = $('#melding');
  m.textContent = tekst;
  m.className = `melding ${soort}`;
  clearTimeout(meldingTimer);
  if (duur) meldingTimer = setTimeout(() => m.classList.add('verborgen'), duur);
}

/* ---------- Navigatie ---------- */
function toonView(naam) {
  const bestaat = document.querySelector(`#view-${naam}`);
  if (!bestaat) naam = 'stand';
  document.querySelectorAll('section.view').forEach((s) => s.classList.toggle('actief', s.id === `view-${naam}`));
  document.querySelectorAll('nav.tabs a').forEach((a) => a.classList.toggle('actief', a.dataset.view === naam));
  if (naam === 'invoer') renderInvoer();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => toonView(location.hash.replace('#', '') || 'stand'));

/* ---------- Stand ---------- */
function teamKlasse(naam) {
  const n = naam.toLowerCase();
  if (n.includes('rood') || n.includes('red')) return 'rood';
  if (n.includes('blauw') || n.includes('blue')) return 'blauw';
  return '';
}

function renderStand() {
  const { data } = state;
  $('#seizoen').textContent = data.seizoen ? `seizoen ${data.seizoen}` : '';
  const stand = berekenStand(data);
  const gespeeld = data.wedstrijden.length;
  $('#stand-info').textContent = `${gespeeld} van ${data.speeldagen.length} speeldagen gespeeld`;

  const body = $('#stand-body');
  body.replaceChildren();
  const dagen = [...data.wedstrijden].sort((a, b) => a.datum.localeCompare(b.datum)).map((w) => w.datum);
  stand.forEach((r, i) => {
    const rij = el('tr', { class: 'rij' },
      el('td', { class: 'pos' }, i + 1),
      el('td', {}, r.naam, r.gast ? el('span', { class: 'gast' }, 'gast') : ''),
      el('td', {}, r.gespeeld),
      el('td', { class: 'optioneel' }, r.winst),
      el('td', { class: 'optioneel' }, r.gelijk),
      el('td', { class: 'optioneel' }, r.verlies),
      el('td', {}, r.dv),
      el('td', {}, r.dt),
      el('td', {}, (r.saldo > 0 ? '+' : '') + r.saldo),
      el('td', { class: 'punten' }, r.punten),
    );
    const detail = el('tr', { class: 'detail', hidden: '' },
      el('td', { colspan: 10 },
        el('div', { class: 'dagpunten' },
          dagen.map((d) => {
            const p = r.perDag[d];
            return el('span', { class: p === undefined ? '' : `p${p}` }, `${formatDatum(d, { kort: true })}: ${p === undefined ? '–' : p}`);
          }),
          dagen.length ? '' : el('span', {}, 'Nog geen wedstrijden'),
        ),
      ),
    );
    rij.addEventListener('click', () => { detail.hidden = !detail.hidden; });
    body.append(rij, detail);
  });

  const laatste = [...data.wedstrijden].sort((a, b) => b.datum.localeCompare(a.datum))[0];
  const kaart = $('#laatste-uitslag');
  kaart.replaceChildren(el('h2', {}, 'Laatste uitslag'));
  if (!laatste) kaart.append(el('p', { class: 'stil' }, 'Nog geen uitslag ingevoerd.'));
  else kaart.append(wedstrijdBlok(laatste));
}

function wedstrijdBlok(w) {
  const [a, b] = w.teams;
  return el('div', {},
    el('p', {}, el('strong', {}, formatDatum(w.datum)), ` · ${a.naam} ${a.doelpunten} – ${b.doelpunten} ${b.naam}`),
    el('p', { class: 'teams' },
      el('span', { class: `teamlabel ${teamKlasse(a.naam)}` }, a.naam), a.spelers.map((id) => naamVoor(state.data, id)).join(', '),
    ),
    el('p', { class: 'teams' },
      el('span', { class: `teamlabel ${teamKlasse(b.naam)}` }, b.naam), b.spelers.map((id) => naamVoor(state.data, id)).join(', '),
    ),
    w.opmerking ? el('p', { class: 'stil' }, w.opmerking) : '',
  );
}

/* ---------- Speeldagen ---------- */
function renderSpeeldagen() {
  const { data } = state;
  const lijst = $('#speeldagen-lijst');
  lijst.replaceChildren();
  const perDatum = new Map(data.wedstrijden.map((w) => [w.datum, w]));
  const alleDatums = [...new Set([...data.speeldagen, ...perDatum.keys()])].sort();
  const beheer = !!state.token;
  for (const datum of alleDatums) {
    const w = perDatum.get(datum);
    const li = el('li', {}, el('span', { class: 'datum' }, formatDatum(datum)));
    if (w) {
      const [a, b] = w.teams;
      li.append(
        el('span', { class: 'score' }, `${a.naam} ${a.doelpunten} – ${b.doelpunten} ${b.naam}`),
        el('div', { class: 'teams' },
          el('span', { class: `teamlabel ${teamKlasse(a.naam)}` }, a.naam), a.spelers.map((id) => naamVoor(data, id)).join(', '),
          el('br'),
          el('span', { class: `teamlabel ${teamKlasse(b.naam)}` }, b.naam), b.spelers.map((id) => naamVoor(data, id)).join(', '),
          w.opmerking ? el('div', { class: 'stil' }, w.opmerking) : '',
        ),
      );
      if (beheer) {
        li.append(el('div', { class: 'acties' },
          el('button', { class: 'klein secundair', onclick: () => startBewerken(w) }, 'Wijzigen'),
          el('button', { class: 'klein gevaar', onclick: () => verwijderWedstrijd(w) }, 'Verwijderen'),
        ));
      }
    } else {
      li.append(el('span', { class: 'open' }, 'nog niet ingevoerd'));
      if (beheer) li.append(el('div', { class: 'acties' }, el('button', { class: 'klein', onclick: () => startNieuw(datum) }, 'Invoeren')));
    }
    lijst.append(li);
  }
}

async function verwijderWedstrijd(w) {
  if (!confirm(`Uitslag van ${formatDatum(w.datum)} verwijderen?`)) return;
  const nieuw = { ...state.data, wedstrijden: state.data.wedstrijden.filter((x) => x.datum !== w.datum) };
  await opslaan(nieuw, `Uitslag ${formatDatum(w.datum, { kort: true })} verwijderd`);
}

/* ---------- Invoer ---------- */
function nieuwEditor(datum, bewerk) {
  return {
    bewerkDatum: bewerk?.datum || null,
    datum,
    teams: bewerk
      ? bewerk.teams.map((t) => ({ naam: t.naam, spelers: t.spelers.map((id) => ({ id, naam: naamVoor(state.data, id), zeker: true, suggesties: [] })) }))
      : [{ naam: 'Rood', spelers: [] }, { naam: 'Blauw', spelers: [] }],
    doelpunten: bewerk ? bewerk.teams.map((t) => t.doelpunten) : ['', ''],
    opmerking: bewerk?.opmerking || '',
    stap: bewerk ? 3 : 2,
  };
}

function startNieuw(datum) {
  state.editor = nieuwEditor(datum || volgendeSpeeldag(state.data));
  location.hash = '#invoer';
  renderInvoer();
}
function startBewerken(w) {
  state.editor = nieuwEditor(w.datum, w);
  location.hash = '#invoer';
  renderInvoer();
}

function renderInvoer() {
  const beheer = !!state.token;
  $('#invoer-geen-token').hidden = beheer;
  $('#invoer-editor').hidden = !beheer;
  if (!beheer) return;
  if (!state.editor) state.editor = nieuwEditor(volgendeSpeeldag(state.data));
  const e = state.editor;

  $('#invoer-titel').textContent = e.bewerkDatum ? `Uitslag van ${formatDatum(e.bewerkDatum)} wijzigen` : 'Nieuwe uitslag';
  const select = $('#invoer-datum');
  select.replaceChildren();
  const bezet = new Set(state.data.wedstrijden.map((w) => w.datum));
  const datums = [...new Set([...state.data.speeldagen, e.datum])].sort();
  for (const d of datums) {
    const opt = el('option', { value: d }, formatDatum(d) + (bezet.has(d) && d !== e.bewerkDatum ? ' (al ingevoerd)' : ''));
    if (bezet.has(d) && d !== e.bewerkDatum) opt.disabled = true;
    select.append(opt);
  }
  select.value = e.datum;

  document.querySelectorAll('.stappen span').forEach((s) => s.classList.toggle('actief', Number(s.dataset.stap) <= e.stap));
  $('#stap-teams').hidden = e.stap > 2;
  $('#stap-controle').hidden = e.stap !== 3;
  $('#stap-score').hidden = e.stap !== 4;
  if (e.stap === 3) renderTeamsEditor();
  if (e.stap === 4) renderScore();
}

function renderTeamsEditor() {
  const e = state.editor;
  const editor = $('#teams-editor');
  editor.replaceChildren();
  const ingedeeld = new Set(e.teams.flatMap((t) => t.spelers.map((s) => s.id).filter(Boolean)));

  e.teams.forEach((team, ti) => {
    const ander = e.teams[1 - ti];
    const kaart = el('div', { class: `team-kaart ${teamKlasse(team.naam)}` });
    const naamInput = el('input', { type: 'text', value: team.naam, oninput: (ev) => { team.naam = ev.target.value; kaart.className = `team-kaart ${teamKlasse(team.naam)}`; } });
    kaart.append(el('div', { class: 'kop' }, naamInput, el('span', { class: 'aantal' }, `${team.spelers.length} spelers`)));

    const lijst = el('ul', { class: 'spelerslijst' });
    team.spelers.forEach((s, si) => {
      const li = el('li', { class: s.id ? (s.zeker ? '' : 'onzeker') : 'onbekend' });
      if (s.id) {
        li.append(el('span', { class: 'naam', title: s.ruw && s.ruw !== s.naam ? `gelezen als "${s.ruw}"` : '' }, s.naam, s.zeker ? '' : ' ?'));
      } else {
        li.append(el('span', { class: 'naam' }, `Onbekend: "${s.ruw || s.naam}"`));
        const keuze = el('select', {});
        keuze.append(el('option', { value: '' }, 'Kies speler…'));
        const kandidaten = [...s.suggesties, ...state.data.spelers.filter((p) => !s.suggesties.some((x) => x.id === p.id))];
        for (const k of kandidaten) if (!ingedeeld.has(k.id)) keuze.append(el('option', { value: k.id }, k.naam));
        keuze.append(el('option', { value: '__gast' }, `Als gast "${s.ruw || s.naam}"`));
        keuze.addEventListener('change', () => {
          if (keuze.value === '__gast') Object.assign(s, { id: maakId(s.ruw || s.naam), naam: s.ruw || s.naam, zeker: true, gast: true });
          else if (keuze.value) Object.assign(s, { id: keuze.value, naam: naamVoor(state.data, keuze.value), zeker: true });
          renderTeamsEditor();
        });
        li.append(keuze);
      }
      li.append(
        el('button', { type: 'button', title: `Naar ${ander.naam}`, onclick: () => { team.spelers.splice(si, 1); ander.spelers.push(s); renderTeamsEditor(); } }, ti === 0 ? '→' : '←'),
        el('button', { type: 'button', title: 'Verwijderen', onclick: () => { team.spelers.splice(si, 1); renderTeamsEditor(); } }, '✕'),
      );
      lijst.append(li);
    });
    kaart.append(lijst);

    // Toevoegen uit roster of als gast
    const keuze = el('select', {});
    keuze.append(el('option', { value: '' }, 'Speler toevoegen…'));
    for (const p of state.data.spelers) if (!ingedeeld.has(p.id)) keuze.append(el('option', { value: p.id }, p.naam));
    keuze.addEventListener('change', () => {
      if (!keuze.value) return;
      team.spelers.push({ id: keuze.value, naam: naamVoor(state.data, keuze.value), zeker: true, suggesties: [] });
      renderTeamsEditor();
    });
    const gastInput = el('input', { type: 'text', placeholder: 'Gast (naam)' });
    const gastKnop = el('button', { type: 'button', class: 'secundair', onclick: () => {
      const naam = gastInput.value.trim();
      if (!naam) return;
      const id = maakId(naam);
      if (ingedeeld.has(id)) { melding(`${naam} is al ingedeeld`, 'waarschuwing'); return; }
      const bestaand = state.data.spelers.find((p) => p.id === id);
      team.spelers.push({ id, naam: bestaand?.naam || naam, zeker: true, suggesties: [], gast: !bestaand });
      renderTeamsEditor();
    } }, '+ gast');
    kaart.append(el('div', { class: 'toevoegen' }, keuze, gastInput, gastKnop));
    editor.append(kaart);
  });
}

function renderScore() {
  const e = state.editor;
  $('#score-label-a').textContent = e.teams[0].naam;
  $('#score-label-b').textContent = e.teams[1].naam;
  $('#score-a').className = teamKlasse(e.teams[0].naam);
  $('#score-b').className = teamKlasse(e.teams[1].naam);
  $('#score-a').value = e.doelpunten[0];
  $('#score-b').value = e.doelpunten[1];
  $('#invoer-opmerking').value = e.opmerking;
  $('#invoer-fouten').classList.add('verborgen');
  bijwerkSamenvatting();
}

function bijwerkSamenvatting() {
  const e = state.editor;
  const a = Number($('#score-a').value), b = Number($('#score-b').value);
  const s = $('#score-samenvatting');
  if ($('#score-a').value === '' || $('#score-b').value === '') { s.textContent = ''; return; }
  const [ta, tb] = e.teams;
  let tekst;
  if (a === b) tekst = `Gelijkspel: alle ${ta.spelers.length + tb.spelers.length} spelers krijgen 1 punt.`;
  else {
    const [win, ver] = a > b ? [ta, tb] : [tb, ta];
    tekst = `${win.naam} wint: ${win.spelers.map((p) => p.naam).join(', ')} krijgen 3 punten; ${ver.naam} (${ver.spelers.length} spelers) 0 punten.`;
  }
  s.replaceChildren(el('strong', {}, `${ta.naam} ${a} – ${b} ${tb.naam}`), el('br'), tekst);
}

function editorNaarWedstrijd() {
  const e = state.editor;
  return {
    datum: e.datum,
    teams: e.teams.map((t, i) => ({
      naam: t.naam.trim(),
      spelers: t.spelers.map((s) => s.id).filter(Boolean),
      doelpunten: $(i === 0 ? '#score-a' : '#score-b').value === '' ? NaN : Number($(i === 0 ? '#score-a' : '#score-b').value),
    })),
    opmerking: $('#invoer-opmerking').value.trim(),
  };
}

async function opslaanWedstrijd() {
  const e = state.editor;
  const w = editorNaarWedstrijd();
  const fouten = valideerWedstrijd(w, state.data, { negeerDatum: e.bewerkDatum });
  const onbekend = e.teams.flatMap((t) => t.spelers.filter((s) => !s.id));
  if (onbekend.length) fouten.push(`Nog niet gekoppeld: ${onbekend.map((s) => `"${s.ruw || s.naam}"`).join(', ')} (ga terug naar Teams aanpassen)`);
  const fb = $('#invoer-fouten');
  if (fouten.length) {
    fb.replaceChildren(...fouten.map((f) => el('div', {}, f)));
    fb.classList.remove('verborgen');
    return;
  }
  fb.classList.add('verborgen');

  // Gasten die nog niet in het roster staan als gast toevoegen zodat hun naam netjes blijft.
  const spelers = [...state.data.spelers];
  for (const s of e.teams.flatMap((t) => t.spelers)) {
    if (s.id && !spelers.some((p) => p.id === s.id)) spelers.push({ id: s.id, naam: s.naam, gast: true });
  }
  const wedstrijden = state.data.wedstrijden.filter((x) => x.datum !== e.bewerkDatum).concat([w]).sort((a, b) => a.datum.localeCompare(b.datum));
  const nieuw = { ...state.data, spelers, wedstrijden };
  const bericht = `Uitslag ${formatDatum(w.datum, { kort: true })} ${w.datum.slice(0, 4)}: ${w.teams[0].naam} ${w.teams[0].doelpunten} – ${w.teams[1].doelpunten} ${w.teams[1].naam}`;
  const ok = await opslaan(nieuw, bericht);
  if (ok) {
    state.editor = null;
    location.hash = '#stand';
  }
}

async function opslaan(nieuweData, bericht) {
  const knop = $('#knop-opslaan');
  knop.disabled = true;
  melding('Opslaan…', 'info', 0);
  try {
    await bewaarData(nieuweData, { token: state.token, bericht });
    state.data = nieuweData;
    renderAlles();
    melding('Opgeslagen. De publieke pagina is binnen ongeveer een minuut bijgewerkt.', 'ok', 8000);
    return true;
  } catch (err) {
    melding(`Opslaan mislukt: ${err.message}`, 'fout', 0);
    return false;
  } finally {
    knop.disabled = false;
  }
}

/* ---------- Teams uit tekst/afbeelding ---------- */
function verwerkTekst(tekst, bron) {
  const geparsed = parseTeamsTekst(tekst);
  const totaal = geparsed.teams.reduce((n, t) => n + t.spelers.length, 0);
  if (!totaal) { melding(`Geen namen gevonden in de ${bron}.`, 'waarschuwing'); return; }
  const gekoppeld = koppelTeams(geparsed, state.data.spelers);
  const e = state.editor;
  const teams = gekoppeld.teams.slice(0, 2);
  while (teams.length < 2) teams.push({ naam: teams.length === 0 ? 'Rood' : 'Blauw', spelers: [] });
  if (gekoppeld.teams.length > 2) melding('Meer dan twee teams gevonden; alleen de eerste twee zijn overgenomen.', 'waarschuwing');
  e.teams = teams;
  e.stap = 3;
  const onbekend = teams.flatMap((t) => t.spelers).filter((s) => !s.id).length;
  melding(`${totaal} namen gelezen uit de ${bron}${onbekend ? `, ${onbekend} niet herkend` : ''}. Controleer de indeling.`, onbekend ? 'waarschuwing' : 'ok');
  renderInvoer();
}

async function verwerkAfbeelding(bestand) {
  const balk = $('#ocr-voortgang');
  const status = $('#ocr-status');
  balk.hidden = false;
  try {
    const { herkenTekst } = await import('./ocr.js');
    const { tekst } = await herkenTekst(bestand, (s, p) => { status.textContent = s; balk.firstElementChild.style.width = `${Math.round(p * 100)}%`; });
    status.textContent = '';
    $('#invoer-tekst').value = tekst.trim();
    verwerkTekst(tekst, 'afbeelding');
  } catch (err) {
    status.textContent = '';
    melding(`Afbeelding lezen mislukt: ${err.message}. Plak de tekst uit Shake als alternatief.`, 'fout', 0);
  } finally {
    balk.hidden = true;
    balk.firstElementChild.style.width = '0';
  }
}

/* ---------- Instellingen ---------- */
function renderInstellingen() {
  $('#token-invoer').value = state.token;
  $('#token-status').textContent = state.token ? 'Token ingesteld: je kunt uitslagen invoeren.' : 'Geen token: alleen-lezen.';
  $('#tab-invoer').classList.toggle('verborgen', false);
  const lijst = $('#spelers-lijst');
  lijst.replaceChildren();
  for (const p of [...state.data.spelers].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'))) {
    const li = el('li', {}, el('span', { class: 'naam' }, p.naam, p.gast ? el('span', { class: 'gast' }, ' (gast)') : ''));
    if (state.token) {
      li.append(el('button', { type: 'button', class: 'klein secundair', onclick: () => hernoemSpeler(p) }, '✎'));
    }
    lijst.append(li);
  }
  $('#knop-speler-toevoegen').disabled = !state.token;
}

async function hernoemSpeler(p) {
  const naam = prompt(`Nieuwe naam voor ${p.naam}:`, p.naam);
  if (!naam || naam.trim() === p.naam) return;
  const spelers = state.data.spelers.map((s) => (s.id === p.id ? { ...s, naam: naam.trim() } : s));
  await opslaan({ ...state.data, spelers }, `Speler ${p.naam} hernoemd naar ${naam.trim()}`);
}

async function voegSpelerToe() {
  const invoer = $('#nieuwe-speler');
  const naam = invoer.value.trim();
  if (!naam) return;
  const id = maakId(naam);
  if (state.data.spelers.some((s) => s.id === id)) { melding(`${naam} staat al in de lijst`, 'waarschuwing'); return; }
  const ok = await opslaan({ ...state.data, spelers: [...state.data.spelers, { id, naam, gast: false }] }, `Speler ${naam} toegevoegd`);
  if (ok) invoer.value = '';
}

function downloadBestand(naam, inhoud, type) {
  const blob = new Blob([inhoud], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: naam });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ---------- Start ---------- */
function renderAlles() {
  renderStand();
  renderSpeeldagen();
  renderInstellingen();
  if (location.hash === '#invoer') renderInvoer();
  $('#bron-info').textContent = state.bron === 'github' ? 'data rechtstreeks uit GitHub' : 'gepubliceerde stand';
}

function koppelKnoppen() {
  $('#invoer-datum').addEventListener('change', (ev) => { state.editor.datum = ev.target.value; });
  $('#invoer-afbeelding').addEventListener('change', (ev) => { const f = ev.target.files?.[0]; if (f) verwerkAfbeelding(f); ev.target.value = ''; });
  $('#knop-tekst').addEventListener('click', () => verwerkTekst($('#invoer-tekst').value, 'tekst'));
  $('#knop-leeg').addEventListener('click', () => { state.editor.teams = [{ naam: 'Rood', spelers: [] }, { naam: 'Blauw', spelers: [] }]; state.editor.stap = 3; renderInvoer(); });
  $('#knop-terug-teams').addEventListener('click', () => { state.editor.stap = 2; renderInvoer(); });
  $('#knop-naar-score').addEventListener('click', () => {
    const e = state.editor;
    const onbekend = e.teams.flatMap((t) => t.spelers.filter((s) => !s.id));
    if (onbekend.length) { melding(`Koppel eerst: ${onbekend.map((s) => `"${s.ruw || s.naam}"`).join(', ')}`, 'waarschuwing'); return; }
    if (e.teams.some((t) => !t.spelers.length)) { melding('Beide teams hebben spelers nodig.', 'waarschuwing'); return; }
    e.stap = 4; renderInvoer();
  });
  $('#knop-terug-controle').addEventListener('click', () => { state.editor.doelpunten = [$('#score-a').value, $('#score-b').value]; state.editor.opmerking = $('#invoer-opmerking').value; state.editor.stap = 3; renderInvoer(); });
  $('#score-a').addEventListener('input', bijwerkSamenvatting);
  $('#score-b').addEventListener('input', bijwerkSamenvatting);
  $('#knop-opslaan').addEventListener('click', opslaanWedstrijd);

  $('#knop-token-opslaan').addEventListener('click', async () => {
    const token = $('#token-invoer').value.trim();
    if (!token) { melding('Vul eerst een token in.', 'waarschuwing'); return; }
    $('#token-status').textContent = 'Token testen…';
    const r = await controleerToken(token);
    if (!r.ok) { $('#token-status').textContent = `Token werkt niet: ${r.reden}`; return; }
    bewaarToken(token);
    state.token = token;
    melding('Token opgeslagen. Je kunt nu uitslagen invoeren.', 'ok');
    await laden();
  });
  $('#knop-token-wissen').addEventListener('click', async () => {
    bewaarToken('');
    state.token = '';
    state.editor = null;
    melding('Token verwijderd.', 'info');
    await laden();
  });
  $('#knop-speler-toevoegen').addEventListener('click', voegSpelerToe);
  $('#nieuwe-speler').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') voegSpelerToe(); });
  $('#knop-export').addEventListener('click', () => downloadBestand('competitie.json', JSON.stringify(state.data, null, 2), 'application/json'));
  $('#knop-export-csv').addEventListener('click', () => {
    const stand = berekenStand(state.data);
    const regels = [['Positie', 'Speler', 'Gespeeld', 'Winst', 'Gelijk', 'Verlies', 'DV', 'DT', 'Saldo', 'Punten'].join(';')];
    stand.forEach((r, i) => regels.push([i + 1, r.naam, r.gespeeld, r.winst, r.gelijk, r.verlies, r.dv, r.dt, r.saldo, r.punten].join(';')));
    downloadBestand('stand.csv', regels.join('\n'), 'text/csv');
  });
}

async function laden() {
  try {
    const { data, bron } = await laadData({ token: state.token });
    state.data = data;
    state.bron = bron;
    renderAlles();
  } catch (err) {
    melding(`Kon de competitie niet laden: ${err.message}`, 'fout', 0);
  }
}

koppelKnoppen();
toonView(location.hash.replace('#', '') || 'stand');
laden();

// Voor de console/tests: repo-instellingen tonen.
window.OVH = { state, REPO };
