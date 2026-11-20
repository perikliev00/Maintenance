# Independent implementation and design review

Review date: 2026-11-20. Reviewer: a separate agent that did not design or implement the replacement. Comparison baseline: the original tracked `HEAD` source, before this branch's UI changes. The checkout contained earlier uncommitted branding changes; those are outside the replacement's authorship claim.

## Method and evidence

The implementation was designed from the functional specification before this review inspected the old interface. This review then compared original and replacement TSX, original stylesheets and the newly authored presentation system. It checked all 18 panel destinations, authentication/enrollment, principal forms and mutation controls. An AST call inventory helped identify removed callbacks; changed callbacks were also examined manually. This is source-based evidence, not a proof of every possible runtime combination. Automated browser and database results belong in the separate test report.

Rendered before/after screenshot capture remains optional evidence; source comparison and automated regression for the replacement shell are recorded in `test-report.md`.

## Structural comparison

| Area | Original tracked composition | Replacement composition | Assessment |
| --- | --- | --- | --- |
| Application shell | Sticky left sidebar, long flat destination stack, user/session tools in sidebar footer, mobile drawer | Horizontal grouped workspaces, contextual destinations, top utility/account tools, searchable workspace finder | Material information architecture and composition change |
| Sign in / activation | Centered access card with ambient radial glow | Product masthead, editorial introduction, original code-native orbit illustration and enrollment groups | Independent composition; old hero asset is not referenced |
| Home | Issue feed beside always-present reporting panel | Loaded-sample briefing, explicitly opened full-width report composer, full-width work ledger | Distinct hierarchy and interaction |
| Rooms / common areas | Wide operational table with many action cells | Individual location records with readiness, next action, metadata and lifecycle controls | Distinct primary representation; domain fields and actions retained |
| Repairs | Ticket table adjacent to report/history sidebar | Full-width report disclosure, filter context rail, dispatch articles and selected chronology after queue | Distinct primary representation and report placement |
| Live operations | Five summary filters followed by active-session table, completion and attention/history sections | Exception-first queue, session work ledger, completion record and disclosed audit history | Primary work hierarchy and content representation replaced; summary filters are ordinary standard dashboard controls |
| People / attendance / cards | Staff and interval tables; compact wizard surfaces | Identity records, work-time ledger, contextual access studio and staff grant records | Distinct primary representations |
| Permissions / settings / control | Role matrix and horizontal settings tabs; operational sections presented together | Role policy cards, local section navigation, focused forms and workflow selection | Distinct organization with retained per-role and per-section behavior |
| Reports / plan / inbox | Wide reports, event tables and table-based plan sections | Criteria/canvas reporting, personnel measures, chronological audit ledger, service lanes and reading ledger | Distinct primary representations |

## Similarities evaluated

The product retains its legitimate domain vocabulary, room identity, role names, task/ticket states, authorized actions and the same underlying data. Native forms, labeled inputs, tables for genuinely tabular reference data, status indicators, borders, dialogs, tabs/section navigation and summary measures are ordinary interface conventions. Their presence is not by itself a distinctive similarity.

No remaining distinctive screen composition was identified in the source comparison. The replacement does not import the old screen styles or reference the old hero image. Some small functional subcomponents remain because they own field wiring, permission gates or lifecycle actions; their surrounding screen hierarchy and presentation system have changed. Unreferenced legacy assets/styles must be removed only after replacement verification, while preserving unrelated user changes.

## Findings sent for correction

1. **Modal ownership and keyboard behavior:** the new shared lifecycle helper initially queried the global topmost dialog but unconditionally closed each hook's own dialog on Escape. Opening the global finder over a location/form could close both. Each mounted modal should handle keys only while it owns the topmost visible dialog. Focusable controls should exclude inherited `:disabled` state from disabled fieldsets.
2. **Visually hidden legend utility:** the role policy legend uses `sr-only`, but the newly authored styles initially omitted that utility. Add an accessible visually hidden rule or remove the class and intentionally display the legend.
3. **Specification accuracy:** the Repairs inventory should distinguish API-supported parameters from controls actually present in the current UI. Both original and replacement Repairs filters expose status, assignee/mine, SLA and blocking filters. Location/priority filters should not be claimed as retained controls when they did not exist. The location board drains cursor pages rather than exposing a user-operated page navigator.
4. **Chart data alternative:** the Results hourly chart initially exposed only a generic image label to assistive technology. Add a native disclosure with exact hourly values so the graph's data can be read without pointer hover or sight.
5. **Control boundary contrast:** the general separator token was also the only input/select/textarea boundary. Calculated contrast was approximately 1.29:1 on the light surface and 1.59:1 on the dark surface. Use a distinct control-boundary token with at least 3:1 contrast for these unfilled controls, retaining subtle separators for noninteractive surfaces. Suggested measured values were light `#7f8da3` (3.36:1 against white) and dark `#7184a4` (4.19:1 against `#172238`).

## Correction verification

Source re-review confirmed the following corrections: the modal helper now captures its owned dialog and processes keyboard events only while that dialog is topmost; initial focus also checks ownership after the animation-frame delay; inherited disabled controls are excluded with `:disabled`; the missing `sr-only` utility is present; the inventory now describes the actual Repairs filters and location cursor-draining behavior. The Results hourly chart now has an adjacent native disclosure containing exact hour/session values, matching the data-access alternative added to Analytics.

Additional presentation checks sent to the owner: remove unused legacy Google Fonts downloads from `index.html`, synchronize the document language to the active locale, and point the new product at independently drawn install/browser icons under new filenames while retaining pre-existing user assets. These are coherence/accessibility checks, not a claim that the existing assets are proprietary.

No missing legitimate capability, removed mutation handler or altered backend contract was identified in the reviewed changes. `api/src` and `api/prisma` have no task diff. The original API clients, domain hooks, offline command modules and permission catalog are retained. Rendered comparison will be recorded below when isolated screenshots are available.

## Limitations

No visual difference, code review or automated test result can guarantee freedom from intellectual-property or contractual risk. This review evaluates the implementation and visible composition against the supplied engineering task; it is not a legal determination or an asset-provenance audit of unrelated pre-existing user files.
