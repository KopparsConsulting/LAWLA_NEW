# Lawla

Webbapp för juridisk rättsutredning, byggd för Cloudflare. Frontenden är en ren yta;
all data och AI ligger i backend-plattformen (`lawla.berge.tech`).

**Produktion:** https://lawla.kopparsconsulting.com

## Vad appen gör

- **Rättsutredning** – stegvis från ärendebeskrivning via klientens frågor, omständigheter och
  rättsfrågor till rättskällor, delanalyser per rättsfråga och en samlad analys. Lawla kan föreslå
  poster i varje steg; juristen väljer vad som läggs till.
  Förslagen kan redigeras och styras med egna instruktioner innan de läggs till.
- **Spårbarhet** – hänvisningar i analyserna är klickbara och visar textstället i underlaget.
  Hänvisningar som inte finns bland utredningens källor flaggas, så att juristen kan kontrollera dem.
- **Rapport** – hela utredningen som dokument, att skriva ut som PDF eller ladda ner som Word.
- **Historik** – versioner av ärendet sparas på begäran och automatiskt inför varje analys, med
  jämförelse av vad som ändrats.
- **Rättskällor** – sök och bläddra bland lagar, praxis, förarbeten och doktrin; lägg till avsnitt
  direkt i en utredning, med egen etikett och kommentar.
- **Fråga Lawla** – fri fråga med strömmande svar och källhänvisningar.

## Arkitektur

```
Webbläsare ──► Cloudflare Worker (lawla.kopparsconsulting.com)
                ├─ statiska filer (React-SPA)
                ├─ /auth/*     inloggning, httpOnly-cookie
                ├─ /api/*      proxy ──► lawla.berge.tech (Bearer-token från cookien)
                └─ /history/*  versionshistorik ──► D1 (lawla-history)
```

| Del | Teknik |
|-----|--------|
| Frontend | React 19, React Router, TanStack Query, Tailwind CSS 4 |
| Edge | Cloudflare Workers + Static Assets, `@cloudflare/vite-plugin` |
| Kvalitet | TypeScript strict, ESLint, Vitest, GitHub Actions |

```
src/
  api/          typer (enligt backendens OpenAPI), fetch- och SSE-klient
  features/
    documents/      rättskällor
    ask/            Fråga Lawla
    auth/           inloggning, feature-flaggor
    investigation/  rättsutredningen, dess steg, rapport, historik och källpanel
  components/   UI-komponenter, layout, feedback
  lib/          markdown-tolk, Word-export, formatering
shared/         typer och logik som delas av frontend och Worker (versioner, jämförelse)
worker/         Cloudflare Worker (proxy, auth, säkerhet, versionshistorik)
docs/           driftsättning och önskemål till backend
```

## Komma igång

```sh
npm install
npm run dev        # http://localhost:5173 – Workern körs lokalt i workerd
```

Utan egen `.dev.vars` går lokala anrop mot produktionsbackend. Se `.dev.vars.example`.

| Kommando | |
|---|---|
| `npm run dev` | utvecklingsserver |
| `npm run build` | typkontroll + bygge |
| `npm test` | tester |
| `npm run lint` | lint |
| `npm run deploy` | bygg och deploya till Cloudflare |

Se [docs/DEPLOY.md](docs/DEPLOY.md) för driftsättning och [docs/BACKEND.md](docs/BACKEND.md)
för vad som behövs från backend.
