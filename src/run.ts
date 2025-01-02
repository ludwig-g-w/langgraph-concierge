import { Command, InMemoryStore } from "@langchain/langgraph";
import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
import { Configuration } from "./configuration.js";
import { builder, NODES } from "./graph.js";
import { SYSTEM_PROMPT } from "./prompts.js";
import { GraphAnnotation } from "./state.js";

const thread = {
  configurable: {
    thread_id: "777777",
    userId: "44",
    model: "gpt-4o-mini",
    systemPrompt: SYSTEM_PROMPT,
  } as Configuration,
};

const sqliteSaver = new SqliteSaver({
  dbPath: "graph_checkpoints.db",
});

const graph = builder.compile({
  checkpointer: sqliteSaver,
  store: new InMemoryStore(),
});

export async function startGraph() {
  const stream = await graph.invoke(
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

  console.log(stream);

  return stream.messages;
}

export async function answerQuestion(answer: string) {
  const stream = await graph.stream(
    new Command({
      goto: NODES.SAVE_USER_ANSWERS,
      resume: answer,
    }),
    {
      ...thread,
      store: new InMemoryStore(),
      streamMode: "values",
    },
  );

  for await (const chunk of stream) {
    console.log("\n=== Stream Update ===");
    console.log(JSON.stringify(chunk, null, 2));
    console.log("\n-------------------");
  }
}

if (process.argv[2] === "startGraph") {
  startGraph()
    .then((result) => {
      console.log("Graph execution completed:");
      console.log(result);
    })
    .catch((error) => {
      console.error("Error executing graph:", error);
      process.exit(1);
    });
} else if (process.argv[2] === "answerQuestion") {
  const answer = process.argv[3];
  if (!answer) {
    console.error("Please provide an answer as the third argument");
    process.exit(1);
  }
  answerQuestion(answer).catch((error) => {
    console.error("Error answering question:", error);
    process.exit(1);
  });
}
