import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { logger } from "../lib/logger.js";

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

const ProfileJobMatchSchema = z.object({
  score: z.number().int().min(0).max(100),
  recommendation: z.enum(["apply", "consider", "skip"]),
  summary: z.string(),
  matchedSignals: z.array(z.string()),
  gaps: z.array(z.string()),
  missingProfileSignals: z.array(z.string()),
});

const RemotePreferenceValues = [
  "remote",
  "hybrid",
  "onsite",
  "flexible",
  "unspecified",
] as const;

const ProfileSchema = z.object({
  fullName: z.string().trim().max(200).nullable(),
  location: z.string().trim().max(200).nullable(),
  summary: z.string().trim().max(2000).nullable(),
  skills: z.array(z.string().trim().min(1)).max(50).nullable(),
  yearsExperience: z.number().int().min(0).max(80).nullable(),
  targetRoles: z.array(z.string().trim().min(1)).max(20).nullable(),
  preferredLocations: z.array(z.string().trim().min(1)).max(20).nullable(),
  remotePreference: z.enum(RemotePreferenceValues).nullable(),
  workAuthorization: z.string().trim().max(200).nullable(),
});

type SummarizedProfile = z.infer<typeof ProfileSchema>;

type EvaluateProfileJobMatchInput = {
  jobDescription: string;
  profile: {
    fullName: string;
    location: string;
    summary: string;
    skills: string[];
    yearsExperience: number;
    targetRoles: string[];
    preferredLocations: string[];
    remotePreference:
      | "remote"
      | "hybrid"
      | "onsite"
      | "flexible"
      | "unspecified";
    workAuthorization: string;
  };
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
    logger.error("OpenAI text generation failed", { error: err });
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
            text: "You are a resume tailoring assistant. Align resume lines to the target job post without inventing experience, companies, dates, tools, metrics, or responsibilities. Preserve the resume's existing structure. Only rewrite lines that materially improve relevance. Keep every rewritten line to one visual line, never include newline characters, and never exceed the supplied maxChars value for that line. Prefer concise, ATS-friendly phrasing. Return a short summary of what changed and why.",
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

export async function evaluateProfileJobMatch(
  input: EvaluateProfileJobMatchInput,
) {
  const response = await getOpenAIClient().responses.parse({
    model: getDefaultModel(),
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "You are a hiring-fit analysis assistant. Evaluate how well a user profile matches a job description without inventing experience, credentials, tools, projects, education, or authorization details. Be conservative when evidence is missing. Use only the provided profile and job description. Score from 0 to 100. Recommendation rules: apply for strong evidence and broad alignment, consider for partial alignment with manageable gaps, skip for weak alignment or major missing requirements. Keep the summary to at most two short sentences. Keep matchedSignals, gaps, and missingProfileSignals concise and specific.",
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: [
              "User profile JSON:",
              JSON.stringify(input.profile),
              "",
              "Job description:",
              input.jobDescription,
              "",
              "Rules:",
              "1. Do not assume the candidate has a skill unless the profile explicitly supports it.",
              "2. Put missing candidate evidence in missingProfileSignals.",
              "3. Put clear job-vs-profile gaps in gaps.",
              "4. Return concise matchedSignals that explain the score.",
              "5. Use recommendation values only from: apply, consider, skip.",
            ].join("\n"),
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(ProfileJobMatchSchema, "profile_job_match"),
    },
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI did not return a parsed profile job match");
  }

  return response.output_parsed;
}

export async function summarizeResumeToProfile(resumePdfBase64: string) {
  const prompt =
    "You are a resume summarization assistant that extracts profile information from a resume. Return only fields clearly supported by the resume. Never guess, never infer protected or legal status unless explicitly stated, and use null for unknown fields instead of placeholders. Keep summaries concise, normalize list values, and prefer conservative extraction over completeness.";

  const response = await getOpenAIClient().responses.parse({
    model: getDefaultModel(),
    input: [
      {
        role: "developer",
        content: prompt,
      },
      {
        role: "user",
        content: [
          {
            type: "input_file",
            filename: "resume.pdf",
            file_data: `data:application/pdf;base64,${resumePdfBase64}`,
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(ProfileSchema, "profile_summary"),
    },
  });

  if (!response.output_parsed) {
    logger.error("Failed to parse profile summary from OpenAI response", {
      rawResponse: response,
    });
    throw new Error("OpenAI did not return a parsed profile summary");
  }

  const summarizedProfile = Object.fromEntries(
    Object.entries(response.output_parsed as SummarizedProfile).filter(
      ([, value]) => {
        if (value === undefined || value === null) {
          return false;
        }

        if (typeof value === "string") {
          return value.trim().length > 0;
        }

        if (Array.isArray(value)) {
          return value.length > 0;
        }

        return true;
      },
    ),
  ) as SummarizedProfile;

  logger.info("Successfully summarized resume to profile", {
    extractedFields: Object.keys(summarizedProfile),
  });
  return summarizedProfile;
}
