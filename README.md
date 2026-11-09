# Codear Budget

A household budgeting app that runs entirely in the browser.

## Requirements

- A modern browser (Chrome, Firefox, Edge, Safari)
- **One** of these to serve the page locally:
  - Node.js 18+ (no `npm install` needed, there are no dependencies), or
  - Python 3
- An internet connection is optional. It's only used to load the Geist fonts from Google Fonts; without it the app falls back to system fonts.

## Run

```bash
./start.sh            # serves on http://localhost:3000
PORT=8080 ./start.sh  # use a different port
# or
npm start
```

Then open http://localhost:3000 in your browser.

## Notes

- All data (accounts, budgets, lists, login) is stored in the browser's `localStorage`. It stays on that browser and device only. Clearing site data resets the app.
- Cloud sync and the "Cleo" AI assistant only work when the page is hosted as a Claude artifact. When run locally, those features are quietly turned off and everything else works.

## Layout

```
codear-budget/
├── public/
│   ├── index.html      # page markup
│   ├── styles.css      # all styles
│   └── app.js          # all app logic (state, views, events)
├── server.js           # tiny static server, Node built-ins only
├── start.sh            # starts the app with Node or Python
└── package.json
```
