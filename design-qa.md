# Personal profile design QA

final result: passed

## Evidence and normalization

- Source visual truth: `C:/Users/17335/AppData/Local/Temp/codex-clipboard-687efbf7-77c9-4d36-b2b3-709e2047de9c.png`, 1487×1058 pixels.
- Implementation: `http://localhost:3001/?view=profile`, authenticated, current knowledge base, activity tab, light theme, collapsed system navigation.
- Evidence directory: `C:/Users/17335/.codex/visualizations/2026/11/01/01a19754-a727-7542-8e55-1378292591bf/`.
- Final desktop: `profile-desktop.png`. Measured CSS viewport is 1486×1058; the browser capture canvas is 1565×1114 and includes extra right/bottom surface padding. `profile-desktop-normalized.png` crops that padding to the 1487×1058 reference frame without scaling interface geometry. The one CSS pixel viewport difference is immaterial.
- Full-view comparison: `profile-comparison.png`, source left and implementation right in the same image.
- Focused comparisons: `profile-compare-header.png`, `profile-compare-calendar.png`, `profile-compare-sidebar.png`. Source and implementation regions share the same crop bounds.
- Responsive evidence: `profile-mobile.png`, measured 391×844 CSS viewport; document/body width 391px. Heatmap overflow is contained in its own scroller. Default approximately 643px layout was also inspected.
- Theme evidence: `profile-dark.png`; original light theme and default browser viewport restored after testing.

## Comparison and fixes

1. Initial P2: resource menu buttons followed short titles instead of aligning at the right edge. A direct-child flex rule overrode the content button. Restricted the rule to the menu button; subsequent desktop and dark captures show correct alignment.
2. Initial P2: compact badge wrappers resized OpenMoji images unevenly and emitted Next Image warnings. Removed the wrapper size override and used the shared renderer's explicit size. A fresh browser verification window contains no warnings or errors.
3. Initial P2: narrow layout placed the avatar on a separate line before the complete identity block. Changed the identity flex basis to zero; the 391px capture shows a compact side-by-side portrait/name arrangement with wrapped badges and accessible actions.
4. Initial P2: main inset and small supporting typography drifted from the reference. Adjusted the left/top insets, calendar height, sidebar headings and resource typography. Measured portrait: approximately x=101, y=86, 106×106px. Measured calendar: approximately x=101, y=265, 934×253px. Reference is approximately x=101, y=263, 934×253px.
5. Post-typography P2: folder row content and heading line height made the final saved resource extend below the reference's first viewport. Reduced folder-row vertical padding and set sidebar heading line height to 1.25 to preserve the reference's roughly 50px row rhythm. The final sidebar comparison includes all resource sections at the intended density.
6. Functional P1 found during verification: opening a folder from the profile could retain the knowledge page's old starred filter. Added a scoped folder-target bridge and delegated document/folder activation to the current knowledge owner. Browser verification now opens the actual folder view and document editor on the first click; Back returns to the preserved profile. Added a navigation-owner regression test.

## Required fidelity surfaces

- Fonts/typography: shared system font remains authoritative. Matched 32px identity, 16px tab/calendar heading, 19px sidebar heading, 15px resource/action text, and 13px resource metadata. Long real names/titles wrap or truncate without obscuring controls.
- Spacing/layout: 106px portrait, approximately 7:3 columns, 16px column gap, 934×253px calendar at the source-sized viewport, thin single panel borders, 5–8px panel/control corners. Header and card geometry were compared both in full view and focused crops.
- Colors/tokens: neutral product foreground, shared borders/hover/active states, semantic green activity cells and blue resource icons. Dark colors preserve contrast. No extra theme or custom notification surface was introduced.
- Image/assets: actual account portrait or the shared initial avatar; official local OpenMoji badges; cataloged FA7/Lucide icons; existing user-defined document/folder icons are retained.
- Copy/content: current account and knowledge resources replace the reference's example person, titles, and counts. Dates and daily calculations use Asia/Shanghai. No fictional biography, followers, awards, reactions or gifts are shown as real product data.

## Expected differences and limits

- The reference's example avatar, identity, filled heatmap and example social counts are not production data. Current account data and actual activity determine this page's contents.
- The reference's six-month drawing contains more week columns than a six-month calendar. Implementation uses 183 real days, aligned into 27 weeks, rather than assigning fictional dates to reproduce that density.
- Existing shell chrome, approved icon families, user content icons, and shared interaction tokens are retained. Locked achievements disclose their conditions and actual progress.
- People following/followers and coffee gifting have no existing service. Following/follower counters use an explicit unavailable state, while document/folder subscriptions remain functional. Avatar upload and biography editing are outside existing identity API capabilities.
- Activity is a projection of current business records, not an append-only audit ledger. Removing a reaction/comment/subscription removes its corresponding projected event.

## Verification

- Browser: IAB through CUA; route/title, populated render, no framework overlay, final console error/warn check, visual captures and interaction proof all passed.
- Interactions: account menu → full profile; inline editor validation/cancel; heatmap click/keyboard and exact daily counts; document search; save/un-save and saved filters; unavailable people-following state; document/folder activation and Back; settings open/close returns to profile; light/dark and narrow layout.
- Automated: 18 frontend/calendar/shell tests and 4 real PostgreSQL/HTTP profile tests passed. Integration tests include ACL filtering, actor isolation, invalid input, complete daily counts across pagination, search before pagination, and stale-ACL fail-closed behavior.
- TypeScript frontend/server/shared, icons, lint, i18n, architecture boundaries and production build passed. Temporary test databases were removed by the fixture.
- No actionable P0/P1/P2 findings remain within the implemented feature scope. A second browser engine and real multi-person social/gift services were not exercised.
