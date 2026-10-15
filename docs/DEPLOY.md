# Driftsättning på Cloudflare

Appen körs som en Cloudflare Worker med statiska filer (Workers Static Assets).
Workern hanterar bara `/api/*` och `/auth/*`; allt annat serveras direkt som SPA.

## Automatisk deploy (Workers Builds)

Cloudflare bygger och deployar själv vid varje push till `main`, via Git-kopplingen
i dashboarden. Inga hemligheter behövs i GitHub.

Inställningar under **Workers & Pages → lawla → Settings → Builds**:

| Inställning | Värde |
|---|---|
| Repository | `KopparsConsulting/LAWLA_NEW` |
| Branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

- Worker-namnet i dashboarden måste vara `lawla`, samma som `name` i `wrangler.jsonc`.
- Domänen `lawla.kopparsconsulting.com` kopplas automatiskt vid deploy eftersom zonen
  `kopparsconsulting.com` ligger i samma Cloudflare-konto.
- GitHub Actions (`.github/workflows/ci.yml`) kör bara typkontroll, lint, tester och bygge.

## Manuellt

```sh
npm ci
npx wrangler login
npm run deploy                     # produktion → lawla.kopparsconsulting.com
CLOUDFLARE_ENV=staging npm run deploy   # testmiljö → lawla-staging.<konto>.workers.dev
```

Med Cloudflares Vite-plugin väljs miljö vid bygget via `CLOUDFLARE_ENV`.

## Konfiguration

| Variabel      | Var             | Beskrivning |
|---------------|-----------------|-------------|
| `BACKEND_URL` | `wrangler.jsonc` | Backend-plattformens adress |
| `APP_ORIGIN`  | `wrangler.jsonc` | Appens publika adress (retur-URL för Google) |

Lokalt kan de skrivas över i `.dev.vars` (se `.dev.vars.example`).

## Säkerhet i korthet

- JWT ligger i en `HttpOnly; Secure; SameSite=Lax`-cookie och når aldrig JavaScript.
- Skrivande anrop kräver headern `x-lawla-request: 1` och samma Origin (CSRF-skydd).
- Proxyn släpper bara igenom de endpoints appen använder; admin, pipeline och
  användarhantering blockeras.
- `public/_headers` sätter CSP, `X-Frame-Options` m.m. för de statiska filerna.

## Stänga ner Lovable

När v2 är i drift och verifierad:

1. Exportera ev. befintlig feedback från Supabase-tabellerna `review_comments`/`review_replies`
   om den ska sparas (de är i dag publikt läsbara – stäng dem oavsett).
2. Avpublicera Lovable-projektet *LawLens Pro* och koppla bort Lovable Cloud.
3. Arkivera repot `lawlens-pro`.
