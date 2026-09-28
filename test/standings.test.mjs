import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { berekenStand, valideerWedstrijd, volgendeSpeeldag, maakId, formatDatum } from '../js/standings.js';
import { parseTeamsTekst, matchSpeler, koppelTeams, levenshtein } from '../js/parse.js';

const data = JSON.parse(readFileSync(new URL('../data/competitie.json', import.meta.url), 'utf8'));

test('startdata geeft dezelfde puntentotalen als de spreadsheet', () => {
  const verwacht = {
    'Wesley H': 6, Dave: 6, Pim: 7, Rene: 4, Mark: 7, Jeroen: 4, Henry: 4, Andre: 3, Thomas: 3, Luka: 3,
    Stefan: 4, Michel: 1, Werner: 1, 'Wesley L': 1, Jorrit: 4, Bas: 1, Theo: 4, Melvin: 0, Hilbert: 0, Ramon: 0,
  };
  const stand = berekenStand(data);
  assert.equal(stand.length, 20);
  for (const rij of stand) assert.equal(rij.punten, verwacht[rij.naam], rij.naam);
  // Sortering: punten aflopend, dan saldo
  assert.deepEqual(stand.slice(0, 2).map((r) => r.naam).sort(), ['Mark', 'Pim']);
  assert.equal(stand[0].naam, 'Mark'); // Mark saldo +8 (10-3, 7-8, 7-7, 7-5) vs Pim +3 (8-7, 7-7, 7-5)
});

test('punten, DV en DT per speler kloppen', () => {
  const stand = berekenStand(data);
  const mark = stand.find((r) => r.naam === 'Mark');
  assert.equal(mark.gespeeld, 4);
  assert.deepEqual([mark.winst, mark.gelijk, mark.verlies], [2, 1, 1]);
  assert.equal(mark.dv, 10 + 7 + 7 + 7);
  assert.equal(mark.dt, 3 + 8 + 7 + 5);
  assert.equal(mark.saldo, mark.dv - mark.dt);
  assert.deepEqual(mark.perDag, { '2026-09-04': 3, '2026-09-11': 0, '2026-09-18': 1, '2026-09-25': 3 });
  const hilbert = stand.find((r) => r.naam === 'Hilbert');
  assert.equal(hilbert.gespeeld, 0);
  assert.deepEqual(hilbert.perDag, {});
});

test('gastspeler die niet in het roster staat komt in de stand', () => {
  const d = {
    spelers: [{ id: 'bas', naam: 'Bas' }],
    wedstrijden: [{ datum: '2026-10-02', teams: [
      { naam: 'Rood', spelers: ['bas'], doelpunten: 2 },
      { naam: 'Blauw', spelers: ['gast-jan'], doelpunten: 2 },
    ] }],
  };
  const stand = berekenStand(d);
  const gast = stand.find((r) => r.id === 'gast-jan');
  assert.equal(gast.naam, 'Gast Jan');
  assert.equal(gast.gast, true);
  assert.equal(gast.punten, 1);
});

test('sortering: punten, dan saldo, dan DV, dan naam', () => {
  const d = {
    spelers: [{ id: 'a', naam: 'Aad' }, { id: 'b', naam: 'Bob' }, { id: 'c', naam: 'Cor' }],
    wedstrijden: [
      { datum: '2026-10-02', teams: [{ naam: 'R', spelers: ['a'], doelpunten: 5 }, { naam: 'B', spelers: ['b'], doelpunten: 1 }] },
      { datum: '2026-10-09', teams: [{ naam: 'R', spelers: ['c'], doelpunten: 6 }, { naam: 'B', spelers: ['b'], doelpunten: 2 }] },
    ],
  };
  const stand = berekenStand(d);
  assert.deepEqual(stand.map((r) => r.naam), ['Cor', 'Aad', 'Bob']); // beide 3 punten en saldo +4; Cor heeft meer DV
});

test('validatie van een wedstrijd', () => {
  const goed = { datum: '2026-10-02', teams: [
    { naam: 'Rood', spelers: ['bas'], doelpunten: 1 }, { naam: 'Blauw', spelers: ['pim'], doelpunten: 0 }] };
  assert.deepEqual(valideerWedstrijd(goed, data), []);
  const dubbel = { ...goed, datum: '2026-09-25' };
  assert.match(valideerWedstrijd(dubbel, data).join(), /al een wedstrijd/);
  assert.deepEqual(valideerWedstrijd(dubbel, data, { negeerDatum: '2026-09-25' }), []);
  const beide = { ...goed, teams: [{ naam: 'Rood', spelers: ['bas'], doelpunten: 1 }, { naam: 'Blauw', spelers: ['bas'], doelpunten: -1 }] };
  const fouten = valideerWedstrijd(beide);
  assert.match(fouten.join(), /beide teams/);
  assert.match(fouten.join(), /doelpunten/);
});

test('volgende speeldag is de eerste open vrijdag op of na vandaag', () => {
  assert.equal(volgendeSpeeldag(data, '2026-09-28'), '2026-10-02');
  assert.equal(volgendeSpeeldag(data, '2026-09-25'), '2026-10-02'); // 25 sep is al ingevoerd
  assert.equal(volgendeSpeeldag(data, '2027-06-30'), '2027-05-28'); // na het seizoen: laatste open dag
  assert.equal(data.speeldagen.length, 38);
  assert.ok(!data.speeldagen.includes('2026-12-25'));
});

