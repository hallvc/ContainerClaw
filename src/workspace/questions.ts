/**
 * Question bank for workspace health check — maps field keys to conversational questions.
 */

export interface QuestionEntry {
  /** Direct question phrasings (for proactive mode). */
  direct: string[];
  /** System hint phrasings (for piggyback mode — injected into LLM context). */
  systemHint: string[];
}

export const QUESTION_BANK: Record<string, QuestionEntry> = {
  "user.name": {
    direct: [
      "Hey! I realized I don't actually know your name. What should I call you?",
      "Quick one — what's your name? I want to make sure I address you properly.",
    ],
    systemHint: [
      "After answering the user's question, casually mention that you don't know their name yet and ask what they'd like to be called.",
      "After responding, naturally ask the user what name they'd like you to use for them.",
    ],
  },
  "user.timezone": {
    direct: [
      "Quick question — what timezone are you in? It helps me time things better.",
      "What timezone are you working in? Helps me schedule reminders correctly.",
    ],
    systemHint: [
      "After answering, casually ask what timezone the user is in so you can time things better.",
      "After responding, naturally ask about their timezone for better scheduling.",
    ],
  },
  "user.language": {
    direct: [
      "What's your preferred language? I default to English but I can adjust.",
    ],
    systemHint: [
      "After answering, briefly ask if they have a preferred language for communication.",
    ],
  },
  "user.comm_style": {
    direct: [
      "Do you prefer I keep things casual, professional, or more technical when we chat?",
      "What communication style works best for you — casual, professional, or technical?",
    ],
    systemHint: [
      "After answering, ask if they prefer casual, professional, or technical communication style.",
      "After responding, naturally ask what communication vibe they prefer — casual, professional, or technical.",
    ],
  },
  "user.response_length": {
    direct: [
      "Do you prefer brief responses, detailed explanations, or adaptive based on the question?",
    ],
    systemHint: [
      "After answering, ask if they prefer brief responses, detailed explanations, or something adaptive.",
    ],
  },
  "user.tech_level": {
    direct: [
      "How would you rate your technical background — beginner, intermediate, or expert? Helps me calibrate my explanations.",
      "Quick question — are you more of a beginner, intermediate, or expert technically? Just so I pitch things at the right level.",
    ],
    systemHint: [
      "After answering, ask about their technical level (beginner, intermediate, or expert) to calibrate explanations.",
      "After responding, casually ask how technical they are so you can adjust your explanations.",
    ],
  },
  "user.role": {
    direct: [
      "What's your primary role? Developer, researcher, something else?",
      "What do you do? Knowing your role helps me give more relevant answers.",
    ],
    systemHint: [
      "After answering, ask about their primary role or what they do professionally.",
      "After responding, naturally ask what their main role is.",
    ],
  },
  "user.projects": {
    direct: [
      "What are you mainly working on right now? Helps me keep context.",
    ],
    systemHint: [
      "After answering, ask what projects they're currently working on.",
    ],
  },
  "user.tools": {
    direct: [
      "What tools, languages, or frameworks do you use most? IDEs, languages, etc.",
    ],
    systemHint: [
      "After answering, ask what development tools, languages, or frameworks they primarily use.",
    ],
  },
  "user.topics": {
    direct: [
      "Any particular topics you're interested in? Tech areas, hobbies, things you'd want me to know about?",
    ],
    systemHint: [
      "After answering, ask if there are any topics or areas of interest they'd like you to be aware of.",
    ],
  },
  "user.instructions": {
    direct: [
      "Any special instructions for how I should behave? Things I should always or never do?",
    ],
    systemHint: [
      "After answering, ask if they have any special instructions or preferences for how you should operate.",
    ],
  },
  "soul.personality": {
    direct: [
      "I'm using a default personality right now. Want me to be more formal? More playful? What vibe works for you?",
      "I can adjust my personality — more casual, more professional, more opinionated? What works best?",
    ],
    systemHint: [
      "After answering, mention you're using default personality settings and ask what vibe they'd prefer — more casual, formal, playful, etc.",
      "After responding, casually ask if they'd like you to adjust your personality or communication style.",
    ],
  },
  "heartbeat.tasks": {
    direct: [
      "I can check on things periodically for you — any recurring tasks you'd want me to handle? Like daily summaries or monitoring?",
      "I run periodic checks every 30 minutes. Want me to set up any recurring tasks? Weather updates, inbox monitoring, etc?",
    ],
    systemHint: [
      "After answering, mention you can run periodic tasks and ask if they have any recurring checks they'd like automated.",
      "After responding, casually mention your heartbeat feature and ask if there are periodic tasks they'd find useful.",
    ],
  },
  "agents.custom": {
    direct: [
      "I'm using default agent instructions. Any custom guidelines you'd like me to follow?",
    ],
    systemHint: [
      "After answering, ask if they have any custom guidelines or instructions they'd like the agent to follow.",
    ],
  },
  "tools.custom": {
    direct: [
      "The tools documentation is set to defaults. Any custom tools or workflows you'd like documented?",
    ],
    systemHint: [
      "After answering, ask if they have any custom tools or workflows they'd like added to the tools documentation.",
    ],
  },
};

/**
 * Get a random direct question for a field key.
 */
export function getDirectQuestion(fieldKey: string): string {
  const entry = QUESTION_BANK[fieldKey];
  if (!entry) return `Could you tell me about your ${fieldKey}?`;
  const questions = entry.direct;
  return questions[Math.floor(Math.random() * questions.length)];
}

/**
 * Get a random system hint for a field key.
 */
export function getSystemHint(fieldKey: string): string {
  const entry = QUESTION_BANK[fieldKey];
  if (!entry) return `After answering, casually ask about their ${fieldKey}.`;
  const hints = entry.systemHint;
  return hints[Math.floor(Math.random() * hints.length)];
}
