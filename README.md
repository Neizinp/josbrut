# Rubrik

Ett svenskt, källbaserat nyhetsflöde inspirerat av enkelheten i Brutalist Report. Rubrik hämtar rubrik, tid och kort ingress från respektive RSS-flöde och länkar vidare till originalartikeln. Källor: Omni, SVT Nyheter, Sydsvenskan, Feber, SweClockers och Dagens industri.

## Lokalt

Starta en statisk server från projektmappen:

```sh
python3 -m http.server 8000 --directory docs
```

Öppna `http://localhost:8000`. RSS hämtas i webbläsaren när sidan öppnas eller när du trycker på uppdatera. Webbläsaren sparar ett rullande arkiv för de senaste sju dygnen lokalt.

## Publicering och uppdateringar

GitHub Actions används inte. GitHub Pages publicerar direkt från `main/docs`; RSS hämtas i besökarens webbläsare när sidan öppnas eller uppdateras manuellt. Arkivet sparas per webbläsare och delas inte mellan användare eller enheter. Sidan finns på `https://neizinp.github.io/josbrut/`.

## Lägg till en källa

Lägg till källan i `FALLBACK_SOURCES` i `docs/app.js` med ett unikt id, namn, webbplats och RSS-adress.