import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "./configuration.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "./utils.js";

const storeSchema = z.object({
  preferences: z.object({
    ageRange: z.string().describe("Preferred age range"),
    love: z.array(z.string()).describe("things I love"),
    hate: z.array(z.string()).describe("things I hate"),
    budget: z.string().describe("Preferred budget"),
    location: z.string().describe("Preferred location"),
  }),
});

export function initStore(config?: LangGraphRunnableConfig) {
  async function upsertMemory(
    opts: z.infer<typeof storeSchema>,
  ): Promise<string> {
    const { preferences } = opts;
    if (!config || !config.store) {
      throw new Error("Config or store not provided");
    }
    const configurable = ensureConfiguration(config);
    const store = getStoreFromConfigOrThrow(config);

    // Get existing preferences if any
    const existingMemory = await store.get(
      ["memories", configurable.userId],
      configurable.userId,
    );

    const existingPreferences = existingMemory?.value as z.infer<
      typeof storeSchema
    >;

    await store.put(["memories", configurable.userId], configurable.userId, {
      preferences: {
        ...existingPreferences,
        ...preferences,
      },
    });

    return `Stored preferences ${JSON.stringify(preferences)}`;
  }

  const upsertMemoryTool = tool(upsertMemory, {
    name: "upsertMemory",
    description:
      "a tool to update the user's stored preferences. New preferences will be merged with existing ones. Never remove existing preferences.",
    schema: storeSchema,
  });

  return upsertMemoryTool;
}
