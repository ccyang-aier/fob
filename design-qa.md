# Personal profile design QA

final result: passed

2026-11-01 revision addressing the user's five browser annotations. Earlier timeline width restrictions and scroll claims are superseded by the measurements and interaction checks below.

## Annotation fixes

1. **Activity-cell details:** clicking a date opens an anchored day summary with the date, total, documents created, comments posted, comments liked and content followed. Counts come from the complete authorized server projection or the local projection. Opening details keeps the overview; “查看当天活动” explicitly applies a day filter. Outside click and Escape dismiss the surface. A zero-activity date shows four zero counts.
2. **Unused timeline width:** removed the 560px content cap. With collapsed navigation, the timeline measured 942px and its content body 858px; both right edges are at approximately x=1029px. Content and menus now use the available column width.
3. **Scrolling and color:** the profile previously overflowed a fixed workbench panel with no scroll owner. Added a full-height profile viewport and the existing page-scroll restoration marker. Actual wheel input reached the final event at scrollTop 354px in the expanded desktop layout. Switching work pages preserved that position. Ctrl/Meta + Home/End now pass through to native page navigation, while bare Home/End retain tab/date behavior. Creation, comment, like and follow content uses blue, violet, rose and green type colors with pale labels and colored nodes.
4. **One resource-row background:** content and its adjacent menu opt into the shared group interaction surface. With a menu open, the parent row measured rgb(239,239,239); both content and menu-button backgrounds were transparent. The two actions remain separate accessible buttons.
5. **Text-only more links:** all three resource-section “更多” buttons contain zero SVG icons.

## Rendered verification

- Browser: authenticated IAB via CUA, existing localhost profile route and current knowledge-base scope. Default CSS viewport 1488×917; narrow viewport measured approximately 410×888. No alternate browser runner was used.
- Correct route, account, real activity and resources rendered without a framework error overlay. The final fresh-reload console window contains no warnings or errors.
- Clicked October 25: 3 documents, 0 comments, 0 likes, 0 followed items. Overview remained visible. Applied the explicit day filter and verified the three actual events, then cleared it.
- Clicked October 26: all four categories and the total were zero. Escape returned to the date trigger.
- Opened the real resource menu and verified the unified active row and all text-only more controls.
- Used actual wheel input to reach the final desktop event; switched work pages and observed the preserved position. At narrow width, bare End selected the saved tab, bare Home returned to activity, and Ctrl+End kept activity selected and reached the page bottom.
- Narrow viewport: scroll container 803px high, approximately 2010px content, maximum scrollTop 1207px. The final saved document was visible. The 244px day-summary surface remained inside the viewport.
- Inspected light and dark material, type colors and the summary surface. Original light theme and default viewport were restored.

## Data and engineering checks

- 4 calendar/local tests and 5 real PostgreSQL/HTTP tests passed: 83 assertions. The integration fixture exercises all four event types, excludes a like on an inaccessible target, keeps category totals equal to the total, and verifies identical daily aggregates across pages. Existing annual-window, actor, membership, ACL and input checks also pass. Disposable database cleanup completed.
- Frontend, server and shared TypeScript; full ESLint; icon policy; i18n; architecture boundaries; production build passed. The keyboard-modifier adjustment was checked again in the rendered app and final build.
- No database migration or permission expansion. Calendar day categories are additive fields in the shared response contract. Received likes remain distinct from likes given.
- The live account has creation events; mixed activity counts are covered by the isolated integration fixture. No fictional live activity was inserted. A second browser engine was not exercised.

## Evidence

Directory: `C:/Users/17335/.codex/visualizations/2026/11/01/01a19754-a727-7542-8e55-1378292591bf/`.

- `profile-review-overview.jpg`: final light desktop, full-width colored timeline and text-only more links.
- `profile-review-day-details.jpg`: real clicked-day detail.
- `profile-review-resource-row.jpg`: unified row while its menu is expanded.
- `profile-review-scroll-bottom.jpg`: final event reached with the wheel.
- `profile-review-mobile.jpg`: narrow clicked-day summary.
- `profile-review-mobile-bottom.jpg`: last saved resource reached with Ctrl+End.
- `profile-review-dark.jpg`: dark timeline and day summary.

Native browser captures are stored outside the repository. Earlier `profile-timeline-*` and `profile-compact-*` captures describe prior revisions.
