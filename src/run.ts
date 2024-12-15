import { InMemoryStore, MemorySaver, Command } from "@langchain/langgraph";
import { Configuration } from "./configuration.js";
import { builder, NODES } from "./graph.js";
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

const graph = builder.compile({
  checkpointer: new MemorySaver(),
  store: new InMemoryStore(),
  interruptBefore: [NODES.SAVE_USER_ANSWERS],
});

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
  console.log(JSON.stringify(chunk, null, 2));
  console.log("\n-------------------");
}

// graph.invoke(
//   new Command({
//     goto: NODES.SAVE_USER_ANSWERS,
//     update: {
//       messages: [
//         {
//           role: "user",
//           content: "",
//         },
//       ],
//     },
//   }),
// );
