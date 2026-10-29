// `wrangler types` only knows the ADMIN_TOKEN secret when a local .dev.vars file lists it. Declaring it
// here, with the same type, makes typecheck pass with and without that file (a clean clone has none).
// At runtime the value can still be missing, so code that reads it must allow `undefined`.
interface Env {
  ADMIN_TOKEN: string;
}
