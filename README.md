# HealthCore

Trainingsbegleiter als Web-App: Muskelauswahl am 3D-Modell, Plangenerator, Übungskatalog mit Fotos und ein
Logbuch, das auch offline funktioniert.

Live: https://orphcvs.github.io/healthcore/

In der Live-Version gibt es keinen Server. Alles, was du einträgst, bleibt nur in deinem Browser.

## Aufbau

- `app/`: die Web-App ohne Framework (ES-Module, Three.js für das 3D-Modell, Service Worker für den Offline-Betrieb)
- `server.py`: optionaler Server nur mit der Python-Standardbibliothek, Login mit scrypt-Hash und Sync zwischen
  Geräten über SQLite
- `tools/`: Skripte, die das 3D-Modell und den Übungskatalog aus den Quelldaten bauen
- `tests/`: Tests für Node und Python

## Lokal starten (mit Server und Sync)

```
python server.py --set-password --data .data      # einmal, Eingabe verdeckt
python server.py --port 8031 --data .data
```

Dann `http://127.0.0.1:8031/healthcore/` öffnen.

## Tests

```
python -m unittest discover -s tests -v
node --test tests/
python -I tools/model/check_model.py app/data
python -I tools/exercises/check_exercises.py app
```

## Modell und Katalog neu bauen

```
cd tools/model && npm ci && cd ../..
python -I tools/model/build_model.py --cache tools/model/cache app/data
python -I tools/exercises/build_catalog.py app/data/exercises.json
python -I tools/exercises/fetch_images.py app/data/exercises.json app/img
```

Übungen werden in `tools/exercises/src/*.py` gepflegt, nicht in der JSON-Datei.

## GitHub Pages

`.github/workflows/pages.yml` veröffentlicht `app/` als statische Seite. Der Workflow setzt dabei
`<meta name="hc-storage" content="local">`, damit die App ohne Server nur lokal speichert, und gibt dem Service
Worker einen neuen Cache-Namen, damit nach jedem Deploy die neuen Dateien ankommen.

## Quellen

3D-Daten: BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 Japan. Übungsfotos: free-exercise-db
(Unlicense). Symbole: Lucide (ISC). Schriften: Mona Sans, IBM Plex Mono (OFL). Logo: eigenes Kachelherz.
