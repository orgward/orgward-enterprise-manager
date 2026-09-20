# Mobile UI regression receipt

- Checked at: `2026-09-18T19:38:41Z`
- Browser: Chromium `153.0.8010.12`
- Emulation: Playwright iPhone 13, portrait, 390 CSS px wide
- Routes: `/` and `/sdlc.html`
- Result: **PASS**

## Defects reproduced and corrected

1. A completed enterprise blueprint still displayed the empty workspace because the component's `display: grid` rule overrode the HTML `hidden` state.
2. The mobile header's intrinsic width expanded the layout viewport from 390 to 448 CSS px.
3. Completed discovery consumed a full phone viewport before the saved blueprint.
4. Phone controls and SDLC actions included touch targets below 44 CSS px.
5. The graph-first phone map was too dense for reliable touch exploration.
6. `Map.groupBy` and secure-context-only `crypto.randomUUID` could disable actions on older Safari or plain-HTTP phone access.

## Browser assertions

| Surface | Assertion | Result |
|---|---|---|
| Enterprise design | Saved blueprint visible; empty state hidden | PASS |
| Enterprise design | Interactive map opens in List mode | PASS |
| Enterprise design | Select object and render detail | PASS |
| Enterprise design | Switch List → Graph → List | PASS |
| Enterprise design | 32 persisted map rows rendered | PASS |
| Autonomous SDLC | Context tab responds | PASS |
| Autonomous SDLC | Assurance tab responds | PASS |
| Autonomous SDLC | New governed change responds | PASS |
| Both | `scrollWidth === innerWidth === 390` | PASS |
| Both | No visible target below 44 × 44 CSS px | PASS |
| Both | No console or uncaught page errors | PASS |

The normal repository check was rerun after the correction: **33 passed, 0 failed, 0 skipped**.
