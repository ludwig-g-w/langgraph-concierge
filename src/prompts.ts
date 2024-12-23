import { Suggestion } from "./state.js";

export const SYSTEM_PROMPT = `You are a helpful concierge assistant that helps users find interesting events and places based on their preferences and interests. Your goal is to provide personalized suggestions that match the user's tastes and requirements.`;
export const CHECK_FOR_KNOWLEDGE_PROMPT = (
  preferences: string,
  userRequest: string,
) => `
You are an analyzer determining if we have enough information about a user to provide personalized suggestions.
Based on their request and the information already have saved the preferences we have, determine if we need to ask more questions.

* IMPORTANT: You do not need to be certain about 100% of the preferences, just 50% or more.
* Remember to only consider the preferences that are relevant to the user's request.
* Most important is to know where the user is and what time it is.


<user_request>${userRequest}</user_request>
<preferences>${preferences}</preferences>
`;

export const QUESTION_PROMPT = (
  preferences: string,
  reason: string,
) => `Based on the the <reason> why we don't have enough knowledge and any saved <preferences>, ask questions to better understand the user's preferences for events and places.

Choose 1 - 3 questions which will satisfy whatever is missing from the <preferences>

Format each question exactly like this example:
"Please choose your preferred dining style:
1. Fine dining restaurants
2. Casual sit-down restaurants 
3. Quick-service restaurants
4. Street food and food trucks
5. Home cooking and meal prep"

ONE EXEMPTION to the formatting is the question of location, which should be an open question formatted like this(only ask if you don't have the location already):
"Where are you located?"

Requirements:
- Present 3-5 clear options for the user to choose from
- Number each option sequentially starting at 1
- User should be able to respond with just the number
- Do not make any suggestions or recommendations already at this stage
- Do not ask about topics already covered in the <preferences>

<reason>${reason}</reason>
<preferences>${preferences}</preferences>
`;

export const SUGGESTION_PROMPT = (
  preferences: string,
  userRequest: string,
  timestamp: string,
  feedback: string | undefined,
  suggestions: Suggestion[] | undefined,
) => `Based on the data provided, use the available tools to find and suggest relevant events or places. For each suggestion:

1. Explain why it matches well
2. Include practical details (location, timing, cost if available)
3. Provide a brief description of what to expect

Make sure to provide a diverse set of options while staying within their stated preferences and constraints.

* IMPORTANT: Only provide 3 suggestions which you deem are the best fit for the user.
* If there is <feedback>, use it to improve the suggestions.
* Take into account the previous suggestions and adjust them accordingly.

<preferences>${preferences}</preferences>
<user_request>${userRequest}</user_request>
<timestamp>${timestamp}</timestamp>
<feedback>${feedback}</feedback>
<previous_suggestions>${JSON.stringify(suggestions) || "No previous suggestions"}</previous_suggestions>

`;

export const UPDATE_USER_MEMORY_PROMPT = `Save the user's answers to memory. Only update the preferences that are relevant to response from the user. Leave the preferences unchanged if they have not been answered.`;
