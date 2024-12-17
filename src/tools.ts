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
      activityType?: string;
      socialStyle?: string;
      activityLevel?: string;
      cuisineTypes?: string[];
      diningStyle?: string;
      priceRange?: string;
      interests?: string[];
      budget?: string;
      transportation?: string;
      schedule?: string;
      location?: string;
      ageRange?: string;
      groupSize?: string;
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
        // Activity preferences
        activityType: z.string().optional().describe("Indoor/Outdoor/Both"),
        socialStyle: z.string().optional().describe("Solo/Group/Both"),
        activityLevel: z
          .string()
          .optional()
          .describe("Active/Relaxed/Moderate"),

        // Food preferences
        cuisineTypes: z
          .array(z.string())
          .optional()
          .describe("Preferred cuisine types"),
        diningStyle: z
          .string()
          .optional()
          .describe("Fine dining/Casual/Quick service/Street food"),
        priceRange: z.string().optional().describe("Budget/Moderate/Expensive"),

        // Interests and hobbies
        interests: z
          .array(z.string())
          .optional()
          .describe("Arts/Sports/Entertainment/Learning"),

        // Practical constraints
        budget: z.string().optional().describe("Overall budget constraints"),
        transportation: z
          .string()
          .optional()
          .describe("Car/Public transit/Walking"),
        schedule: z.string().optional().describe("Available times/days"),
        location: z.string().optional().describe("Preferred location/area"),

        // Demographics
        ageRange: z.string().optional().describe("Age range category"),
        groupSize: z
          .string()
          .optional()
          .describe("Number of people in group (small/medium/large)"),
      }),
    }),
  });

  return [upsertMemoryTool];
}
