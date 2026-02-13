# Vliegweer

Kleine webapp (HTML/CSS/JS) voor vliegweer-info.

## Code aanpassen

1. Open het project in je editor.
2. Pas de bestanden aan die je nodig hebt (`index.html`, `style.css`, `app.js`, enz.).
3. Test lokaal door `index.html` te openen in je browser (of via een lokale server).

## Veranderingen committen en pushen

Gebruik in de terminal:

```bash
git status
git add .
git commit -m "Beschrijf kort wat je hebt aangepast"
git push origin <jouw-branch>
```

### Handige checks

- Controleer je branch: `git branch --show-current`
- Bekijk wat je exact commit: `git diff --staged`
- Als `git push` faalt omdat de branch nog niet bestaat op remote:

```bash
git push -u origin <jouw-branch>
```

## Werken met Pull Requests (aanbevolen)

Voor teamwerk is dit meestal de flow:

```bash
git checkout -b feature/mijn-aanpassing
# code wijzigen
git add .
git commit -m "Nieuwe feature of fix"
git push -u origin feature/mijn-aanpassing
```

Open daarna op GitHub een Pull Request van `feature/mijn-aanpassing` naar `main`.
