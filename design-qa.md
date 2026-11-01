# Personal homepage design QA

final result: passed

2026-11-02 revision. This report supersedes the earlier four-tab profile, full-width timeline, combined resource sidebar and rich-document-card annotations. The user's final request explicitly removes those tabs and adapts two supplied reference fragments.

## Target and visual comparison

The selected references are `codex-clipboard-a699b101-3082-4a5f-892f-2b5a91decb5f.png` (timeline hierarchy) and `codex-clipboard-8c8b2ee7-f653-446d-bca9-8a89dae97f88.png` (minimal document strip). Both original files were opened alongside the latest browser captures. `profile-home-comparison.jpg` combines the unmodified source fragments with a crop of the actual app in the default unfiltered light state.

The intended adaptations are explicit: the timeline occupies half of the main content below the annual chart, its target/preview moves below the action, and the horizontal document strip becomes a vertical list in the other half. This is not a claim of literal full-page pixel equivalence to the fragments. The app retains its system font scale, official icon catalog, shared card material and real product data.

The resulting layout has a compact identity header, a full annual chart, equal activity/document columns and an independent 288px rail containing only the daily summary and honors. The timeline keeps a fine neutral axis, filled gray nodes, aligned times, colored action icons and restrained previews. Documents use small neutral icon tiles, title/star and update/read metadata, with one feedback surface covering the row and menu. Fixed generic biography, duplicated achievement chips and social placeholders are removed. No unresolved P0/P1/P2 findings were observed for the requested layout and exercised states.

## Rendered verification

- Authenticated IAB through CUA, existing localhost profile route, real account and selected knowledge base. Default CSS viewport 1488×917; system navigation expanded and collapsed both inspected. No alternate browser runner.
- Profile-internal tablists: 0. Native selects: 0. No follow/fan copy in the profile. Workbench tabs remain shell-owned.
- Calendar click on November 1 shows 3 creations and three other category counts of 0. Explicit day filtering shows the three matching events and daily count of 3; clearing restores all six events across two dates.
- The document row menu opens with actual open/star/subscription actions. While expanded, the parent row is rgb(239,239,239), with transparent child content and menu backgrounds. A real document opens, and returning through the existing workbench tab restores the profile.
- The editor is a modal with initial name focus and real identity/email. Empty-name validation, Cancel, Escape, backdrop dismissal and focus return were exercised. No name update was submitted.
- Real wheel scrolling reached the final desktop event. The collapsed desktop profile viewport measured approximately 866px high with 1175px content and maximum scrollTop 309px.
- Narrow CSS viewport approximately 410×888: chart scrolls within itself; activity, documents and both rail cards stack. Profile scroll viewport approximately 803px, content approximately 2061px. Ctrl+End reaches the final honors card. No document-level horizontal overflow.
- Light/dark materials inspected. Original light theme and default viewport restored. The final fresh-reload browser console window contains no warning/error entries and no framework overlay.

## Data and engineering

- Four calendar/local tests and five real PostgreSQL/HTTP tests passed: 91 assertions. Independent document/activity limits and server cursors are covered alongside complete daily aggregates, annual boundaries, principal/member/ACL checks and invalid inputs. Disposable database cleanup completed.
- Frontend TypeScript, production build, full ESLint, centralized icon policy, i18n and architecture checks passed. No new assets, packages, runtime permission grants or database migrations.
- The live account has six documents and creation events. Mixed comment/like/subscription projections and more-than-40-item paging are covered by isolated tests, not invented live content. The browser did not exercise a second engine or submit a nickname update.
- Source reference includes coffee gifting; no corresponding service exists, so this revision adds no synthetic coffee events. File sizes are absent from the existing profile resource contract; real update/read metadata is used instead.

## Evidence

Directory: `C:/Users/17335/.codex/visualizations/2026/11/01/01a19754-a727-7542-8e55-1378292591bf/`.

- `profile-home-desktop.jpg`: final default desktop, expanded system navigation, unfiltered profile.
- `profile-home-collapsed.jpg`: equal columns and chart filling the wider main area.
- `profile-home-comparison.jpg`: source fragments and native actual-app crop in one review board.
- `profile-home-dark.jpg`: dark material and semantic colors.
- `profile-home-mobile.jpg`: compact header, independently scrolling chart and timeline.
- `profile-home-mobile-cards.jpg`: vertically stacked documents, daily summary and honors.
- `profile-home-edit.jpg`: actual native modal editor.

Captures stay outside the repository. Earlier `profile-review-*`, `profile-timeline-*` and `profile-compact-*` captures describe superseded designs. Remaining visual coverage limit: the live account has no mixed activity types, so those projections are validated in isolated data tests rather than shown with fabricated production events.
