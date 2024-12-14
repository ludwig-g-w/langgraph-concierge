// Main graph
import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  END,
  InMemoryStore,
  LangGraphRunnableConfig,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import { ensureConfiguration } from "./configuration.js";
import { QUESTION_PROMPT, SUGGESTION_PROMPT } from "./prompts.js";
import { GraphAnnotation } from "./state.js";
import { getStoreFromConfigOrThrow, splitModelAndProvider } from "./utils.js";
import { z } from "zod";
import { initializeTools } from "./tools.js";

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.7,
  apiKey: process.env.OPENAI_API_KEY,
});

export const NODES = {
  CHECK_KNOWLEDGE: "check_knowledge",
  LOOK_SAVED_MEMORIES: "look_saved_memories",
  ASK_SPECIFIC_QUESTIONS: "ask_specific_questions",
  SAVE_USER_ANSWERS: "save_user_answers",
  GENERATE_SUGGESTIONS: "generate_suggestions",
} as const;

export async function checkKnowledge(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ hasEnoughKnowledge: boolean }> {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  // If we have no memories, we definitely need more information
  if (memories.length === 0) {
    return { hasEnoughKnowledge: false };
  }

  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const result = await llm.invoke([
    {
      role: "system",
      content: `You are an analyzer determining if we have enough information about a user to provide personalized suggestions.
Based on their request and the information we have, determine if we need to ask more questions.

Consider:
1. Do we know their basic preferences (indoor/outdoor, social/solo, etc.)?
2. Do we know their interests (arts, sports, food, etc.)?
3. Do we know their practical constraints (budget, location, timing)?
4. Is the information we have relevant to their current request?

Respond with either "SUFFICIENT" or "INSUFFICIENT" followed by a brief explanation.`,
    },
    {
      role: "user",
      content: `User's Request: ${state.userRequest}

Known Information:
${formattedMemories}`,
    },
  ]);

  const response = result.content.toString().toUpperCase();
  return { hasEnoughKnowledge: response.startsWith("SUFFICIENT") };
}

export async function lookSavedMemories(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ savedMemories: any[] }> {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });
  return { savedMemories: memories };
}

export async function askSpecificQuestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const result = await llm.invoke([
    {
      role: "system",
      content: QUESTION_PROMPT,
    },
  ]);
  return { messages: [result] };
}

export async function saveUserAnswers(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const configurable = ensureConfiguration(config);

  const upsertMemoryTool = initializeTools(config);
  const boundLLM = llm.bind({
    tools: upsertMemoryTool,
    tool_choice: "upsertMemory",
  });

  const result = await boundLLM.invoke(
    [
      {
        role: "system",
        content: `Extract key information from the user's answers and format it for storage`,
      },
      ...state.messages,
    ],
    {
      configurable: splitModelAndProvider(configurable.model),
    },
  );

  return { messages: [result] };
}

export async function generateSuggestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[]; suggestions: string[] }> {
  const tools = [new GooglePlacesAPI(), new TavilySearchResults()];
  const boundLLM = llm.bind({
    tools,
    tool_choice: "auto",
  });

  const memories = state.savedMemories || [];
  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const result = await boundLLM.invoke([
    {
      role: "system",
      content: SUGGESTION_PROMPT,
    },
    {
      role: "user",
      content: `User Information:\n${formattedMemories}\nRequest: ${state.userRequest}`,
    },
  ]);

  // Extract suggestions from the LLM response
  const suggestions = (
    typeof result.content === "string"
      ? result.content
      : JSON.stringify(result.content)
  )
    .split("\n")
    .filter((line: string) => line.trim().length > 0)
    .map((line: string) => line.trim());

  return {
    messages: [result],
    suggestions,
  };
}

export function routeBasedOnKnowledge(
  state: typeof GraphAnnotation.State,
): typeof NODES.LOOK_SAVED_MEMORIES | typeof NODES.ASK_SPECIFIC_QUESTIONS {
  return state.hasEnoughKnowledge
    ? NODES.LOOK_SAVED_MEMORIES
    : NODES.ASK_SPECIFIC_QUESTIONS;
}

export function routeAfterQuestions(
  state: typeof GraphAnnotation.State,
): typeof NODES.SAVE_USER_ANSWERS {
  return NODES.SAVE_USER_ANSWERS;
}

export function routeAfterSaving(
  state: typeof GraphAnnotation.State,
): typeof NODES.CHECK_KNOWLEDGE {
  return NODES.CHECK_KNOWLEDGE;
}

export function checkUserSatisfaction(
  state: typeof GraphAnnotation.State,
): typeof NODES.ASK_SPECIFIC_QUESTIONS | typeof END {
  return state.userFeedback === "satisfied"
    ? END
    : NODES.ASK_SPECIFIC_QUESTIONS;
}

export const builder = new StateGraph({
  stateSchema: GraphAnnotation,
})
  .addNode(NODES.CHECK_KNOWLEDGE, checkKnowledge)
  .addNode(NODES.LOOK_SAVED_MEMORIES, lookSavedMemories)
  .addNode(NODES.ASK_SPECIFIC_QUESTIONS, askSpecificQuestions)
  .addNode(NODES.SAVE_USER_ANSWERS, saveUserAnswers)
  .addNode(NODES.GENERATE_SUGGESTIONS, generateSuggestions)
  .addEdge(START, NODES.CHECK_KNOWLEDGE)
  .addConditionalEdges(NODES.CHECK_KNOWLEDGE, routeBasedOnKnowledge, {
    [NODES.LOOK_SAVED_MEMORIES]: NODES.LOOK_SAVED_MEMORIES,
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
  })
  .addEdge(NODES.LOOK_SAVED_MEMORIES, NODES.GENERATE_SUGGESTIONS)
  // New flow for handling questions and answers
  .addConditionalEdges(NODES.ASK_SPECIFIC_QUESTIONS, routeAfterQuestions, {
    [NODES.SAVE_USER_ANSWERS]: NODES.SAVE_USER_ANSWERS,
  })
  .addConditionalEdges(NODES.SAVE_USER_ANSWERS, routeAfterSaving, {
    [NODES.CHECK_KNOWLEDGE]: NODES.CHECK_KNOWLEDGE,
  })
  .addConditionalEdges(NODES.GENERATE_SUGGESTIONS, checkUserSatisfaction, {
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
    [END]: END,
  });

export const graph = builder.compile({
  checkpointer: new MemorySaver(),
  interruptBefore: [NODES.SAVE_USER_ANSWERS],
});

graph.name = "concierge_agent";
