import { BaseStore, LangGraphRunnableConfig } from "@langchain/langgraph";
import { initializeTools } from "./tools.js";
import { SystemMessage } from "@langchain/core/messages";
import { UPDATE_USER_MEMORY_PROMPT } from "./prompts.js";
/**
 * Get the store from the configuration or throw an error.
 */
export function getStoreFromConfigOrThrow(
  config: LangGraphRunnableConfig,
): BaseStore {
  if (!config.store) {
    throw new Error("Store not found in configuration");
  }

  return config.store;
}

/**
 * Split the fully specified model name into model and provider.
 */
export function splitModelAndProvider(fullySpecifiedName: string): {
  model: string;
  provider?: string;
} {
  let provider: string | undefined;
  let model: string;

  if (fullySpecifiedName.includes("/")) {
    [provider, model] = fullySpecifiedName.split("/", 2);
  } else {
    model = fullySpecifiedName;
  }

  return { model, provider };
}

export async function updateUserMemory(
  llm: any,
  messages: any[],
  config: LangGraphRunnableConfig,
) {
  const upsertMemoryTool = initializeTools(config);
  const boundLLM = llm.bind({
    tools: upsertMemoryTool,
    tool_choice: "upsertMemory",
  });

  const result = await boundLLM.invoke([
    new SystemMessage({
      content: UPDATE_USER_MEMORY_PROMPT,
    }),
    ...messages,
  ]);
  const toolCalls = result.tool_calls;

  if (!toolCalls) {
    throw new Error("No tool calls found");
  }

  return await Promise.all(
    toolCalls.map(async (tc: any) => {
      return await upsertMemoryTool[0].invoke(tc.args as any);
    }),
  );
}
