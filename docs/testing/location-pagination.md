# Active location pagination

`GET /rooms` and `GET /common-areas` retain their array response. Each page is
bounded by `limit` (default 500, maximum 2000). When more rows exist, the response
sets `X-Result-Truncated: 1` and `X-Next-Cursor`. Pass that opaque token as
`?cursor=...` (and the same limit, if overriding it) to continue. CORS exposes
these headers to allowed browser origins. No cursor means the first page.

The cursor contains the final row's `(floor.number, number, id)` sort values.
Every page independently applies current catalog status, kind and caller scope.
The id breaks ties across buildings/floors with identical display numbers. A
deleted/archived cursor row does not prevent continuation. Invalid tokens return
400. Traversal is not a frozen snapshot: changes to sort values or access during
loading can change the result; refresh the board to obtain the latest view.

The web helpers drain all pages before exposing a result, deduplicate by location
id and propagate errors/abort without returning a partial board. Existing board
filters, room selectors and overdue-session filtering therefore receive the full
loaded set. A truncated response without a continuation token is an error.

Regression coverage: `api/tests/scenarios/locations.pagination.http.test.ts`
creates more than 500 rooms and common areas in the isolated test database,
checks sort ties, sector restrictions and an overdue session outside page one.
`web/src/api/locationsPagination.test.ts` checks complete loading, later-page
failure, invalid continuation and cancellation.
