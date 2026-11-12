// These URLs are loaded by Vite in page.evaluate, outside the Node test module graph.
// Their implementation is typechecked separately in web/tsconfig.tests.json.
declare module "/src/*";
// Execute the next setup or assertion step for this scenario.
declare module "/tests/*";
// Session/CSRF step exercising auth lifecycle.
declare module "/@react-refresh";
