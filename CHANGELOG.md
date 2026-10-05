# Punch List changelog

The current version shows at the bottom of the app and on the sign-in screen,
so you can always tell which build is live. Each entry lists the files to
replace in the GitHub repo.

## v1.3.0 (2026-10-05) Quick add by photo and voice
- New **Quick add** button: one tap opens the camera, then you tap the mic and say it, for example "electrician, room 104, fix outlet, by Friday".
- The sentence fills in trade, room (matched against that hotel's room list), priority, due date, sub and description. Chips show what it heard; anything it guessed is marked, and everything stays editable.
- Understands spoken room numbers ("one oh four", "two fourteen"), dates ("tomorrow", "by Friday", "next Monday", "October 12", "in two days", "end of the week") and priority words (critical, urgent, high priority, low priority).
- **Default subs** per hotel and trade (Projects, then Subs). Picking a trade, or saying "electrician," fills in Assigned to.
- **Save & next** keeps the room selected so you can walk a floor quickly.
- Fix: "today" and "overdue" now use your local date instead of the UTC date (it flipped to tomorrow in the evening).
- Files: `index.html`, `app.js`, `style.css`

## v1.2.0 (2026-10-04) Email / report
- New **Email / report** button in the filter bar.
- Send what's on screen, the whole project, or one trade. Open items by default, with an option to include closed.
- Optional note to the sub, optional photo links, grouped by floor and room, items numbered so subs can reply "#3 done".
- **Open email app** pre-fills To, Subject and the list. Long lists are copied to the clipboard instead (mail apps cut off long links) so you just paste.
- **Copy text** and **Print / PDF** (with photos) for the formal version.
- Each trade's or assignee's email address is remembered on that browser after the first send.
- Version number shown in the app, and the page files are loaded with a version tag so browsers pick up new builds.
- Files: `index.html`, `app.js`, `style.css`

## v1.1.0 (2026-10-04) Rooms
- Room list per project (Projects, then Rooms), with ranges like `101-130` and common areas.
- Room dropdown on items, Floor and Room filters, and a By room view.
- Files: `index.html`, `app.js`, `style.css`

## v1.0.1 (2026-10-04) Sign-in fix
- Security rules now let each signed-in person read their own access entry, so the "Almost there" screen works instead of an error.
- Files: `firestore.rules` (publish in the Firebase console)

## v1.0.0 (2026-10-04) First Firebase version
- Google and email/password sign-in, access list, multiple projects, items with photos, Team panel.
- Files: all
