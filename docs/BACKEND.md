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
GET /api/Auth/google?returnUrl=https://lawla.kopparsconsulting.se/auth/callback
```

Efter lyckad inloggning ska backend redirecta till `returnUrl?token=<JWT>`.
Workern lägger då token i en httpOnly-cookie och tar bort den ur adressen.

- Lägg till `https://lawla.kopparsconsulting.se/auth/callback` i tillåtna retur-URL:er
  (och Google Cloud-konsolens redirect-URI:er om backendens callback-adress ändras).
- Godkänn bara retur-URL:er från en vitlista.

## 3. Strömmande samlad analys (önskemål)

`POST /api/Projects/{id}/analyses` returnerar enligt specen en `ProjectAnalysisDto`.
Frontenden skickar `Accept: text/event-stream` och klarar båda varianterna – svarar
backend med SSE (`data: {"type":"content","content":"…"}`) visas texten medan den skrivs.

## 4. Mindre saker

- `RagQueryRequest` saknar `projectId`. Frontenden skickar i dag med ärendets kontext i
  själva frågan. Ett `projectId`-fält skulle ge bättre och billigare svar.
- Swagger-specen saknar `securitySchemes`; lägg gärna till Bearer så att klientkod kan genereras.
- Taggar: den gamla frontenden anropade `/api/Tags`, som inte finns. v2 använder bara
  `tag`-parametern på `GET /api/Documents`.
- CORS behövs inte för v2 – all trafik går server-till-server från Workern.
