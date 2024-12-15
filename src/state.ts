import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.js";

/**
 * Main graph state.
 */
export const GraphAnnotation = Annotation.Root({
  userFeedback: Annotation<string | undefined>(),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [
      new SystemMessage({
        content: SYSTEM_PROMPT,
      }),
    ],
  }),
  hasEnoughKnowledge: Annotation<boolean>({
    value: (x: boolean, y: boolean) => y,
    default: () => false,
  }),
  userRequest: Annotation<string>(),
});
