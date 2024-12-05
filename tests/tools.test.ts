import { InMemoryStore } from "@langchain/langgraph";
import { initializeTools } from "../src/memory_agent/tools.js";

describe("Tools", () => {
  describe.skip("findPlaces", () => {
    it("should find places", async () => {
      const tools = initializeTools();
      const result = await tools[1].invoke({
        input: "restaurants in San Francisco",
      });
      expect(result).toBe("Found 10 places near San Francisco");
    });
  });
  describe("upsertMemory", () => {
    it("should upsert a memory", async () => {
      const memStore = new InMemoryStore();
      const tools = initializeTools({
        store: memStore,
      });
      const result = await tools[0].invoke({
        content: "User expressed interest in learning about French.",
        context:
          "This was mentioned while discussing career options in Europe.",
        memoryId: "123",
      });
      expect(result).toBe("Stored memory 123");
    });
  });
});
