# Personal profile design QA

final result: passed

2026-11-01 compact revision. The previous oversized layout and its visual acceptance are superseded. The user's latest direction is a compact product-scale page with a fixed twelve-month activity grid and less unused space.

## Latest revision: activity timeline

The user subsequently identified weak visual quality in the activity list. This revision refines that surface while retaining the compact page and annual calendar.

- Replaced the scattered six-column activity row with a time rail and a coherent content body. The rail uses a 1px connector and 7px hollow nodes. More actions align with the preview's right edge.
- Creation titles appear once, inside the preview. Removed the repeated date beneath every document; date headings and exact event times remain. Actual author names remain visible.
- Previews use the shared resource-card material, a 40px semantic document-icon surface, restrained title/author hierarchy and an opening arrow. No extra shadow, scaling or floating motion was introduced.
- Extracted `ActivityEvent` from date grouping and pagination. Comment/reaction/subscription targets remain actionable, with excerpts styled as quotations.
- Actual browser verification: Tab focuses the preview, Enter opens the intended real document, Back restores the profile, and the more-actions menu opens and closes with Escape. A settled keyboard-focus observation measured neutral background `rgb(241,241,241)`, border `rgb(32,32,32)` and no box shadow.
- Narrow layout measured approximately 410×888 CSS viewport, with 258px activity bodies and no content spill within them. More actions remain visible at that width. Dark theme and the normal desktop were inspected; light theme and the default viewport were restored. Fresh console window contains no warnings or errors.
- Evidence in the directory below: `profile-timeline-desktop.png`, `profile-timeline-detail.png`, `profile-timeline-focus.png`, `profile-timeline-mobile.png`, `profile-timeline-dark.png`. These replace the earlier timeline appearance in compact-layout captures.
- Frontend typecheck, scoped ESLint, icon policy and production build passed. This presentation-only revision does not change the activity API, annual date window or navigation owner. The live account contains creation events; other activity types were reviewed in code without adding fake live records.

## Visual target and evidence

- Original UX: `C:/Users/17335/AppData/Local/Temp/codex-clipboard-687efbf7-77c9-4d36-b2b3-709e2047de9c.png` (1487×1058). Retains the profile header, four tabs, approximately 7:3 columns, calendar, timeline, daily summary and resource sections.
- Revised scale follows the user's correction: system 13px body, 76px portrait, 24px name, 32px header actions, 15px sidebar headings, and smaller timeline attachments. No CSS zoom or scaled screenshot was used.
- Activity period follows the user's explicit twelve-month request: 365 real dates, aligned into 53 weekly columns. Leading/trailing padding is hidden and excluded from counts and keyboard targets.
- Evidence directory: `C:/Users/17335/.codex/visualizations/2026/11/01/01a19754-a727-7542-8e55-1378292591bf/`.
- `profile-compact-desktop.png`: actual default 1488×917 CSS viewport, collapsed system navigation, light theme. Calendar measured 951.32×218.56px; cells 13.67px square; horizontal and vertical gaps both 2.99px after device-pixel rounding. Its scroller is 922px wide with 922px content, so no horizontal chart scrollbar is needed.
- `profile-compact-desktop-expanded.png`: the same normal viewport with expanded navigation. The annual grid also fits its narrower card; scroller/content both 768px.
- `profile-compact-mobile.png`: measured approximately 410×888 CSS viewport after a temporary narrow viewport override. The calendar has a 304px scroller and 673px content, with the latest date visible and weekday labels pinned. The page has no material horizontal content spill; browser width rounding measured a one-pixel difference.
- `profile-compact-dark.png`: compact desktop in dark theme, including the header and all sidebar resource sections. Light theme and default viewport were restored afterwards.
- These are native browser captures. Earlier `profile-desktop*` and `profile-comparison*` files document the superseded version and are not acceptance evidence for this revision.

## Corrections verified

1. Replaced stretched weekly `space-between` layout with a continuous fixed-gap grid. Cell size is calculated from the actual calendar container, with uniform 3px horizontal and vertical spacing.
2. Extended both the server query and local projection from 183 to 365 days. The calendar sums only visible dates, and the server includes the first day of the annual window.
3. Removed the oversized profile type/control scale and reduced page, panel, preview-row and attachment spacing directly in their component styles.
4. Prevented month-label min-content widths from widening weekly tracks. The final month label stays inside the last column; the desktop chart has no accidental scrollbar.
5. Kept narrow-screen overflow inside the calendar and used resize observation to position it at the latest date. Date tooltip, selected border and keyboard focus remain visible.

## Behavior and checks

- Fresh authenticated render on the current knowledge base; full profile header and sidebar sections visible; no framework error overlay.
- Selected November 1, moved left with the keyboard to October 25, activated with Enter, and verified the three actual events for that date. Cleared the selection using “全部活动”.
- Inspected expanded/collapsed navigation, desktop, narrow layout, light and dark theme. Fresh verification-window console contains no warnings or errors.
- Calendar unit tests: 4 passed, 38 assertions. Covers 53-week alignment, leap/month boundaries, timezone, annual counts, future padding, streak and local scope.
- Real PostgreSQL/HTTP integration: 5 passed, 41 assertions. Includes day-364 inclusion/day-365 exclusion, actor and ACL filtering, membership/parameter validation, pagination, and stale ACL fail-closed behavior. Disposable database cleanup completed.
- Frontend/server types, icon verification, scoped ESLint, i18n verification, architecture checks and production build passed for this revision. Existing navigation/resource behavior remains covered by the prior implementation's tests and browser evidence.

## Content limits

The current account has six actual creation events across two dates. Empty dates remain empty; the reference's example green activity, person, followers and gifts are not inserted as product data. Existing shell chrome, shared controls, official icon assets and account/resource data remain authoritative. People following, followers and coffee gifts still have no service implementation, as documented in the current feature design. A second browser engine was not exercised.

No actionable P0/P1/P2 finding remains in the compact-layout and annual-calendar revision.
