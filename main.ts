// main.ts: Entry point for the Scryfall MCP server
import { ScryfallServer } from "./src/server.ts";

if (import.meta.main) {
  const server = new ScryfallServer();
  server.run().catch(console.error);
}
