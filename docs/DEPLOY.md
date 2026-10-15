# Driftsättning på Cloudflare

Appen körs som en Cloudflare Worker med statiska filer (Workers Static Assets).
Workern hanterar bara `/api/*` och `/auth/*`; allt annat serveras direkt som SPA.

## Engångsuppsättning

1. **Domän** – `kopparsconsulting.se` måste ligga som zon i samma Cloudflare-konto.
   `wrangler.jsonc` har `lawla.kopparsconsulting.se` som *custom domain*; Cloudflare skapar
   DNS-post och certifikat automatiskt vid första deploy.
2. **API-token** – skapa en token i Cloudflare (mall *Edit Cloudflare Workers*), med
   behörighet till kontot och zonen `kopparsconsulting.se`.
3. **GitHub-hemligheter** i repot (Settings → Secrets and variables → Actions):
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`

Därefter deployar GitHub Actions automatiskt vid push till `main`
(`.github/workflows/ci.yml`). Pull requests byggs och testas men deployas inte.

## Manuellt

```sh
npm ci
npx wrangler login
npm run deploy                     # produktion → lawla.kopparsconsulting.se
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
