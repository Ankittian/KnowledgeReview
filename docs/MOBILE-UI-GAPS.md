# Mobile UI and functionality gaps

**Tested:** 2026-11-15 against https://ask-spectrum.forceintellect.com, signed in as `admin`.
**Devices:** Playwright Chromium emulating Pixel 7 (412 px wide) and iPhone SE (320 px wide), touch enabled.
**Pages covered:** login, signup, 404, Today, Progress, Browse, Leaderboard, Assistant (chat), Account, and every Admin tab. I also opened the command menu and revealed one flashcard.

**Not tested (so nothing in production was changed):**
- Submitting a review or feedback, sending a chat message, changing a user's role or deleting a user.
- Signup submission.
- Real iOS Safari or Android Chrome. The emulator does not reproduce the on-screen keyboard, browser-bar `100vh` behaviour, or iOS input zoom. Items marked *(verify on device)* need a real phone.
- Dark mode.

Screenshots are in `docs/mobile-gaps/`. Code pointers come from a quick read of the source and are suggestions, not confirmed fixes.

**Status (2026-11-15):** P1 items 1-3 have code fixes in the working tree (not yet deployed or re-tested on a device). See each item for the change.

Severity: **P1** breaks a core task, **P2** clearly degraded, **P3** polish.

---

## P1: Core flows broken

### 1. Today: the flashcard is wider than the screen and its text is cut off
- The card extends past the right edge (widest element 470 px on a 412 px screen, 521 px on a 320 px screen). After "Reveal", the **left part of the answer is clipped** (`pixel7-today-back-viewport.png`: "…ase Organization is a named buying unit…").
- On iPhone SE the Reveal click was intercepted by the card's tag row (Playwright: "`div.flex.flex-wrap` … intercepts pointer events"), so the card could not be flipped by tapping it.
- Screenshots: `iphoneSE-today-viewport.png`, `pixel7-today-back-viewport.png`.
- **Likely cause:** the breadcrumb badge ("Material Management › Freight Orders › Freight Order Mapping") cannot shrink. `components/deck/Flashcard.tsx:44` uses `max-w-[70%] truncate` inside a grid cell (`[grid-area:1/1]`) with no `min-w-0`, so the cell grows to fit the full text.
- **Fix:** add `min-w-0` to the card face and grid cell, and let the breadcrumb wrap or ellipsize at `max-w-full`.
- **Done:** the flip grid in `Flashcard.tsx` and `StatementCard.tsx` now uses `grid-cols-[minmax(0,1fr)]`, and the breadcrumb badges have `min-w-0`.

### 2. Assistant (chat): the message box is partly hidden behind the bottom navigation
- On `/chat` the "Ask a question about SpectrumERP…" composer sits under the fixed bottom tab bar. Only the top half of the box and the send button are visible (`pixel7-chat-viewport.png`).
- **Likely cause:** the chat screen fills the viewport but does not account for the bottom nav. `components/shell/AppShell.tsx:24` reserves `pb-24` for ordinary pages, and the chat layout (`components/chat/ChatApp.tsx`) does not.
- **Real cause:** the Flashcards banner sits above the chat but outside its fixed height calculation, so the chat was taller than the space left and the composer was pushed under the nav.
- **Done:** `chat/page.tsx` and `chat/[id]/page.tsx` now give the banner and chat a shared fixed-height column on phones, and `ChatApp` fills the remaining space. *(verify on device with the keyboard open.)*

### 3. Progress and Browse: every card is about 527 px wide, so the whole page scrolls sideways
- `/progress` ("Needs revisiting" cards) and `/browse` (card grid) overflow by 130 px on Pixel 7 and 223 px on iPhone SE (page scroll width 542 px).
- Effects: the header, stat cards and chart sit at about 75% of the width with a blank strip on the right, and cards are cut off at the right edge. The page can be swiped sideways.
- Screenshots: `pixel7-progress.png`, `iphoneSE-browse.png`.
- **Likely cause:** the same unshrinkable breadcrumb badge as item 1 (`components/browse/BrowseCard.tsx:141`, and the Progress revisit card), inside grid items without `min-w-0` (`app/(app)/progress/page.tsx:205`).
- **Fix:** add `min-w-0` to the `<li>` and card, and ellipsize the breadcrumb.
- **Done:** the Browse and Progress grids use `grid-cols-1` (a shrinkable track) on phones, and the Browse breadcrumb badge has `min-w-0`.

