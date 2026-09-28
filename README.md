# OVH Competitie

Webapp voor de vrijdagcompetitie van OVH. Iedereen kan de stand bekijken; de beheerder uploadt na de wedstrijd
de teamindeling (screenshot uit de Shake-app of geplakte tekst/CSV), vult de uitslag in en de stand wordt
automatisch bijgewerkt.

**Regels:** winst 3 punten, gelijkspel 1, verlies 0 – voor iedere speler van dat team. Per speler worden ook
doelpunten voor (DV), doelpunten tegen (DT) en het saldo bijgehouden. De stand is gesorteerd op punten, daarna
saldo, daarna DV.

Live: `https://datalution-nl.github.io/Speeltuin/` (na het aanzetten van GitHub Pages, zie hieronder).

## Voor de beheerder (Mark)

1. Open de site, ga naar **Instellingen** en plak het GitHub-token (eenmalig per telefoon/computer).
2. Na de wedstrijd: **Invoer** → speeldag staat al op de eerstvolgende vrijdag → upload de gedeelde
   Shake-afbeelding (of plak *Share Teams as Text/CSV*).
3. Controleer de teams: gele namen zijn onzeker herkend, onbekende namen koppel je aan een speler of voeg je toe
   als gast. Met `→`/`←` verplaats je iemand die op het laatste moment is gewisseld.
4. Vul de score in (Rood – Blauw) en klik **Opslaan**. De stand op de site is binnen ongeveer een minuut bijgewerkt.

Eerdere uitslagen wijzig of verwijder je via **Speeldagen**. Nieuwe vaste spelers voeg je toe onder **Instellingen**.

## Eenmalige installatie (Arjen)

### 1. GitHub Pages aanzetten
Repository → *Settings* → *Pages* → *Build and deployment* → *Source*: **GitHub Actions**. Bij de eerstvolgende
push naar `main` draait `.github/workflows/pages.yml` de tests en publiceert de site.

### 2. Token voor de beheerder
Alle data staat in `data/competitie.json`; de app schrijft daar via de GitHub API naartoe. Daarvoor is een
*fine-grained personal access token* nodig:

- GitHub → *Settings* → *Developer settings* → *Personal access tokens* → *Fine-grained tokens* → *Generate new token*
- *Repository access*: **Only select repositories** → `Speeltuin`
- *Permissions* → *Repository permissions* → **Contents: Read and write** (verder niets)
- Kies een lange geldigheid (bijv. 1 jaar, tot het einde van het seizoen)

Geef het token privé door aan Mark (of laat Mark een eigen GitHub-account maken, voeg hem toe als collaborator
en laat hem zelf zo'n token aanmaken). Het token wordt alleen in de browser van de beheerder bewaard.

Het repository moet **publiek** zijn (GitHub Pages) of een betaald plan hebben voor Pages op een privé-repo.

## Hoe het werkt

- `index.html`, `css/style.css`, `js/app.js` – de app (statische site, geen build-stap).
- `js/standings.js` – stand berekenen en wedstrijden valideren (pure functies).
- `js/parse.js` – teksten/CSV/OCR-uitvoer omzetten naar teams en namen koppelen aan het roster (met tolerantie
  voor OCR-fouten; "Wesley" zonder H/L blijft bewust onzeker).
- `js/ocr.js` – tekstherkenning in de browser met Tesseract.js (`vendor/tesseract`, wordt pas geladen bij een upload).
- `js/github.js` – lezen/schrijven van `data/competitie.json` via de GitHub Contents API.
- `data/competitie.json` – seizoensschema (38 vrijdagen), roster en alle uitslagen. Handmatig aanpassen kan ook:
  gewoon het bestand in GitHub bewerken.

### Datamodel
```json
{
  "datum": "2026-09-25",
  "teams": [
    { "naam": "Rood",  "spelers": ["rene", "thomas"], "doelpunten": 5 },
    { "naam": "Blauw", "spelers": ["pim", "mark"],    "doelpunten": 7 }
  ],
  "opmerking": ""
}
```
Spelers die niet in een wedstrijd staan waren afwezig. Gasten die nog niet in het roster staan worden bij het
opslaan automatisch als gast toegevoegd.

## Ontwikkelen

```sh
npm test                    # unit tests (node:test, geen dependencies)
python3 -m http.server 8080 # lokaal bekijken op http://localhost:8080
```
Zonder token laadt de app de gepubliceerde `data/competitie.json`; met token leest en schrijft hij rechtstreeks
in de `main`-branch van de repo (`REPO` in `js/github.js`).
