import { LangGraphRunnableConfig } from "@langchain/langgraph";
import { ensureConfiguration } from "./configuration.js";
import { v4 as uuidv4 } from "uuid";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getStoreFromConfigOrThrow } from "./utils.js";
import { GooglePlacesAPI } from "@langchain/community/tools/google_places";

/**
 * Initialize tools within a function so that they have access to the current
 * state and config at runtime.
 */
export function initializeTools(config?: LangGraphRunnableConfig) {
  /**
   * Upsert a memory in the database.
   * @param content The main content of the memory.
   * @param context Additional context for the memory.
   * @param memoryId Optional ID to overwrite an existing memory.
   * @returns A string confirming the memory storage.
   */
  async function upsertMemory(opts: {
    preferences: {
      type: string;
      social: string;
      interests: string[];
      constraints: {
        budget: string;
        location: string;
        timing: string;
      };
    };
    memoryId?: string;
  }): Promise<string> {
    const { preferences, memoryId } = opts;
    if (!config || !config.store) {
      throw new Error("Config or store not provided");
    }

    const configurable = ensureConfiguration(config);
    const memId = memoryId || uuidv4();
    const store = getStoreFromConfigOrThrow(config);

    await store.put(["memories", configurable.userId], memId, {
      preferences,
    });

    return `Stored memory ${memId}`;
  }

  const upsertMemoryTool = tool(upsertMemory, {
    name: "upsertMemory",
    description:
      "Upsert a memory in the database. If a memory conflicts with an existing one, \
      update the existing one by passing in the memory_id instead of creating a duplicate. \
      If the user corrects a memory, update it. Can call multiple times in parallel \
      if you need to store or update multiple memories.",
    schema: z.object({
      memoryId: z
        .string()
        .optional()
        .describe(
          "The memory ID to overwrite. Only provide if updating an existing memory.",
        ),
      preferences: z.object({
        type: z.string().describe("Indoor/Outdoor/Both"),
        social: z.string().describe("Solo/Group/Both"),
        interests: z.array(z.string()).describe("Array of interests"),
        constraints: z.object({
          budget: z.string().describe("Budget"),
          location: z.string().describe("Location"),
          timing: z.string().describe("Timing"),
        }),
      }),
    }),
  });

  return [upsertMemoryTool];
}
