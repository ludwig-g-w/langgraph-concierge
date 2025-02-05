import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "./configuration.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "./utils.js";

const storeSchema = z.object({
  ageRange: z.string().optional().describe("Preferred age range"),
  love: z.array(z.string()).optional().describe("things I love"),
  hate: z.array(z.string()).optional().describe("things I hate"),
  budget: z.string().optional().describe("Preferred budget"),
  location: z.string().optional().describe("Preferred geographical location"),
});

export function initStore(config?: LangGraphRunnableConfig) {
  async function upsertMemory(
    opts: z.infer<typeof storeSchema>,
  ): Promise<string> {
    if (!config || !config.store) {
      throw new Error("Config or store not provided");
    }
    const configurable = ensureConfiguration(config);
    const store = getStoreFromConfigOrThrow(config);

    const existingMemory = await store.get(
      ["memories", configurable.userId],
      configurable.userId,
    );

    const existingPreferences = existingMemory?.value ?? {
      ageRange: "",
      love: [],
      hate: [],
      budget: "",
      location: "",
    };

    console.log("existingPreferences", existingPreferences);
    console.log("opts", opts);

    await store.put(["memories", configurable.userId], configurable.userId, {
      ...existingPreferences,
      ...opts,
    });

    return `updated preferences: ${JSON.stringify({
      ...existingPreferences,
      ...opts,
    })}`;
  }

  const upsertMemoryTool = tool(upsertMemory, {
    name: "upsertMemory",
    description:
      "one tool to update the user's stored preferences. New preferences will be merged with existing ones. Never remove existing preferences only add new ones or update existing ones.",
    schema: storeSchema,
  });

  return upsertMemoryTool;
}
