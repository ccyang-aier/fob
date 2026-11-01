# Profile dialog and compact member menu QA

final result: passed

2026-11-02 latest revision. The user explicitly retired the full personal page and requested the early Git popup with a six-month calendar and earned medals. This report supersedes the earlier personal-homepage layout report.

## Flow and reference evidence

The flow under test is: current knowledge workspace -> account menu -> Personal information -> native profile dialog; system-bar Members -> compact directory -> member action menu.

Profile baseline: Git 7e67995, immediately before 6464c2a introduced the full page. The original 440px dialog, 100px gray canvas cover and 62px overlapping avatar were recovered selectively. Current identity validation/write guards are retained. Name input, six-month chart and earned medals are arranged below the identity summary. The full-page route, tabs, timeline and resource rail are retired.

Member reference: user image codex-clipboard-1d72afb6-de51-4556-8c49-c253f7ec521c.png. The oversized result in codex-clipboard-d5fcd830-acb0-4d52-b4d4-2455cc97cdb1.png prompted this revision. The current 352px surface follows the rounded invitation field/button and avatar rows with circular ellipsis. Large repeated headings, access card and bottom management strip were removed. A real generated invitation still produces its own link card; the reference's anonymous file-share status is not fabricated for a knowledge-base invitation.

Mismatch ledger resolved: oversized member surface -> reduced width/padding/row geometry; full profile instead of historical modal -> restored original host/cover; annual calendar -> six-month window; extra chart scrollbar -> constrained last-month grid column; invisible/misplaced date popover -> profile animation no longer creates a transformed fixed-position containing block; responsive sidebar collapse destroyed the modal -> account host remains mounted while its trigger is hidden.

## Environment and checks

Existing authenticated IAB controlled through CUA, localhost:3001, real current knowledge base. Browser plugin skill is not listed; the available CUA browser runtime was used for every browser interaction, with no terminal browser runner. Default CSS viewport 1488x917; narrow CSS viewport approximately 410x888. Temporary viewport override was reset and light theme restored.

| Check | Result | Evidence |
| --- | --- | --- |
| Page identity and meaningful content | Pass | Fob title, existing knowledge URL and actual document list; profile opening leaves URL unchanged |
| Framework overlay | Pass | No overlay after final reload and exercised flows |
| Console health | Pass | Final browser error/warn query returned an empty list |
| Profile sizing | Pass | Native modal width 440px, height about 624px, no content overflow |
| Six-month real calendar | Pass | 184 enabled dates, 2026-05-03 through 2026-11-02, 27 columns, total 6 actual activities |
| Day detail interaction | Pass | November 1 shows 3 document creations and three other category counts of zero; Escape preserves the profile |
| Earned medals | Pass | Only Knowledge gardener is present for this actual account |
| Form and authentication separation | Pass | Empty-name validation, Cancel and focus return; switch-account dialog still renders email/password UI with zero calendar cells |
| Member geometry and interaction | Pass | About 352x227px, actual two-person directory, circular action menu, nested Escape/focus restoration, invalid and duplicate-email feedback |
| Responsive behavior | Pass | Profile about 387x613px and member panel within narrow viewport; desktop/narrow resize preserves open profile across automatic sidebar collapse |
| Light/dark | Pass | Profile cover, identity, calendar and medal inspected in both themes |

## Engineering and limits

- Final pnpm check passed: frontend/server/shared TypeScript, architecture and copied-capability verification, bilingual catalogs, full ESLint/icon policy and production build.
- 31 targeted tests, 201 assertions passed across six files. Includes six-month month-end/leap-year arithmetic and out-of-range counts, retired profile URL/tab/split cleanup, live document hosts, nested popover dismissal and existing member invitation guards.
- Web 3001, business API 8721 and permission workers remain running. No packages, migrations or development fixture data were added. Invitation and ACL backend code was not changed by this revision.
- The actual account has only creation events; zero comment/like/subscription counts are shown truthfully. Name updates and new-member invitations were not submitted in the live workspace. No second browser engine was tested.
- An intermediate hot-reload retained a retired profile tab and showed an error until reload; persisted-tab and URL cleanup are covered by tests and the final fresh-load flow. Acceptance evidence uses the final build, not that intermediate state.

## Evidence

Directory: C:/Users/17335/.codex/visualizations/2026/11/01/01a19754-a727-7542-8e55-1378292591bf/

- profile-modal-desktop.jpg: restored modal in its actual desktop context.
- profile-modal-day-details.jpg: real daily category popover within the native modal.
- profile-modal-dark.jpg: dark profile material and chart.
- profile-modal-mobile.jpg: narrow profile layout.
- members-compact-desktop.jpg: compact current members and invite controls.
- members-compact-mobile.jpg: compact directory within the narrow viewport.

Screenshots remain outside Git. Earlier profile-home and knowledge-members captures describe superseded layouts.
