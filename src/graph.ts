import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import { InMemoryCache } from "@langchain/core/caches";
import { AIMessage, HumanMessage } from "@langchain/core/messages";

import {
  Command,
  END,
  interrupt,
  LangGraphRunnableConfig,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";

import { ToolNode } from "@langchain/langgraph/prebuilt";
import { ChatOpenAI } from "@langchain/openai";
import { z } from "zod";
import {
  ConfigurationAnnotation,
  ensureConfiguration,
} from "./configuration.js";
import {
  CHECK_FOR_KNOWLEDGE_PROMPT,
  QUESTION_PROMPT,
  SUGGESTION_PROMPT,
} from "./prompts.js";
import { GraphAnnotation } from "./state.js";
import { getStoreFromConfigOrThrow } from "./utils.js";
import { updateUserMemory } from "./utils.js";

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
  CHECK_FOR_FEEDBACK: "before_state_check",
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
  await updateUserMemory(llm, [new HumanMessage(state.userRequest)], config);
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
    reason: z.string().describe("Reason for the decision, max two sentences"),
  }) as any;

  const result = await llm.withStructuredOutput(schema).invoke([
    {
      role: "system",
      content: CHECK_FOR_KNOWLEDGE_PROMPT(
        JSON.stringify(memory.value),
        state.userRequest,
      ),
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

  const result = await llm.invoke([
    ...state.messages,
    {
      role: "system",
      content: QUESTION_PROMPT(
        JSON.stringify(memory?.value),
        state.hasEnoughKnowledge.reason,
      ),
    },
  ]);
  return { messages: result };
}

export function userAnswer(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  let question =
    "Answer by specifying the question number and then your answer";

  let answer;
  while (true) {
    answer = interrupt(question);

    // Validate answer, if the answer isn't valid ask for input again.
    if (typeof answer !== "string" || !answer.length) {
      question = `'${answer}' is not a valid answer to ${question}`;
      continue;
    } else {
      // If the answer is valid, we can proceed.
      break;
    }
  }

  console.log(`The human in the loop is ${answer} years old.`);

  return {
    messages: [new HumanMessage(answer)],
  };
}

export async function saveUserAnswers(
  state: typeof GraphAnnotation.State,
  config: LangGraphRunnableConfig,
) {
  const lastTwoMessages = state.messages.slice(-2);

  const results = await updateUserMemory(llm, lastTwoMessages, config);

  return {
    messages: [
      new AIMessage({
        content: `User answers saved to memory ${results.map((r) => r).join(", ")}`,
      }),
    ],
  };
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

  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage.getType() === "tool") {
    const suggestionSchema = z.object({
      suggestions: z.array(
        z.object({
          title: z.string().describe("Title of the suggested activity"),
          description: z
            .string()
            .describe("Detailed description of the activity"),
          location: z
            .string()
            .describe("Location where the activity takes place"),
          url: z
            .string()
            .describe("URL with more information about the activity"),
          time: z.string().describe("Suggested time for the activity"),
          reason: z
            .string()
            .describe(
              "Reason why this suggestion is relevant to the user's preferences and request",
            ),
        }),
      ),
    }) as any;

    const llmWithStructuredOutput = llm.withStructuredOutput(suggestionSchema);

    const suggestions = await llmWithStructuredOutput.invoke(state.messages);

    return { suggestions };
  }

  const result = await boundLLM.invoke([
    state.messages[0],
    new AIMessage({
      content: SUGGESTION_PROMPT(
        JSON.stringify(memory?.value),
        state.userRequest as string,
        new Date().toISOString(),
        state.feedback,
        state.suggestions,
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

  return NODES.CHECK_FOR_FEEDBACK;
}

function checkForFeedBack() {
  const feedback = interrupt({
    question:
      "Do you have any feedback for the suggestions? If you are satisfied just leave empty",
  });

  return new Command({
    goto: feedback ? NODES.GENERATE_SUGGESTIONS : END,
    update: {
      feedback,
    },
  });
}

export const builder = new StateGraph(
  {
    stateSchema: GraphAnnotation,
  },
  ConfigurationAnnotation,
)
  .addNode(NODES.CHECK_KNOWLEDGE, checkKnowledge)
  .addNode(NODES.ASK_SPECIFIC_QUESTIONS, askSpecificQuestions)
  .addNode(NODES.USER_ANSWER, userAnswer)
  .addNode(NODES.SAVE_USER_ANSWERS, saveUserAnswers)
  .addNode(NODES.TOOLS, new ToolNode(tools))
  .addNode(NODES.GENERATE_SUGGESTIONS, generateSuggestions)
  .addNode(NODES.CHECK_FOR_FEEDBACK, checkForFeedBack)
  .addEdge(START, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.CHECK_FOR_FEEDBACK, END)
  .addEdge(NODES.ASK_SPECIFIC_QUESTIONS, NODES.USER_ANSWER)
  .addEdge(NODES.USER_ANSWER, NODES.SAVE_USER_ANSWERS)
  .addEdge(NODES.SAVE_USER_ANSWERS, NODES.CHECK_KNOWLEDGE)
  .addEdge(NODES.TOOLS, NODES.GENERATE_SUGGESTIONS)
  .addConditionalEdges(NODES.CHECK_KNOWLEDGE, routeBasedOnKnowledge, {
    [NODES.GENERATE_SUGGESTIONS]: NODES.GENERATE_SUGGESTIONS,
    [NODES.ASK_SPECIFIC_QUESTIONS]: NODES.ASK_SPECIFIC_QUESTIONS,
  })
  .addConditionalEdges(NODES.GENERATE_SUGGESTIONS, checkUserSatisfaction, {
    [NODES.CHECK_FOR_FEEDBACK]: NODES.CHECK_FOR_FEEDBACK,
    [NODES.TOOLS]: NODES.TOOLS,
  });

export const graph = builder.compile({
  checkpointer: new MemorySaver(),
});

graph.name = "concierge_agent";
