import { main } from "./cli/mod.ts";

main().catch((err) => {
  console.error("Fatal error:", err);
  Deno.exit(1);
});
