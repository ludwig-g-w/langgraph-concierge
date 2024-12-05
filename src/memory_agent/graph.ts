// Main graph
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

import {
  LangGraphRunnableConfig,
  START,
  StateGraph,
  END,
} from "@langchain/langgraph";
import { BaseMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import { initChatModel } from "langchain/chat_models/universal";
import { initializeTools } from "./tools.js";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
} from "./configuration.js";
import { GraphAnnotation } from "./state.js";
import { getStoreFromConfigOrThrow, splitModelAndProvider } from "./utils.js";
import { GooglePlacesAPI } from "@langchain/community/tools/google_places";

const llm = await initChatModel();

export const NODES = {
  CALL_MODEL: "call_model",
  STORE_MEMORY: "store_memory",
  TOOLS: "tools",
} as const;

type NodeKeys = (typeof NODES)[keyof typeof NODES];

export async function callModel(
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

  const sys = configurable.systemPrompt
    .replace("{user_info}", formatted)
    .replace("{time}", new Date().toISOString());

  const tools = initializeTools(config);
  const boundLLM = llm.bind({
    tools: [...tools, new GooglePlacesAPI(), new TavilySearchResults()],
    tool_choice: "auto",
  });

  const result = await boundLLM.invoke(
    [{ role: "system", content: sys }, ...state.messages],
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
  return END;
}

export const builder = new StateGraph(
  {
    stateSchema: GraphAnnotation,
  },
  ConfigurationAnnotation,
)
  .addNode(NODES.CALL_MODEL, callModel)
  .addNode(NODES.STORE_MEMORY, storeMemory)
  .addNode(
    NODES.TOOLS,
    new ToolNode([new GooglePlacesAPI(), new TavilySearchResults()]),
  )
  .addEdge(START, NODES.CALL_MODEL)
  .addConditionalEdges(NODES.CALL_MODEL, routeMessage)
  .addEdge(NODES.STORE_MEMORY, NODES.CALL_MODEL)
  .addEdge(NODES.TOOLS, NODES.CALL_MODEL);
export const graph = builder.compile();

graph.name = "concierge_agent";
