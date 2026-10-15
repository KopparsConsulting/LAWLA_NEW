# Lawla

Webbapp för juridisk rättsutredning, byggd för Cloudflare. Frontenden är en ren yta;
all data och AI ligger i backend-plattformen (`lawla.berge.tech`).

**Produktion:** https://lawla.kopparsconsulting.se

## Vad appen gör

- **Rättsutredning** – stegvis från ärendebeskrivning via klientens frågor, omständigheter och
  rättsfrågor till rättskällor, delanalyser per rättsfråga och en samlad analys. Lawla kan föreslå
  poster i varje steg; juristen väljer vad som läggs till.
- **Rättskällor** – sök och bläddra bland lagar, praxis, förarbeten och doktrin; lägg till avsnitt
  direkt i en utredning.
- **Fråga Lawla** – fri fråga med strömmande svar och källhänvisningar.

## Arkitektur

```
Webbläsare ──► Cloudflare Worker (lawla.kopparsconsulting.se)
                ├─ statiska filer (React-SPA)
                ├─ /auth/*  inloggning, httpOnly-cookie
                └─ /api/*   proxy ──► lawla.berge.tech (Bearer-token från cookien)
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
    investigation/  rättsutredningen och dess steg
    documents/      rättskällor
    ask/            Fråga Lawla
    auth/           inloggning, feature-flaggor
  components/   UI-komponenter, layout, feedback
worker/         Cloudflare Worker (proxy, auth, säkerhet)
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
