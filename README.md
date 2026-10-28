# Rubrik

Ett svenskt, källbaserat nyhetsflöde inspirerat av enkelheten i Brutalist Report. Rubrik hämtar rubrik, tid och kort ingress från respektive RSS-flöde och länkar vidare till originalartikeln. Källor: Omni, SVT Nyheter, Sydsvenskan, Feber, SweClockers och Dagens industri.

## Lokalt

Python 3 behövs för att uppdatera RSS-data. Från projektmappen:

```sh
python3 scripts/fetch_feeds.py
python3 -m http.server 8000 --directory site
```

Öppna `http://localhost:8000`. Hämtaren använder bara Python-standardbiblioteket och fortsätter även om en enskild källa tillfälligt inte svarar.

## Publicering och uppdateringar

GitHub Actions hämtar flöden och publicerar GitHub Pages vid varje push till `main`, en gång i timmen och när arbetsflödet startas manuellt. GitHub Pages är aktiverat för repot med Actions som publiceringskälla. Sidan finns på `https://neizinp.github.io/josbrut/`.

## Lägg till en källa

Lägg till ett objekt i `sources.json` med ett unikt `id`, ett visningsnamn (`name`), en RSS- eller Atom-adress (`url`) och källans webbplats (`home`). Publicera ändringen till `main`; nästa arbetsflödeskörning tar in källan automatiskt.