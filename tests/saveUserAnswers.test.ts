import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { InMemoryStore, LangGraphRunnableConfig } from "@langchain/langgraph";
import { saveUserAnswers } from "../src/graph.js";
import { GraphAnnotation } from "../src/state.js";
import { SYSTEM_PROMPT } from "../src/prompts.js";

describe("saveUserAnswers", () => {
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

  test("should save user answers to the store", async () => {
    // Arrange
    const state = {
      messages: [
        new SystemMessage({ content: SYSTEM_PROMPT }),
        new HumanMessage({ content: "I like outdoor activities and hiking" }),
      ],
    } as typeof GraphAnnotation.State;

    // Act
    await saveUserAnswers(state, config);

    // Assert
    const savedMemories = await store.search(["memories", "test-user"], {
      limit: 10,
    });

    expect(savedMemories).toHaveLength(1);
    expect(savedMemories[0].value).toHaveProperty("preferences");
    expect(savedMemories[0].value.preferences).toHaveProperty(
      "type",
      "Outdoor",
    );
  });

  test("should handle multiple user preferences", async () => {
    // Arrange
    const state = {
      messages: [
        new SystemMessage({ content: SYSTEM_PROMPT }),
        new HumanMessage({
          content:
            "I enjoy both indoor and outdoor activities. For indoor, I like museums and art galleries. For outdoor, I prefer hiking and cycling. My budget is around $50 per activity.",
        }),
      ],
    } as typeof GraphAnnotation.State;

    // Act
    await saveUserAnswers(state, config);

    // Assert
    const savedMemories = await store.search(["memories", "test-user"], {
      limit: 10,
    });

    expect(savedMemories).toHaveLength(1);
    const preferences = savedMemories[0].value.preferences;
    expect(preferences).toHaveProperty("type", "Both");
    expect(preferences.interests).toContain("museums");
    expect(preferences.interests).toContain("hiking");
    expect(preferences.constraints.budget).toBe("$50");
  });

  test("should handle user location preferences", async () => {
    // Arrange
    const state = {
      messages: [
        new SystemMessage({ content: SYSTEM_PROMPT }),
        new HumanMessage({
          content:
            "I'm looking for activities in downtown San Francisco, preferably on weekends.",
        }),
      ],
    } as typeof GraphAnnotation.State;

    // Act
    await saveUserAnswers(state, config);

    // Assert
    const savedMemories = await store.search(["memories", "test-user"], {
      limit: 10,
    });

    expect(savedMemories).toHaveLength(1);
    const constraints = savedMemories[0].value.preferences.constraints;
    expect(constraints).toHaveProperty("location", "downtown San Francisco");
    expect(constraints).toHaveProperty("timing", "weekends");
  });

  test("should throw error if last message is not from human", async () => {
    // Arrange
    const state = {
      messages: [
        new SystemMessage({ content: SYSTEM_PROMPT }),
        new SystemMessage({ content: "Some system message" }),
      ],
    } as typeof GraphAnnotation.State;

    // Act & Assert
    await expect(saveUserAnswers(state, config)).rejects.toThrow(
      "Last message is not a human message",
    );
  });

  test("should update existing memories with new information", async () => {
    // Arrange
    const existingMemory = {
      preferences: {
        type: "indoor",
        interests: ["movies"],
        constraints: {
          budget: "$20",
        },
      },
    };
    await store.put(["memories", "test-user"], "test-user", existingMemory);

    const state = {
      messages: [
        new SystemMessage({ content: SYSTEM_PROMPT }),
        new HumanMessage({
          content:
            "I also enjoy outdoor activities like hiking, and my budget is now $50",
        }),
      ],
    } as typeof GraphAnnotation.State;

    // Act
    await saveUserAnswers(state, config);

    // Assert
    const savedMemories = await store.search(["memories", "test-user"], {
      limit: 10,
    });

    expect(savedMemories).toHaveLength(1);
    const preferences = savedMemories[0].value.preferences;
    expect(["Both", "Outdoor"]).toContain(preferences.type);
    expect(preferences.interests).toContain("movies");
    expect(preferences.interests).toContain("hiking");
    expect(preferences.constraints.budget).toBe("$50");
  });
});
