import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

let openaiClient: OpenAI | null = null;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing OPENAI_API_KEY. Make sure dotenv was loaded before using the OpenAI integration.",
    );
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey });
  }

  return openaiClient;
}

function getDefaultModel() {
  return process.env.OPENAI_MODEL || "chat-latest";
}

const TailoredResumeSchema = z.object({
  summary: z.string(),
  changes: z.array(
    z.object({
      lineId: z.string(),
      replacementText: z.string(),
      reason: z.string(),
    }),
  ),
});

type TailorResumeInput = {
  resumePdfBase64: string;
  jobPost: string;
  resumeLines: Array<{
    id: string;
    page: number;
    text: string;
    kind: "heading" | "bullet" | "contact" | "body";
    maxChars: number;
  }>;
};

export const generateResponse = async (prompt: string) => {
  try {
    const res = await getOpenAIClient().chat.completions.create({
      model: getDefaultModel(),
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that provides concise and accurate answers to user queries.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      max_tokens: 100,
    });
    return res.choices[0]?.message.content ?? "";
  } catch (err) {
    console.error("Error generating response:", err);
    throw new Error("Failed to generate response from LLM");
  }
};

export async function tailorResumeForJob(input: TailorResumeInput) {
  const response = await getOpenAIClient().responses.parse({
    model: getDefaultModel(),
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text:
              "You are a resume tailoring assistant. Align resume lines to the target job post without inventing experience, companies, dates, tools, metrics, or responsibilities. Preserve the resume's existing structure. Only rewrite lines that materially improve relevance. Keep every rewritten line to one visual line, never include newline characters, and never exceed the supplied maxChars value for that line. Prefer concise, ATS-friendly phrasing. Return a short summary of what changed and why.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "resume.pdf",
            file_data: `data:application/pdf;base64,${input.resumePdfBase64}`,
          },
          {
            type: "input_text",
            text: [
              "Target job post:",
              input.jobPost,
              "",
              "Editable resume lines as JSON:",
              JSON.stringify(input.resumeLines),
              "",
              "Rules:",
              "1. Use only lineId values from the provided JSON.",
              "2. Do not rewrite headings, contact info, or dates unless they appear in the editable list.",
              "3. Keep each replacementText within maxChars and on one line.",
              "4. If a line is already strong, omit it from changes.",
              "5. The summary must be short and explain what changed overall.",
            ].join("\n"),
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(TailoredResumeSchema, "tailored_resume"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI did not return a parsed resume tailoring response");
  }

  return response.output_parsed;
}
