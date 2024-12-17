import { InMemoryStore, LangGraphRunnableConfig } from "@langchain/langgraph";
import { checkKnowledge } from "../src/graph.js";
import { GraphAnnotation } from "../src/state.js";

describe("checkKnowledge", () => {
  let store: InMemoryStore;
  let config: LangGraphRunnableConfig;

  beforeEach(() => {
    store = new InMemoryStore();
    config = {
      configurable: {
        userId: "test-user",
      },
      store,
    };
  });

  test("throws error if user request is too short", async () => {
    const state = {
      userRequest: "hi",
    } as typeof GraphAnnotation.State;

    await expect(checkKnowledge(state, config)).rejects.toThrow(
      "User request is too short",
    );
  });

  test("returns false when no memories are found", async () => {
    const state = {
      userRequest: "This is a test request that is long enough",
    } as typeof GraphAnnotation.State;

    const result = await checkKnowledge(state, config);
    expect(result).toEqual({ hasEnoughKnowledge: false });
  });

  test("checks knowledge when memories exist", async () => {
    // Arrange
    const state = {
      userRequest: "This is a test request that is long enough",
    } as typeof GraphAnnotation.State;

    const existingMemory = {
      preferences: {
        type: "Outdoor",
        interests: ["hiking"],
      },
    };
    await store.put(["memories", "test-user"], "test-user", existingMemory);

    // Act
    const result = await checkKnowledge(state, config);

    // Assert
    expect(result).toHaveProperty("hasEnoughKnowledge");
    expect(typeof result.hasEnoughKnowledge).toBe("boolean");
  });

  test("processes existing memories for knowledge check", async () => {
    // Arrange
    const state = {
      userRequest: "This is a test request that is long enough",
    } as typeof GraphAnnotation.State;

    const existingMemory = {
      preferences: {
        type: "Indoor",
        interests: ["reading"],
      },
    };
    await store.put(["memories", "test-user"], "test-user", existingMemory);

    // Act
    const result = await checkKnowledge(state, config);

    // Assert
    expect(result).toHaveProperty("hasEnoughKnowledge");
    expect(typeof result.hasEnoughKnowledge).toBe("boolean");
  });
});
