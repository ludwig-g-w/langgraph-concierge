// Define the configurable parameters for the agent

import { Annotation, LangGraphRunnableConfig } from "@langchain/langgraph";
import { MEMORY_PROMPT, SYSTEM_PROMPT } from "./prompts.js";

export const ConfigurationAnnotation = Annotation.Root({
  userId: Annotation<string>(),
  model: Annotation<string>(),
  systemPrompt: Annotation<string>(),
});

export type Configuration = typeof ConfigurationAnnotation.State;

export function ensureConfiguration(config?: LangGraphRunnableConfig) {
  const configurable = config?.configurable || {};
  return {
    userId: configurable?.userId || "default",
    model: configurable?.model || "gpt-4o-mini",
    memoryPrompt: configurable?.systemPrompt || MEMORY_PROMPT,
  };
}
