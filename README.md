# Income Speedometer

A personal PWA. Set a goal, enter monthly 手取り and spending, define your work window, and watch the money move: a bar-graph gauge shows yen saved per work hour against the rate you'd need to hit the deadline, an odometer ticks while you're clocked in, and a timeline shows when you'll actually arrive.

Hobby project, not a product. No backend, no accounts: everything lives in the browser's local storage, with JSON export/import in settings.

## Run locally

```
npm test      # calculation tests
npm start     # http://localhost:8080
```

## Install on a phone

Open the deployed page (GitHub Pages, from `app/`), then "Add to Home Screen". It works offline after the first load.

## How the numbers work

- Saving speed = (手取り − spending) ÷ average monthly work hours. Monthly work hours = window length × work days per week × 4.35.
- The needle rests at zero outside the work window and on non-work days.
- Required speed = remaining gap ÷ work hours left until the deadline.
- Arrival = today plus the work hours needed at the current saving speed, walked forward over the calendar.
- Boosts (dividends, bonus, a stock sale) are one-off entries. They move the odometer and the arrival date but never the needle.
- Investment returns are not modeled.

Layout: `app/` is the PWA, `test/` the calculation tests, `design/` the design canvas working files.

Fonts: Doto and Chakra Petch, both under the SIL Open Font License, self-hosted in `app/fonts/` so the app works offline.
