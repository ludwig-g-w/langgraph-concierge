import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { InMemoryCache } from "@langchain/core/caches";
import { AIMessage } from "@langchain/core/messages";

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
  CHECK_FOR_KNOWLEDGE_PROMPT,
  QUESTION_PROMPT,
  SUGGESTION_PROMPT,
} from "./prompts.js";
import { GraphAnnotation } from "./state.js";
import { initializeTools } from "./tools.js";
import { getStoreFromConfigOrThrow } from "./utils.js";
import { z } from "zod";

const llm = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  temperature: 0.5,
  apiKey: process.env.OPENAI_API_KEY,
  maxTokens: 1000,
  cache: new InMemoryCache(),
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
  BEFORE_STATE_CHECK: "before_state_check",
} as const;

export async function checkKnowledge(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  if (state.userRequest.length < 5) {
    throw new Error("User request is too short");
  }

  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memory = await store.get(
    ["memories", configurable.userId],
    configurable.userId,
  );

  // If we have no memories, we definitely need more information
  if (!memory) {
    return { hasEnoughKnowledge: false };
  }

  const schema = z.object({
    hasEnoughKnowledge: z.boolean(),
  }) as any;

  const result = await llm.withStructuredOutput(schema).invoke([
    {
      role: "system",
      content: CHECK_FOR_KNOWLEDGE_PROMPT,
    },
    {
      role: "user",
      content: `User's Request: ${state.userRequest} <memories>${JSON.stringify(memory.value)}</memories>`,
    },
  ]);

  return { hasEnoughKnowledge: result.hasEnoughKnowledge };
}

export async function askSpecificQuestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memory = await store.get(
    ["memories", configurable.userId],
    configurable.userId,
  );
  const memories = memory ? [memory] : [];

  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const result = await llm.invoke([
    ...state.messages,
    {
      role: "system",
      content: QUESTION_PROMPT(formattedMemories),
    },
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
) {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage.getType() !== "human") {
    console.log("Last message is not a human message", lastMessage.getType());
    throw new Error("Last message is not a human message");
  }
  const upsertMemoryTool = initializeTools(config);
  const boundLLM = llm.bind({
    tools: upsertMemoryTool,
    tool_choice: "upsertMemory",
  });

  const result = await boundLLM.invoke(state.messages);
  const toolCalls = result.tool_calls;

  if (!toolCalls) {
    throw new Error("No tool calls found");
  }

  await Promise.all(
    toolCalls.map(async (tc) => {
      return await upsertMemoryTool[0].invoke(tc.args as any);
    }),
  );
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

  const memory = await store.get(
    ["memories", configurable.userId],
    configurable.userId,
  );
  const memories = memory ? [memory] : [];

  const formattedMemories = memories
    .map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
    .join("\n");

  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage.getType() === "tool") {
    // FIXME: Zod is not working here, so we need to use a different approach
    const llmWithStructuredOutput = await llm.withStructuredOutput({
      name: "suggestions",
      description: "List of personalized activity suggestions for user",
      parameters: {
        type: "object",
        properties: {
          suggestions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: {
                  type: "string",
                  description: "Title of the suggested activity",
                },
                description: {
                  type: "string",
                  description: "Detailed description of the activity",
                },
                location: {
                  type: "string",
                  description: "Location where the activity takes place",
                },
                url: {
                  type: "string",
                  description: "URL with more information about the activity",
                },
                time: {
                  type: "string",
                  description: "Suggested time for the activity",
                },
              },
              required: ["title", "description", "location", "url", "time"],
            },
          },
        },
        required: ["suggestions"],
      },
    });

    const suggestions = await llmWithStructuredOutput.invoke(state.messages);

    return { suggestions };
  }

  const result = await boundLLM.invoke([
    state.messages[0],
    new AIMessage({
      content: SUGGESTION_PROMPT(
        formattedMemories,
        state.userRequest as string,
        new Date().toISOString(),
      ),
    }),
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

export function checkUserSatisfaction(state: typeof GraphAnnotation.State) {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage.tool_calls?.length) {
    return NODES.TOOLS;
  }

  return NODES.BEFORE_STATE_CHECK;
}

function beforeENDStateCheck() {
  interrupt({
    value: "beforeStateCheck",
  });
  return { messages: [] };
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
  .addNode(NODES.BEFORE_STATE_CHECK, beforeENDStateCheck)
  .addEdge(START, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.BEFORE_STATE_CHECK, END)
  .addEdge(NODES.ASK_SPECIFIC_QUESTIONS, NODES.USER_ANSWER)
  .addEdge(NODES.USER_ANSWER, NODES.SAVE_USER_ANSWERS)
  .addEdge(NODES.SAVE_USER_ANSWERS, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.TOOLS, NODES.GENERATE_SUGGESTIONS)
  .addConditionalEdges(NODES.CHECK_KNOWLEDGE, routeBasedOnKnowledge, {
    [NODES.GENERATE_SUGGESTIONS]: NODES.GENERATE_SUGGESTIONS,
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
  })
  .addConditionalEdges(NODES.GENERATE_SUGGESTIONS, checkUserSatisfaction, {
    [NODES.BEFORE_STATE_CHECK]: NODES.BEFORE_STATE_CHECK,
    [NODES.TOOLS]: NODES.TOOLS,
  });

export const graph = builder.compile({
  checkpointer: new MemorySaver(),
});

graph.name = "concierge_agent";
