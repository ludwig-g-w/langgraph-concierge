import { BaseMessage } from "@langchain/core/messages";
import { InMemoryStore } from "@langchain/langgraph";
import { Configuration } from "./configuration.js";
import { graph } from "./graph.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { GraphAnnotation } from "./state.js";

const thread = {
  configurable: {
    thread_id: "112314",
    userId: "44",
    model: "gpt-4o-mini",
    systemPrompt: SYSTEM_PROMPT,
  } as Configuration,
};

const stream = await graph.stream(
  {
    userRequest: "find me a restaurant in the area",
  } as typeof GraphAnnotation.State,
  {
    ...thread,
    store: new InMemoryStore(),
    streamMode: "values",
    debug: true,
  },
);

for await (const chunk of stream) {
  console.log("\n=== Stream Update ===");
  console.log(chunk);
  console.log("\n-------------------");
}
