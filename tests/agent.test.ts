import { describe, expect, it } from "@jest/globals";
import { GooglePlacesAPI } from "@langchain/community/tools/google_places";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { graph, routeMessage, doResearch } from "../src/graph.js";
import { InMemoryStore } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "../src/prompts.js";

const baseState = {
  userFeedback: undefined,
  questions: undefined,
  suggestions: undefined,
  messages: [new SystemMessage({ content: SYSTEM_PROMPT })],
};

describe("Graph", () => {
  describe("doResearch", () => {
    it("should return END", async () => {
      const result = await doResearch(
        {
          ...baseState,
          messages: [new HumanMessage("find me a restaurant in San Francisco")],
        },
        {
          store: new InMemoryStore(),
          configurable: {
            userId: "test",
            model: "gpt-4o-mini",
          },
        },
      );
      // eslint-disable-next-line no-instanceof/no-instanceof
      expect(result.messages[0] instanceof AIMessage).toBe(true);
      expect((result.messages[0] as AIMessage)?.tool_calls?.[0]?.name).toBe(
        "google_places",
      );
    });
  });
  describe("routeMessage", () => {
    it("should return store_memory", () => {
      expect(
        routeMessage({
          ...baseState,
          messages: [
            new AIMessage({
              content: "test",
              tool_calls: [{ name: "upsertMemory", args: { content: "test" } }],
            }),
          ],
        }),
      ).toBe("store_memory");
    });
    it("should return find_places", () => {
      expect(
        routeMessage({
          ...baseState,
          messages: [
            new AIMessage({
              content: "where is the nearest restaurant?",
              tool_calls: [
                {
                  name: GooglePlacesAPI.name,
                  args: { query: "restaurants in San Francisco" },
                  id: "123",
                  type: "tool_call",
                },
              ],
            }),
          ],
        }),
      ).toBe("find_places");
    });
  });
});
