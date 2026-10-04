# Punch List

A shared punch list for hotel construction projects: photos, trade, location,
priority, assigned sub, due date, and status, live across everyone who has
access. Plain HTML/CSS/JS — no build step — backed by Firebase (Firestore +
Storage + Auth).

## Files

| File | What it is |
|---|---|
| `index.html` | Page structure |
| `style.css` | All styling |
| `app.js` | All app logic (auth, data, photos) |
| `firebase-config.js` | Your project's Firebase config — **edit this** |
| `firestore.rules` | Who can read/write which data |
| `storage.rules` | Who can upload/read photos |

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with the Google account you want to own this.
2. **Add project** → name it (e.g. "punch-list") → you can skip Google Analytics, it's not needed here.

## 2. Register a Web App and get your config

1. In the project overview, click the **`</>`** (web) icon to add a web app.
2. Give it a nickname (e.g. "punch-list-web"). You don't need Firebase Hosting checked — you're deploying this yourself.
3. Firebase shows you a `firebaseConfig` object. Copy it into `firebase-config.js`, replacing the `REPLACE_ME` placeholders. It looks like:

   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "punch-list-xxxxx.firebaseapp.com",
     projectId: "punch-list-xxxxx",
     storageBucket: "punch-list-xxxxx.appspot.com",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abc123"
   };
   ```

   These values aren't secret — it's normal to commit this file to GitHub as-is. Access is controlled by the rules files below, not by hiding this config.

## 3. Turn on Authentication

1. In the left sidebar: **Build → Authentication → Get started**.
2. Under **Sign-in method**, enable:
   - **Email/Password** — toggle it on, save.
   - **Google** — toggle it on, pick a support email, save.
3. Under **Settings → Authorized domains**, add the domain(s) you'll deploy to (e.g. `mattsshop.com`, or your GitHub Pages domain). `localhost` is there by default, which is enough for local testing.

## 4. Turn on Firestore

1. **Build → Firestore Database → Create database**.
2. Choose a location close to you (e.g. `us-east1`), and start in **production mode** (the app supplies its own rules — see step 6).

## 5. Turn on Storage

1. **Build → Storage → Get started**.
2. Same location as Firestore is simplest. Start in production mode.

## 6. Deploy the security rules

These decide who can actually read/write data — without them, production mode blocks everyone.

**Easiest (console, no install needed):**
1. Firestore Database → **Rules** tab → paste in the contents of `firestore.rules` → **Publish**.
2. Storage → **Rules** tab → paste in the contents of `storage.rules` → **Publish**.

**Or, with the Firebase CLI** (nice once this is in GitHub, so rules changes are reviewed like code):
```bash
npm install -g firebase-tools
firebase login
firebase init firestore storage   # point it at this folder, pick your existing project
firebase deploy --only firestore:rules,storage:rules
```

## 7. Add yourself as the first owner

The app has no way to bootstrap its own first user — you add yourself once, by hand, then everyone else through the app's **Team** button.

1. Firestore Database → **Data** tab → **Start collection** → collection ID `allowedUsers`.
2. Document ID: your exact sign-in email (e.g. `matt@mattsshop.com`) — must match exactly what you'll sign in with (Google or email/password).
3. Add fields:
   - `name` (string) — your name
   - `role` (string) — `owner`
   - `addedAt` (string) — today's date, anything's fine
4. Save.

## 8. Run it locally to test

Browsers block ES module imports (and Google sign-in popups) from `file://` pages, so serve the folder instead of opening `index.html` directly:

```bash
cd punch-list-app
python3 -m http.server 8080
```

Then open `http://localhost:8080`. Sign in with the account you just added to `allowedUsers` — you should land in the app with your four projects ready to go. Try adding an item with a photo to confirm Storage is wired up.

## 9. Deploy it to your site

This is a static folder — it works on GitHub Pages, Netlify, Firebase Hosting itself, or just uploaded into a folder on your existing site. Whatever you use:

- Serve the whole folder (`index.html`, `style.css`, `app.js`, `firebase-config.js`) from one path.
- Make sure the domain you deploy to is in Firebase's **Authorized domains** (step 3) or Google sign-in will fail there.
- HTTPS is required for Google sign-in to work outside `localhost` — any of the options above give you that automatically.

## 10. Push it to GitHub

```bash
cd punch-list-app
git init
git add .
git commit -m "Punch list app"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

`firebase-config.js` is safe to commit (see step 2). Nothing in this repo is a secret — the real access control lives in `firestore.rules` / `storage.rules` on Firebase's servers, not in this code.

## 11. Add your team

Once you're signed in as the owner, click **Team** in the top bar. Add each person's exact sign-in email (Google account email, or whatever they'll use for email/password) and a name. They can then open the same link, sign in, and start adding/updating items — no separate account creation needed on your end beyond that.

If someone signs in before you've added them, they'll see a screen with their exact email and a copy button — have them send you that so there's no typo.

## Notes for later

- **Removing a photo's storage file** happens automatically when you delete an item or replace its photo — no manual cleanup needed.
- **Archiving a project** (via the `+` next to the project picker) hides it from the picker without deleting its items, in case you need the history later.
- **Costs**: Firebase's free (Spark) tier comfortably covers a tool like this for a small team — Firestore and Storage both have generous daily free quotas. Keep an eye on the console's Usage tab if that ever changes. 
