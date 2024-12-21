import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "./configuration.js";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "./utils.js";

/**
 * Initialize tools within a function so that they have access to the current
 * state and config at runtime.
 */
export function initializeTools(config?: LangGraphRunnableConfig) {
  /**
   * Upsert a memory in the database.
   * @param preferences The user preferences to store
   * @returns A string confirming the memory storage.
   */
  async function upsertMemory(opts: {
    preferences: {
      activityLevel?: string | null;
      cuisineTypes?: string[] | null;
      interests?: string[] | null;
      budget?: string | null;
      location?: string | null;
    };
  }): Promise<string> {
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

    // Merge existing preferences with new ones
    await store.put(["memories", configurable.userId], configurable.userId, {
      preferences: {
        ...(existingMemory?.value?.preferences || {}),
        ...preferences,
      },
    });

    return `Stored preferences ${JSON.stringify(preferences)}`;
  }

  const upsertMemoryTool = tool(upsertMemory, {
    name: "upsertMemory",
    description:
      "Update the user's stored preferences. New preferences will be merged with existing ones.",
    schema: z.object({
      preferences: z.object({
        cuisineTypes: z
          .array(z.string())
          .optional()
          .describe(
            "Preferred cuisine types example: Italian, Chinese, Japanese, etc",
          )
          .nullable()
          .optional(),

        interests: z
          .array(z.string())
          .optional()
          .describe("Arts/Sports/Entertainment/Learning/etc")
          .nullable()
          .optional(),

        budget: z
          .string()
          .optional()
          .describe("low/medium/high")
          .nullable()
          .optional(),
        location: z
          .string()
          .optional()
          .describe("the address of the user")
          .nullable()
          .optional(),
      }),
    }),
  });

  return [upsertMemoryTool];
}
