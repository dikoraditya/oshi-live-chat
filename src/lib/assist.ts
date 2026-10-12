import Anthropic, {
  APIConnectionError,
  APIError,
  AuthenticationError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
// The SDK's zod helper is built against zod v4; zod 3.25+ ships it on this subpath.
import * as z from "zod/v4";

/**
 * Live interpreter for a fan on a short one-on-one video call with a Japanese
 * idol: translate what the idol just said, and propose three short replies the
 * fan can read aloud immediately.
 */

export class AssistError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AssistError";
  }
}

const ReplySchema = z.object({
  jp: z.string().describe("Short, natural spoken Japanese the fan can say out loud (<= ~15 words)."),
  romaji: z.string().describe("Romaji reading that matches jp exactly."),
  en: z.string().describe("Plain English meaning of this reply."),
  tone: z.string().describe("One-word tone label, e.g. warm, playful, grateful, curious."),
});

export const AssistSchema = z.object({
  heard_en: z.string().describe("Faithful, natural English translation of what the idol just said."),
  replies: z.array(ReplySchema).length(3).describe("Exactly three meaningfully different reply options."),
});
export type Assist = z.infer<typeof AssistSchema>;

const SYSTEM = `You are a real-time interpreter sitting beside a fan during a short one-on-one video call with a Japanese idol. The fan does not speak Japanese well.

For each thing the idol says you do two jobs:
1. heard_en — a faithful, natural English translation of what was said.
2. replies — three short Japanese replies the fan can read aloud right now.

Reply rules:
- Short: sayable in 2-4 seconds. Natural spoken Japanese, casual-polite (desu/masu is fine; avoid stiff keigo).
- Warm, genuine fan voice. Never creepy, romantically pushy, or demanding.
- Make the three options meaningfully different — e.g. a reaction, a question back, and a thanks/compliment.
- romaji MUST match jp exactly. en is the plain meaning.
- Use the fan's nickname only if it reads naturally.
Stay grounded in what was actually said; never invent facts about the idol.`;

function buildPrompt(input: { jp: string; history?: string[]; nickname?: string }): string {
  const who = input.nickname ? `The fan's name is "${input.nickname}".\n` : "";
  const ctx =
    input.history && input.history.length
      ? `Recent idol lines (oldest first), for context:\n${input.history
          .slice(-6)
          .map((l) => `- ${l}`)
          .join("\n")}\n\n`
      : "";
  return `${who}${ctx}The idol just said:\n「${input.jp}」\n\nTranslate it, then suggest three replies.`;
}

export async function assist(input: {
  jp: string;
  history?: string[];
  nickname?: string;
}): Promise<Assist> {
  const jp = input.jp.trim();
  if (!jp) throw new AssistError("Nothing to interpret.", 400);
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AssistError(
      "ANTHROPIC_API_KEY is not set on the server. Copy .env.example to .env.local.",
      500,
    );
  }

  const client = new Anthropic();
  const model = process.env.ASSIST_MODEL ?? "claude-haiku-4-5";

  try {
    const response = await client.messages.parse({
      model,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: buildPrompt({ ...input, jp }) }],
      output_config: { format: zodOutputFormat(AssistSchema) },
    });

    if (response.stop_reason === "refusal") {
      throw new AssistError("The model declined to respond.", 422);
    }
    const parsed = response.parsed_output;
    if (!parsed) {
      throw new AssistError("The model returned a response that did not match the expected shape.", 502);
    }
    return parsed;
  } catch (error) {
    if (error instanceof AssistError) throw error;
    if (error instanceof RateLimitError) throw new AssistError("Rate limited — try again shortly.", 429);
    if (error instanceof AuthenticationError) throw new AssistError("ANTHROPIC_API_KEY was rejected.", 401);
    if (error instanceof APIConnectionError) throw new AssistError("Could not reach the Claude API.", 503);
    if (error instanceof APIError) throw new AssistError(error.message, error.status ?? 502);
    console.error("[assist] unexpected failure", error);
    throw new AssistError("Assist failed.", 500);
  }
}
