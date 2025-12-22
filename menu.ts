import { showInteractiveMenu } from "./interactive-menu";

console.log("\n" + "=".repeat(60));
console.log("📋 PUMP.FUN BUNDLER - INTERACTIVE MENU");
console.log("=".repeat(60));

showInteractiveMenu().catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});


