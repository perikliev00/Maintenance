# Meridian — Operations studio

## Independent design brief

The product coordinates hotel readiness, people and repairs. Its interface is conceived from that functional model, without reference to previous screenshots, styles, brand graphics or screen arrangements. Existing behavior is inspected only to retain contracts, permissions, state transitions and validation.

## Information architecture

A horizontal workspace bar divides the product into Operations, People & work, Insights and Administration. Each workspace exposes a contextual set of destinations. The signed-in identity and global tools occupy a utility strip. Mobile uses the same workspace model with horizontally scrollable workspace/destination navigation and a searchable workspace finder; it does not reproduce a desktop sidebar in a drawer.

Operations: Home, Live, Rooms, Common areas, Plan, Repairs. People: My Work, Housekeeping, Team, Attendance, Cards. Insights: Analytics, Results, Audit. Administration: Control, Permissions, Settings, Notifications. Server panel grants and module flags remain authoritative, including empty grants; unavailable destinations are omitted. Existing role landing destinations remain unchanged.

## Screen archetypes

- Operational briefing: a typographic introduction, clear current workload measures, a single primary creation action, followed by an actionable queue. Counts describe only the loaded sample unless an API provides totals.
- Work session: the current job is the principal object; subsequent assignments form an ordered queue. Synchronization and conflicts remain close to the action affected.
- Exception monitor: attention is the leading section, active work is a separate full-width section, and recent events form a chronological record. Interactive summary filters use explicit labels and pressed state.
- Resource workspace: filters sit above a data surface; the selected room, repair or person opens a focused detail workspace. Controls are grouped around intent rather than imitating the old composition.
- Administrative editor: section navigation, coherent labeled field groups and a persistent save result. Draft/conflict/save semantics are retained.
- Analysis: questions and reporting period precede measures, visualizations and export actions.
- Authentication: a product masthead followed by a centered access workspace and an original code-native orbit graphic. Device activation is a distinct enrollment form with a concise contextual introduction.

## Visual system

Ink/navy establishes structure; cobalt identifies the principal action and current destination. White and cool silver form the canvas. Teal, amber and crimson express success, caution and errors with text labels. Body text uses a local system sans-serif stack at 16px; large editorial headings establish page hierarchy. A 4px spacing foundation, broad whitespace between sections, fine borders and restrained elevation distinguish workspaces. Corner radii are moderate rather than pill-shaped everywhere. No proprietary illustrations, icons, photographs or hero asset are reused.

Suggested tokens: ink #14213b; cobalt #3159eb; canvas #f4f6fb; surface #ffffff; border #d9e0ec; muted #53647e; success #087461; warning #925500; danger #b42d42. Tokens must be contrast-checked in light/dark states. Status never depends on color alone.

## Interaction and accessibility

Preserve keyboard-native buttons, inputs, tables and forms. Use visible focus rings, explicit labels, aria-current for active destinations, aria-pressed for filters, status announcements for saved/queued outcomes and alerts for failures. Busy actions prevent duplicate submission. Reduced-motion settings suppress decorative transitions. Small screens preserve actions and readable data using single-column flow and local table scrolling.

## Preserved workflow contract

Login, invitation redemption and device fingerprints retain their existing API behavior. Reception issue reporting retains catalog/custom paths, priority and room-block confirmation, duplicate detection with reasoned override, validation and refresh warnings. The live monitor retains stale/offline detection, category filters, server/fetch timestamps, deep links, session completion rules, attention pagination and event history. My Work retains cleaning start/complete rules, inspection findings, notes, optimistic offline queues, pending-sync guards, conflicts, repair lifecycle permissions and cursor pagination. No database, API or production configuration changes are required.

## Review boundary

Visual independence is assessed against the earlier application only after the new design is implemented. Industry-standard forms, tables, tabs and status indicators are not treated as proprietary. A visual comparison cannot establish freedom from intellectual-property or contractual risk.

## Implemented screen architecture

| Surface | New composition | Behavior retained |
| --- | --- | --- |
| Sign in | Product masthead, original orbit illustration and access workspace | Credential defaults, login request, error/loading states, theme and device activation link |
| Activate device | Enrollment introduction and grouped invitation/account form | URL code prefill, code normalization, password validation, device label/fingerprint, redeem and login handoff |
| Home | Briefing with explicitly sample-scoped measures, expandable report composer and full-width issue ledger | All catalog/custom fields, optional description, unusual priority warning, readiness confirmation, duplicate override reasons, ticket metadata and lifecycle actions |
| Live | Exception queue first, interactive workload filters, session ledger with elapsed time, completion record, expandable event history | All category counts/filters, stale/offline messages, force refresh, timestamps, scope, session completion guards, deep links and attention pagination |
| My Work | Personal workload briefing, current job focus and task/repair ledgers | Assignment ordering, inspection findings, start/complete notes, offline queue guards/conflicts, repair lifecycle and cursor pagination |
| Analytics | Report criteria rail and a question-led analysis canvas, metric register, charts and room risk ledger | Both domains, date presets/refresh, every KPI/sample/comparison, chart data, forecast formula and CSV export |
| Results | Scoped report controls, summary register, hourly activity chart and responsive personnel measure rows | Date/service-type selection, all summary and employee measures, empty states and paging |
| Audit | Search criteria followed by chronological events and a distinct job history surface | Action/entity filters, current/stale state, live/manual refresh, actor/related object/reason and expandable before/after details, job permission |
| Notifications | Reading ledger with All/Unread views and explicit open/dismiss actions | Mark read, mark all, dismiss, navigation and live/cursor refresh; unread view filters loaded items only |
| Daily plan | Three service timeline lanes, disclosed entry/import tools and contextual departure effects | Room/task/source/note details, assignment/shift/category fields, create/remove behavior, JSON/file import, last import, deferred effects and role gates |

All metric counts retain their original units and data sources. Counts created from paginated samples are labeled as loaded values. Analytics trend values additionally have a keyboard-accessible data disclosure. No backend, database, schema, API, offline-command or production configuration was changed for these compositions.

Implementation verification: `npm run build --prefix web` completed successfully after the shared presentation files were added. Browser and full regression evidence is recorded separately by the verification owner; a successful build alone does not establish those outcomes.
