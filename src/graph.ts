// Main graph
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import { AIMessage, BaseMessage, HumanMessage } from "@langchain/core/messages";
import {
  END,
  LangGraphRunnableConfig,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { initChatModel } from "langchain/chat_models/universal";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
} from "./configuration.js";
import { GraphAnnotation } from "./state.js";
import { initializeTools } from "./tools.js";
import { getStoreFromConfigOrThrow, splitModelAndProvider } from "./utils.js";
import { z } from "zod";

const llm = await initChatModel();

export const NODES = {
  DO_RESEARCH: "do_research",
  STORE_MEMORY: "store_memory",
  TOOLS: "tools",
  HUMAN_INPUT: "human_input",
  GATHER_INFO: "gather_info",
} as const;

type NodeKeys = (typeof NODES)[keyof typeof NODES];

export async function hasEnoughInformationAboutUser(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<typeof NODES.GATHER_INFO | typeof NODES.DO_RESEARCH> {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });
  if (memories.length > 3) {
    return NODES.DO_RESEARCH;
  }
  return NODES.GATHER_INFO;
}

export async function gatherInfo(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  const formatted =
    memories
      ?.map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
      ?.join("\n") || "";

  const memoryPrompt = configurable.memoryPrompt
    .replace("{user_info}", formatted)
    .replace("{time}", new Date().toISOString());

  const humanMessages = state.messages.filter((m) => m.getType() === "human");
  const lastHumanMessage = humanMessages[humanMessages.length - 1];

  const result = await llm.invoke(
    [
      { role: "system", content: memoryPrompt },
      {
        role: "system",
        content: `there is not enough information about the user to answer the following question: ${state.userQuestion}. Please ask the user to answer ${3 - memories.length} single-choice questions (A/B/C/D) to help you learn more about them before proceeding.`,
      },
    ],
    {
      configurable: splitModelAndProvider(configurable.model),
    },
  );

  return {
    messages: [result],
  };
}

export async function userAnswersQuestions(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  return { messages: [] };
}

export async function saveUserAnswers(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const lastMessage = state.messages[state.messages.length - 1] as HumanMessage;
  const formatted = lastMessage.content;
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const tools = initializeTools(config);

  const boundLLM = llm.bind({
    tools: [tools[0]],
    tool_choice: "upsertMemory",
  });

  const result = await boundLLM.invoke(
    [
      {
        role: "system",
        content: `Save the following user answers to the database. \
        The user answers are: ${formatted}`,
      },
      ...state.messages,
    ],
    {
      configurable: splitModelAndProvider(configurable.model),
    },
  );

  return { messages: [result] };
}

export async function doResearch(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const store = getStoreFromConfigOrThrow(config);
  const configurable = ensureConfiguration(config);
  const memories = await store.search(["memories", configurable.userId], {
    limit: 10,
  });

  let formatted =
    memories
      ?.map((mem) => `[${mem.key}]: ${JSON.stringify(mem.value)}`)
      ?.join("\n") || "";
  if (formatted) {
    formatted = `\n<memories>\n${formatted}\n</memories>`;
  }

  const memoryPrompt = configurable.memoryPrompt
    .replace("{user_info}", formatted)
    .replace("{time}", new Date().toISOString());

  const tools = initializeTools(config);
  const boundLLM = llm.bind({
    tools: [...tools, new GooglePlacesAPI(), new TavilySearchResults()],
    tool_choice: "auto",
  });

  const result = await boundLLM.invoke(
    [{ role: "system", content: memoryPrompt }, ...state.messages],
    {
      configurable: splitModelAndProvider(configurable.model),
    },
  );

  return { messages: [result] };
}

async function storeMemory(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
): Promise<{ messages: BaseMessage[] }> {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  const tools = initializeTools(config);
  const upsertMemoryTool = tools[0];

  const savedMemories = await Promise.all(
    toolCalls.map(async (tc) => {
      return await upsertMemoryTool.invoke(tc);
    }),
  );

  return { messages: savedMemories };
}

export function routeMessage(
  state: typeof GraphAnnotation.State,
): NodeKeys | typeof END {
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  if (lastMessage?.tool_calls?.[0]?.name === "upsertMemory") {
    return NODES.STORE_MEMORY;
  }
  if (
    lastMessage?.tool_calls?.[0]?.name &&
    lastMessage?.tool_calls?.[0]?.name !== "upsertMemory"
  ) {
    return NODES.TOOLS;
  }

  return NODES.HUMAN_INPUT;
}

function humanInput() {
  return;
}

export function isSatisfiedWithResponse(
  state: typeof GraphAnnotation.State,
): typeof NODES.DO_RESEARCH | typeof NODES.HUMAN_INPUT | typeof END {
  if (state.userFeedback === "retry") {
    return NODES.DO_RESEARCH;
  }
  if (state.userFeedback === "done") {
    return END;
  }
  return NODES.HUMAN_INPUT;
}

export const builder = new StateGraph(
  {
    stateSchema: GraphAnnotation,
  },
  ConfigurationAnnotation,
)
  .addNode(NODES.DO_RESEARCH, doResearch)
  .addNode(NODES.STORE_MEMORY, storeMemory)
  .addNode(
    NODES.TOOLS,
    new ToolNode([
      new GooglePlacesAPI(),
      new TavilySearchResults({
        maxResults: 5,
      }),
    ]),
  )
  .addNode(NODES.HUMAN_INPUT, humanInput)
  .addEdge(START, NODES.DO_RESEARCH)
  .addConditionalEdges(NODES.DO_RESEARCH, routeMessage, {
    [NODES.STORE_MEMORY]: NODES.STORE_MEMORY,
    [NODES.TOOLS]: NODES.TOOLS,
    [NODES.HUMAN_INPUT]: NODES.HUMAN_INPUT,
  })
  .addEdge(NODES.STORE_MEMORY, NODES.DO_RESEARCH)
  .addEdge(NODES.TOOLS, NODES.DO_RESEARCH)
  .addEdge(NODES.DO_RESEARCH, NODES.HUMAN_INPUT)
  .addConditionalEdges(NODES.HUMAN_INPUT, isSatisfiedWithResponse, {
    [NODES.DO_RESEARCH]: NODES.DO_RESEARCH,
    [END]: END,
  });

export const graph = builder.compile({
  checkpointer: new MemorySaver(),
  interruptBefore: [NODES.HUMAN_INPUT],
});

graph.name = "concierge_agent";
