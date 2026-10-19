# Önskemål till backend (lawla.berge.tech)

Lawla v2 är en ren frontend på Cloudflare som pratar med backend via en Worker-proxy.
Det mesta fungerar mot dagens API. Nedanstående behövs för att allt ska fungera fullt ut.

## 1. Feedback-endpoint (krävs för feedback-knappen)

Ersätter feedback-tabellerna som låg i Lovable Cloud/Supabase.

```
POST /api/feedback            (kräver inloggning, Bearer-token)
{
  "description": "string",     // obligatorisk, max ~4000 tecken
  "path": "/utredning/12/analys",
  "priority": "low" | "normal" | "high",
  "userAgent": "string",
  "viewport": "1400x900"
}
→ 201/204
```

- Spara inloggad användares id från token, inte från klienten.
- Listning, statusändring och borttagning (`GET/PATCH/DELETE /api/feedback`) bör kräva admin-roll.
- Inga skärmdumpar skickas automatiskt längre – de kunde innehålla klientuppgifter.

## 2. Google-inloggning till ny domän

Workern skickar användaren till:

```
GET /api/Auth/google?returnUrl=https://lawla.kopparsconsulting.com/auth/callback
```

Efter lyckad inloggning ska backend redirecta till `returnUrl?token=<JWT>`.
Workern lägger då token i en httpOnly-cookie och tar bort den ur adressen.

- Lägg till `https://lawla.kopparsconsulting.com/auth/callback` i tillåtna retur-URL:er
  (och Google Cloud-konsolens redirect-URI:er om backendens callback-adress ändras).
- Godkänn bara retur-URL:er från en vitlista.

## 3. Strömmande samlad analys (önskemål)

`POST /api/Projects/{id}/analyses` returnerar enligt specen en `ProjectAnalysisDto`.
Frontenden skickar `Accept: text/event-stream` och klarar båda varianterna – svarar
backend med SSE (`data: {"type":"content","content":"…"}`) visas texten medan den skrivs.

## 4. Spårbarhet, redigering och historik (önskemål)

Frontenden har byggt dessa funktioner ovanpå dagens API. De blir robustare om backend stödjer dem:

- **Strukturerade källhänvisningar i analyser.** I dag letar frontenden upp lagrum, rättsfall och
  förarbeten i analystexten med mönster och matchar mot underlaget. Om analyserna
  (`LegalIssueAnalysisDto`, `ProjectAnalysisDto`) i stället returnerade en lista
  `citations: [{ text, evidenceId, chunkId, start, end }]` – eller markdown-länkar med
  `evidenceId` – blir spårbarheten exakt i stället för heuristisk. Prompten till modellen bör
  också be den hänvisa till underlaget med samma etiketter (`displayLabel`) som finns i `evidence`.
- **`PUT /api/Projects/{id}/evidence/{eid}`** med `displayLabel` och `annotation`. I dag sparas en
  ändrad kommentar som ny post + borttagning av den gamla (id:t byts).
- **Versionshistorik i backend.** Workern sparar i dag ögonblicksbilder av ärendet i en D1-databas
  på Cloudflare (`worker/history.ts`), eftersom backend saknar versionering. Långsiktigt bör
  ärendets historik ligga hos backend tillsammans med ärendet:
  `GET /api/Projects/{id}/versions`, `POST /api/Projects/{id}/versions {label}`,
  `GET /api/Projects/{id}/versions/{vid}`. Formatet som Workern använder finns i `shared/snapshot.ts`.
- **Export.** Word/PDF skapas i webbläsaren från ärendets data. Om backend vill äga dokumentmallen
  kan `GET /api/Projects/{id}/export?format=docx|pdf` ta över; frontenden skickar då bara vidare.

## 5. Huvudprompt och delning (önskemål)

Två funktioner från ursprungsofferten som frontenden byggt ovanpå Workern i väntan på backendstöd:

- **Huvudprompt (juristens stående instruktion till Lawla för ärendet).** Lagras i dag i D1 av
  Workern (`worker/settings.ts`) och går in i alla förslag som frontenden tar fram via RAG. För
  del- och samlad analys skickar frontenden redan `{ "instructions": "…" }` som kropp till
  `POST /api/Projects/{id}/legal-issues/{iid}/analyze` och `POST /api/Projects/{id}/analyses`.
  Backend ignorerar kroppen i dag – så fort analysprompten tar hänsyn till `instructions` styr
  huvudprompten även analyserna. Bäst vore ett fält `mainPrompt` på projektet
  (`ProjectDetailDto`/`UpdateProjectRequest`) som analyserna alltid använder; då kan Workerns
  lagring tas bort.
- **Delning via unik länk.** Workern fryser rapporten (markdown + de rättskällor som hänvisningarna
  pekar på) i D1 under en slumpmässig token (`worker/share.ts`); `GET /share/view/:token` är öppen
  utan inloggning, länkar kan tidsbegränsas och återkallas. Ärendedata ligger därmed i Koppars
  Cloudflare. Långsiktigt bör backend äga detta: `POST /api/Projects/{id}/shares`,
  `GET/DELETE /api/Projects/{id}/shares/{token}` och en publik `GET /api/shares/{token}` som
  returnerar det frysta innehållet. Formatet finns i `shared/sharing.ts`.

## 6. Mindre saker

- `RagQueryRequest` saknar `projectId`. Frontenden skickar i dag med ärendets kontext i
  själva frågan. Ett `projectId`-fält skulle ge bättre och billigare svar.
- Swagger-specen saknar `securitySchemes`; lägg gärna till Bearer så att klientkod kan genereras.
- Taggar: den gamla frontenden anropade `/api/Tags`, som inte finns. v2 använder bara
  `tag`-parametern på `GET /api/Documents`.
- CORS behövs inte för v2 – all trafik går server-till-server från Workern.
