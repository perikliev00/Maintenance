// Playwright test runner APIs for browser E2E scenarios.
import { expect, test } from "@playwright/test";
// Define an individual test case.
test.beforeEach(async ({ page }) => {
  // Await async work before asserting or releasing locks.
  await page.route("**/__scenario", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><main id='root'></main>" }));
  // Drive the browser through the user-visible workflow step.
  await page.goto("/__scenario");
  // Await async work before asserting or releasing locks.
  await page.evaluate(async () => {
    // refresh: synchronize actors so the race window is observable.
    const refresh = await import(/* @vite-ignore */ String("/@react-refresh"));
    // Session/CSRF step exercising auth lifecycle.
    refresh.default.injectIntoGlobalHook(window);
    // Session/CSRF step exercising auth lifecycle.
    Object.assign(window, { $RefreshReg$: () => {}, $RefreshSig$: () => (type: unknown) => type, __vite_plugin_react_preamble_installed__: true });
  });
});
// Case: reconnect catch-up and busy event update visible screen.
test("reconnect catch-up and busy event update visible screen", async ({ page }) => {
  // Await async work before asserting or releasing locks.
  await page.evaluate(async () => {
    // Bind w for later setup or assertions in this scope.
    const w = window as any;
    // Execute the next setup or assertion step for this scenario.
    w.streams = []; w.streamCalls = 0;
    // Execute the next setup or assertion step for this scenario.
    window.fetch = (async (_input: any, init: any) => {
      // Execute the next setup or assertion step for this scenario.
      w.streamCalls++;
      // Return the arranged value/result to the caller.
      return new Response(new ReadableStream({ start(controller) { w.streams.push(controller); init?.signal?.addEventListener("abort", () => { try { controller.close(); } catch {} }); } }), { status: 200 });
    // Execute the next setup or assertion step for this scenario.
    }) as typeof fetch;
    // Await async work before asserting or releasing locks.
    w.harness = (await import(/* @vite-ignore */ "/tests/browserHarness.tsx")).mountLiveRefresh();
  });
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("value")).toHaveText("initial");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.harness.server("during-disconnect"); w.streams[0].enqueue(new TextEncoder().encode('event: connected\ndata: {"ok":true}\n\n')); });
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("value")).toHaveText("during-disconnect");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.harness.busy(true); });
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("busy")).toHaveText("true");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.harness.server("changed-while-busy"); w.streams[0].enqueue(new TextEncoder().encode('event: ticket.changed\ndata: {"ticketId":"ticket"}\n\n')); });
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => (window as any).harness.busy(false));
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("value")).toHaveText("changed-while-busy");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.harness.server("missed-on-real-reconnect"); w.streams[0].close(); });
  // Await async work before asserting or releasing locks.
  await expect.poll(() => page.evaluate(() => (window as any).streamCalls)).toBe(2);
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => { const w = window as any; w.streams[1].enqueue(new TextEncoder().encode('event: connected\ndata: {"ok":true}\n\n')); });
  // Assert browser/UI outcome matches the scenario intent.
  await expect(page.getByTestId("value")).toHaveText("missed-on-real-reconnect");
  // Await async work before asserting or releasing locks.
  await page.evaluate(() => (window as any).harness.stop());
});
// Case: split UTF-8/CRLF preserves Bulgarian; subscribers share stream and cancel reconnect.
test("split UTF-8/CRLF preserves Bulgarian; subscribers share stream and cancel reconnect", async ({ page }) => {
  // result: synchronize actors so the race window is observable.
  const result = await page.evaluate(async () => {
    // Bind w for later setup or assertions in this scope.
    const w = window as any; const controllers: ReadableStreamDefaultController[] = []; let calls = 0; let aborts = 0;
    // Bind fetchOriginal for later setup or assertions in this scope.
    const fetchOriginal = window.fetch;
    // Execute the next setup or assertion step for this scenario.
    window.fetch = (async (_input: any, init: any) => { calls++; return new Response(new ReadableStream({ start(c) { controllers.push(c); init?.signal?.addEventListener("abort", () => { aborts++; try { c.close(); } catch {} }); } })); }) as typeof fetch;
    // Await async work before asserting or releasing locks.
    const { subscribeLiveEvents } = await import(/* @vite-ignore */ "/src/api/liveEvents.ts");
    // Execute the next setup or assertion step for this scenario.
    const a: any[] = []; const b: any[] = [];
    // Bind offA for later setup or assertions in this scope.
    const offA = subscribeLiveEvents((event: any) => a.push(event)); const offB = subscribeLiveEvents((event: any) => b.push(event));
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 0));
    // Bind bytes for later setup or assertions in this scope.
    const bytes = new TextEncoder().encode('event: ticket.changed\r\ndata: {"ticketId":"Стая Жълта"}\r\n\r\nevent: location.changed\ndata: {"locationId":"България"}\n\nevent: cleaning.changed\ndata: {"taskId":"incomplete"}');
    // Iterate to cover variants or wait until a condition holds.
    for (const byte of bytes) controllers[0]!.enqueue(new Uint8Array([byte]));
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 10));
    // Execute the next setup or assertion step for this scenario.
    offA(); const afterOne = aborts;
    // Brief yield so lock waiters/UI can settle before asserting.
    controllers[0]!.enqueue(new TextEncoder().encode('\n\n')); await new Promise(r => setTimeout(r, 10));
    // Brief yield so lock waiters/UI can settle before asserting.
    controllers[0]!.close(); await new Promise(r => setTimeout(r, 0)); offB();
    // Brief yield so lock waiters/UI can settle before asserting.
    await new Promise(r => setTimeout(r, 1100)); window.fetch = fetchOriginal;
    // Return the arranged value/result to the caller.
    return { calls, aborts, afterOne, a, b };
  });
  // Assert response/page reached the expected status.
  expect(result.calls).toBe(1); expect(result.afterOne).toBe(0);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.a.map(e => [e.type, e.ticketId ?? e.locationId])).toEqual([["ticket.changed", "Стая Жълта"], ["location.changed", "България"]]);
  // Assert browser/UI outcome matches the scenario intent.
  expect(result.b.map(e => e.type)).toEqual(["ticket.changed", "location.changed", "cleaning.changed"]);
});
