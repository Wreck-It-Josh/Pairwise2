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
- Joint plans (the Joint tab) are kept on the device until the app is online, then shared between partners (see below).

## Going online (claude.ai artifact)

Publish `public/` as one artifact (`index.html` as the page, `styles.css` and `app.js` as its files) with these capabilities:

```
{ "db": {}, "user": { "scopes": ["profile"] }, "sample": {} }
```

- `db` + `user`: each person's own budget is backed up under their private `data/users/<id>/` path (nobody else, the owner included, can read it). Joint plans live in the shared collections `joint_plans` and `joint_moves`, one document per plan and per money move.
- `profile` scope: shows your partner's name next to the money they added. Only ids are stored, never names.
- `sample`: turns Cleo's AI answers on.

Nothing else needs changing: on first load the app finds the shared store, uploads the joint plans saved on that device once, and from then on both phones see the same plans live.

**Sharing with your partner:** invite her by email **as an Editor**. Under the default rules, people invited from outside your organization at Viewer or Commenter level can read the joint plans but not add money. Do not also share the artifact by public link: that drops an outside Editor's write access.

**Old joint card balances:** if both phones had a balance on the old joint card, only the first one uploaded is added. The other phone shows a note with "Add it" / "It is the same money", so the same bank balance is not counted twice.

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
