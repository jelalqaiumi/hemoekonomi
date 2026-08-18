# Lärdomar

Teamets minne. Varje fel som gjorts i det här projektet står här, tillsammans
med en regel som ska hindra att det görs om.

**Regler för filen**

- Bara fel som faktiskt inträffat. Inget tyckande, inga gissningar.
- Radera aldrig en post. Slå ihop dubbletter om det blir rörigt.
- "Regel framåt" måste gå att följa bokstavligt av någon som inte var med.
- Har samma fel dykt upp 3 gånger — gör om det till ett automatiskt test
  och skriv `LÖST MED TEST` i posten.

**Mall**

```
### YYYY-MM-DD — <område>: <kort titel>
**Vad gick fel:** <konkret, en mening>
**Varför:** <grundorsaken, inte symtomet>
**Regel framåt:** <handlingsbar instruktion>
```

---

## Poster

<!-- Nya lärdomar läggs till här nedanför, nyast sist. -->

### 0000-00-00 — exempel: så här ser en post ut
**Vad gick fel:** Appen kraschade när användaren lämnade sökfältet tomt.
**Varför:** Ingen validering av tom input innan värdet skickades vidare.
**Regel framåt:** Validera alltid användarinput innan den används — tom sträng,
för lång sträng och fel typ ska hanteras explicit och testas.

<!-- Radera exempelposten ovan när du fått din första riktiga lärdom. -->
