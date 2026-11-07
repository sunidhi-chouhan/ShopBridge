import { performDemoReset } from "./demo-reset";
import { nexconnConfigured } from "./nexconn";
import { reseedDemo } from "./store";

// Full local wipe, then the canonical showcase (with Nexconn conversations when keys are set).
const result = await reseedDemo();
if (nexconnConfigured()) {
  await performDemoReset({ actorId: null, actorRole: "seed", client: "cli" });
  console.log("Showcase conversations created in Nexconn.");
}
console.log("ShopBridge demo store is ready.");
if (result.backup) console.log(`Previous data saved to ${result.backup}`);
process.exit(0);