test('hulpfuncties', () => {
  assert.equal(maakId('Wesley H'), 'wesley-h');
  assert.equal(maakId('  René  '), 'rene');
  assert.equal(formatDatum('2026-09-25', { kort: true }), '25 sep');
  assert.equal(levenshtein('wesley', 'wesly'), 1);
});

test('parser: kop per team met één naam per regel (Shake tekst / OCR)', () => {
  const tekst = `OVH\nRood\nBas\nDave\nWesley H\nMark\n\nBlauw\nHilbert\nJeroen\nTheo\n`;
  const r = parseTeamsTekst(tekst);
  assert.deepEqual(r.teams, [
    { naam: 'Rood', spelers: ['Bas', 'Dave', 'Wesley H', 'Mark'] },
    { naam: 'Blauw', spelers: ['Hilbert', 'Jeroen', 'Theo'] },
  ]);
});

test('parser: "Rood: a, b, c" op één regel en sterktes tussen haakjes', () => {
  const r = parseTeamsTekst('Rood: Bas (3), Dave (2)\nBlauw: Theo (1), Pim');
  assert.deepEqual(r.teams, [
    { naam: 'Rood', spelers: ['Bas', 'Dave'] },
    { naam: 'Blauw', spelers: ['Theo', 'Pim'] },
  ]);
});

test('parser: CSV met kopregel en zonder kopregel', () => {
  const met = parseTeamsTekst('Team,Name\nRood,Bas\nRood,Dave\nBlauw,Theo');
  assert.deepEqual(met.teams, [{ naam: 'Rood', spelers: ['Bas', 'Dave'] }, { naam: 'Blauw', spelers: ['Theo'] }]);
  const zonder = parseTeamsTekst('Bas;Rood\nDave;Rood\nTheo;Blauw');
  assert.deepEqual(zonder.teams, [{ naam: 'Rood', spelers: ['Bas', 'Dave'] }, { naam: 'Blauw', spelers: ['Theo'] }]);
});

test('parser: zonder koppen wordt een lege regel niet als teamgrens gezien, maar alles in team 1', () => {
  const r = parseTeamsTekst('Bas\nDave');
  assert.equal(r.teams.length, 1);
  assert.equal(r.teams[0].naam, 'Rood');
});

test('matchen: exact, fuzzy, en Wesley H vs Wesley L blijft onzeker', () => {
  const s = data.spelers;
  assert.equal(matchSpeler('wesley h', s).id, 'wesley-h');
  assert.equal(matchSpeler('Wesly H', s).id, 'wesley-h'); // OCR-fout
  assert.equal(matchSpeler('Melvln', s).id, 'melvin');
  assert.equal(matchSpeler('Jorrlt', s).id, 'jorrit');
  const w = matchSpeler('Wesley', s);
  assert.equal(w.id, null);
  assert.deepEqual(w.suggesties.map((x) => x.id).sort(), ['wesley-h', 'wesley-l']);
  const onbekend = matchSpeler('Johannes', s);
  assert.equal(onbekend.id, null);
  assert.equal(matchSpeler('Bas', s).id, 'bas');
  assert.notEqual(matchSpeler('Bos', s).id, 'bas'); // korte namen: alleen exact
});

test('koppelTeams levert per speler id/zeker/suggesties', () => {
  const r = koppelTeams(parseTeamsTekst('Rood\nBas\nWesley\nBlauw\nTheo'), data.spelers);
  assert.equal(r.teams[0].spelers[0].id, 'bas');
  assert.equal(r.teams[0].spelers[1].id, null);
  assert.equal(r.teams[0].spelers[1].ruw, 'Wesley');
  assert.equal(r.teams[1].spelers[0].zeker, true);
});

test('koppelTeams splitst aan elkaar geplakte OCR-regels', () => {
  const r = koppelTeams({ teams: [{ naam: 'Rood', spelers: ['Bas Hilbert', 'Wesley H Theo', 'Xyz Qrs'] }] }, data.spelers);
  assert.deepEqual(r.teams[0].spelers.map((s) => s.id), ['bas', 'hilbert', 'wesley-h', 'theo', null]);
  assert.equal(r.teams[0].spelers[4].ruw, 'Xyz Qrs');
});

test('parser: OCR-ruis vóór de eerste teamkop en losse lettertjes worden genegeerd', () => {
  const ocr = 'ST r x\nOVH\n       Rood\nBas\nWegley H\nRaMonN\nBlauw\nHilbert\nTheo\n to ie O Cohmms\n';
  const r = parseTeamsTekst(ocr);
  assert.deepEqual(r.teams, [
    { naam: 'Rood', spelers: ['Bas', 'Wegley H', 'RaMonN'] },
    { naam: 'Blauw', spelers: ['Hilbert', 'Theo'] },
  ]);
  const g = koppelTeams(r, data.spelers);
  assert.deepEqual(g.teams[0].spelers.map((s) => s.id), ['bas', 'wesley-h', 'ramon']);
});
