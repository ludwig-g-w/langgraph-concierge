import { BaseMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, messagesStateReducer } from "@langchain/langgraph";
import { SYSTEM_PROMPT } from "./prompts.js";

export interface Suggestion {
  title: string;
  description: string;
  location: string;
  url: string;
  time: string;
}

export const GraphAnnotation = Annotation.Root({
  suggestions: Annotation<Suggestion[] | undefined>(),
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
  feedback: Annotation<string | undefined>(),
});