---

## P2: Clearly degraded

### 4. Floating chat button covers content on Today
- The round chat button (`components/chat/ChatWidget.tsx:195`, `fixed right-5 bottom-28`) sits on top of the answer buttons ("Known and correct", "New to me", …) after a reveal (`pixel7-today-back-viewport.png`). It blocks taps on the right side of those buttons.
- **Fix:** hide it while a card is revealed or the feedback sheet is open, or place it where it never overlaps the action buttons.

### 5. Admin tables are clipped, with no sign that they scroll
- "What needs change" (`/admin/health`): the **Verdict** column is cut off ("Verdi…", "con…"), and the area filter overlaps its own label ("Fi|All areas"). See `pixel7-admin_health.png`.
- The admin tab strip is cut off at "Team knowledge", with no fade or arrow showing it scrolls.
- **Fix:** show these tables as stacked cards below `md`, or wrap them in a horizontal scroller with an edge fade. Stack the filter row on small screens.

### 6. Command menu is cramped
- The jump menu (search icon) is cut off at the bottom ("What needs…" with its description overlapping, `pixel7-cmdmenu.png`).
- **Fix:** cap the height with `max-h-[70dvh]` and an internal scroll, and hide row descriptions below `sm`.

### 7. Form fields under 16 px will make iOS Safari zoom the page on focus *(verify on device)*
- Detected 55 fields under 16 px on Admin → Users (role selects), 4 each on Browse, Account and Admin → All chats, 2 on chat, and 1 each on signup, Admin health and Settings.
- **Likely cause:** `components/ui/select.tsx` uses `text-sm` (14 px) with no mobile override. `components/ui/input.tsx` already uses `text-base md:text-sm`, which is the right pattern.
- **Fix:** apply `text-base md:text-sm` to select triggers.

---

## P3: Polish

### 8. Touch targets under 44 px
Measured on both devices (guideline is 44×44 px, 40 px minimum):

| Control | Size |
|---|---|
| Top bar icons (search, theme, account, sign out) | 32×32 |
| Logo / home link | 28×28 |
| Chat "Open chat list", banner "Dismiss" | 32×32, 24×24 |
| Chat "Review", "Answer style" | 63×28, 109×28 |
| Filter chips (Leaderboard, Today "Functional/Technical/Both") | 28 px tall |
| Admin tab strip | 36 px tall |
| Progress "Show answer" links | 20 px tall |
| "Request an account" / "Sign in" links on auth pages | 18 px tall |
| Admin role select + Save | 28 px tall |

### 9. Desktop wording on touch screens
- The card front says "Click or press **Space** to reveal" (`Flashcard.tsx:100`, `StatementCard.tsx:86`). The Reveal button hides its "Space" hint on touch (`hide-touch`), but the card text doesn't. Another card type already says "Tap the card to read the description", so the wording is inconsistent.
- **Fix:** use "Tap to reveal" on touch devices.

### 10. Small text
- 9 elements under 12 px on chat, 26 on Admin → What needs change, 38 on Admin → Feedback (code paths, badges, metadata). Raise to at least 12 px.

### 11. Sign-in lands on the Assistant
- Signing in as `admin` on a fresh session opened `/chat`, not `/today`, on both devices. This may be intentional (remembered last page or an admin default). Please confirm; if not, mobile users land in an empty chat instead of today's deck.

---

## Checked and fine
- Login, signup and 404: no horizontal overflow, readable.
- Leaderboard, Account and Admin Settings/Team: no horizontal overflow.
- Bottom tab bar: six tabs fit and the active tab is clear.

## Suggested order
1. One fix for items 1 and 3: `min-w-0` plus a wrapping breadcrumb in the three card components.
2. Chat composer offset (item 2).
3. Hide or move the floating button (item 4).
4. Admin tables as cards (item 5), then select font size, touch targets and wording.
5. Re-run this check on a real iPhone and Android phone after the fixes.
