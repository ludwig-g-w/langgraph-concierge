import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { AIMessage, BaseMessage, ToolMessage } from "@langchain/core/messages";
import {
  END,
  interrupt,
  LangGraphRunnableConfig,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { ensureConfiguration } from "./configuration.js";
import {
  QUESTION_PROMPT,
  SUGGESTION_PROMPT,
  SYSTEM_PROMPT,
} from "./prompts.js";
import { GraphAnnotation } from "./state.js";
import { initializeTools } from "./tools.js";
import { getStoreFromConfigOrThrow } from "./utils.js";

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 1,
  apiKey: process.env.OPENAI_API_KEY,
});

export const NODES = {
  CHECK_KNOWLEDGE: "check_knowledge",
  LOOK_SAVED_MEMORIES: "look_saved_memories",
  ASK_SPECIFIC_QUESTIONS: "ask_specific_questions",
  SAVE_USER_ANSWERS: "save_user_answers",
  GENERATE_SUGGESTIONS: "generate_suggestions",
  USER_ANSWER: "user_answer",
  TOOLS: "tools",
  GET_USER_FEEDBACK: "get_user_feedback",
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

Respond with either "SUFFICIENT" or "INSUFFICIENT"`,
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

export async function askSpecificQuestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const result = await llm.invoke([
    {
      role: "system",
      content: QUESTION_PROMPT(formattedMemories),
    },
    ...state.messages,
  ]);
  return { messages: [result] };
}

export function userAnswer(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  interrupt({
    value: "userAnswer",
  });
  return { messages: [] };
}

export async function saveUserAnswers(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const lastMessage = state.messages[state.messages.length - 1];
  const configurable = ensureConfiguration(config);
  if (lastMessage.getType() !== "human") {
    console.log("Last message is not a human message", lastMessage.getType());
    throw new Error("Last message is not a human message");
  }
  const upsertMemoryTool = initializeTools(config);
  const boundLLM = llm.bind({
    tools: upsertMemoryTool,
    tool_choice: "upsertMemory",
  });

  const result = await boundLLM.invoke([
    {
      role: "system",
      content: `Extract key information from the user's answers and format it for storage. Use ${configurable.userId} as memoryId`,
    },
    lastMessage,
  ]);

  console.log("result", JSON.stringify(result, null, 2));

  const toolCalls = result.tool_calls;

  if (!toolCalls) {
    throw new Error("No tool calls found");
  }

  const savedMemories = await Promise.all(
    toolCalls.map(async (tc) => {
      return await upsertMemoryTool[0].invoke(tc.args as any);
    }),
  );

  return { messages: savedMemories };
}
const tools = [
  new GooglePlacesAPI(),
  new TavilySearchResults({
    maxResults: 3,
  }),
];

export async function generateSuggestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);

  const boundLLM = llm.bind({
    tools,
    tool_choice: "auto",
  });

  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const result = await boundLLM.invoke([
    new AIMessage({
      content: SYSTEM_PROMPT,
    }),
    new AIMessage({
      content: SUGGESTION_PROMPT(
        formattedMemories,
        state.userRequest as string,
        new Date().toISOString(),
      ),
    }),
    ...state.messages,
  ]);

  return {
    messages: result,
  };
}

export function routeBasedOnKnowledge(
  state: typeof GraphAnnotation.State,
): typeof NODES.GENERATE_SUGGESTIONS | typeof NODES.ASK_SPECIFIC_QUESTIONS {
  return state.hasEnoughKnowledge
    ? NODES.GENERATE_SUGGESTIONS
    : NODES.ASK_SPECIFIC_QUESTIONS;
}

export function checkUserSatisfaction(
  state: typeof GraphAnnotation.State,
): typeof NODES.ASK_SPECIFIC_QUESTIONS | typeof END | typeof NODES.TOOLS {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls?.length) {
    return NODES.TOOLS;
  }

  return state.userFeedback?.toLowerCase() === "satisfied"
    ? END
    : NODES.ASK_SPECIFIC_QUESTIONS;
}

export const builder = new StateGraph({
  stateSchema: GraphAnnotation,
})
  .addNode(NODES.CHECK_KNOWLEDGE, checkKnowledge)
  .addNode(NODES.ASK_SPECIFIC_QUESTIONS, askSpecificQuestions)
  .addNode(NODES.USER_ANSWER, userAnswer)
  .addNode(NODES.SAVE_USER_ANSWERS, saveUserAnswers)
  .addNode(NODES.TOOLS, new ToolNode(tools))
  .addNode(NODES.GENERATE_SUGGESTIONS, generateSuggestions)
  .addEdge(START, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.ASK_SPECIFIC_QUESTIONS, NODES.USER_ANSWER)
  .addEdge(NODES.USER_ANSWER, NODES.SAVE_USER_ANSWERS)
  .addEdge(NODES.SAVE_USER_ANSWERS, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.TOOLS, NODES.GENERATE_SUGGESTIONS)
  .addConditionalEdges(NODES.CHECK_KNOWLEDGE, routeBasedOnKnowledge, {
    [NODES.GENERATE_SUGGESTIONS]: NODES.GENERATE_SUGGESTIONS,
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
  })
  .addConditionalEdges(NODES.GENERATE_SUGGESTIONS, checkUserSatisfaction, {
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
    [END]: END,
    [NODES.TOOLS]: NODES.TOOLS,
  });

export const graph = builder.compile({
  interruptAfter: [NODES.GENERATE_SUGGESTIONS],
  checkpointer: new MemorySaver(),
});

graph.name = "concierge_agent";
