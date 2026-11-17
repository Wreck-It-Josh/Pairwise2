# Pairwise

A household budgeting app that runs entirely in the browser.

## Requirements

- A modern browser (Chrome, Firefox, Edge, Safari)
- **One** of these to serve the page locally:
  - Node.js 18+ (no `npm install` needed to run the app; the only dependency is for the Cleo function on Netlify), or
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

## Going online (Netlify + Supabase)

With a free Supabase project the app gets real accounts, a cloud backup of each person's budget, and joint plans shared live between partners. Without it (empty `public/config.js`) everything stays on the device, as before.

**1. Create the database**

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor > New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.

**2. Connect the app**

In Supabase, copy the **Project URL** (shown under **Connect**, or **Project Settings > Data API**) and the **Publishable key** (**Project Settings > API Keys**, starts with `sb_publishable_`) into [`public/config.js`](public/config.js). On older projects the publishable key is called the legacy **anon public** key, and either one works. This key is designed to be public. The row level security rules in the schema make sure people can only read their own budget and their own household's plans. Never put a **Secret** key (`sb_secret_...`, or the legacy `service_role` key) in the app or in Netlify.

**3. Deploy to Netlify**

Connect the repo, or drag the `public` folder onto app.netlify.com/drop. [`netlify.toml`](netlify.toml) already sets the publish folder to `public` with no build command.

**4. Point Supabase's emails at your site**

In Supabase, open **Authentication > URL Configuration**:
- Set **Site URL** to your Netlify address, for example `https://your-site.netlify.app`.
- Add the same address under **Redirect URLs**, plus `http://localhost:3000` if you also test locally.

Confirmation emails and password-reset links then open the app.

By default Supabase asks new users to confirm their email before they can log in. To turn that off while testing, go to **Authentication > Providers > Email > Confirm email**. Supabase's built-in email sender is limited to a few messages an hour. Before inviting real users, add your own SMTP provider under **Authentication > Emails**.

**How partners link:** on the **Joint** tab, one person taps **Create invite code** and shares it. The other enters it and taps **Join**. A household holds two people. Plans either partner saved on their own device before linking are uploaded once.

**What is stored where**

| Table | Contents | Who can see it |
|---|---|---|
| `budgets` | the whole personal budget, as one JSON document | only its owner |
| `profiles` | display name, household | you and your partner |
| `households` | invite code | its members |
| `joint_plans`, `joint_moves` | shared plans and the money added to them | both partners. Only the person who added an entry can delete it. |

Each person's budget syncs between their devices when the app opens or comes back to the front. If the same budget is edited on two phones at the same time, the copy saved last wins. Joint plans are stored one row per entry, so partners never overwrite each other.

**5. Turn on Cleo's AI answers (optional)**

Cleo's AI answers come from a Netlify Function, [`netlify/functions/cleo.mjs`](netlify/functions/cleo.mjs), served at `/api/cleo`. It keeps your Anthropic API key on the server, only answers people who are signed in to Pairwise, and streams the reply back to the chat.

1. Create an API key at [console.anthropic.com](https://console.anthropic.com). Under **Billing > Limits**, set a monthly spend limit. Every question is a paid call to Claude Opus 5.5, and that limit is your real cap.
2. In Netlify, go to **Site configuration > Environment variables** and add:
   - `ANTHROPIC_API_KEY`: your key
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY`: the same two values as in `public/config.js`
   - `CLEO_HOURLY_LIMIT` (optional): questions per person per hour, default 30. The limit is best-effort, since it resets when Netlify restarts the function.
3. Redeploy. Netlify installs `@anthropic-ai/sdk` from `package.json` and bundles the function automatically. This works with a Git-connected deploy or the Netlify CLI, but drag-and-drop deploys don't include functions.

Until those variables are set, or when you run the app locally with `npm start`, Cleo falls back to her built-in quick answers.

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
pairwise/
├── public/
│   ├── index.html      # page markup
│   ├── styles.css      # all styles
│   ├── app.js          # all app logic (state, views, events)
│   ├── config.js       # Supabase URL + anon key (empty = device-only mode)
│   ├── vendor/supabase.js  # supabase-js 2.118.0 client, bundled so no CDN is needed
│   └── icon-light.svg, icon-dark.svg  # favicons, swapped with the theme
├── netlify/functions/cleo.mjs  # Cleo's AI answers (checks Supabase login, calls Claude)
├── supabase/schema.sql # database tables, security rules and household functions
├── netlify.toml        # Netlify settings (publish public/, no build)
├── server.js           # tiny static server, Node built-ins only
├── start.sh            # starts the app with Node or Python
└── package.json
```
