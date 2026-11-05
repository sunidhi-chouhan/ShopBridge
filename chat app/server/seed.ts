import { reseedDemo } from "./store";

const result = await reseedDemo();
console.log("ShopBridge demo store is ready.");
if (result.backup) console.log(`Previous data saved to ${result.backup}`);
