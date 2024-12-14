import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.js";

/**
 * Main graph state.
 */
export const GraphAnnotation = Annotation.Root({
  userFeedback: Annotation<string | undefined>(),
  questions: Annotation<string[] | undefined>(),
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [
      new SystemMessage({
        content: SYSTEM_PROMPT,
      }),
    ],
  }),
  suggestions: Annotation<string[] | undefined>(),
  hasEnoughKnowledge: Annotation<boolean>({
    value: (x: boolean, y: boolean) => y,
    default: () => false,
  }),
  savedMemories: Annotation<any[] | undefined>(),
  userRequest: Annotation<string | undefined>(),
});
