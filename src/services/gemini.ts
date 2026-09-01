import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const SYSTEM_PROMPT = `You are an expert software engineering assistant. Your task is to analyze a provided video capture with accompanying audio and generate a comprehensive bug report. The video will demonstrate a user's interaction with a software application, highlighting a specific issue or desired feature improvement.

**Instructions:**

1. **Video and Audio Analysis:** Carefully watch the video and listen to the audio. Pay close attention to the user's actions, spoken descriptions, and any visible or audible errors.
2. **User Story Extraction:** Identify the user's intended goal or task within the application. Frame this as a clear and concise user story, following the format: "As a [user role], I want to [action], so that [benefit]."
3. **Current Behavior Description:** Accurately describe the current behavior of the application as demonstrated in the video. Include specific details about the steps the user took and the resulting outcome. Highlight any discrepancies between the user's expectations and the actual behavior.
4. **Suggested Behavior Specification:** Based on the user's actions and the identified issue, propose a specific and actionable suggested behavior. Clearly outline how the application should ideally function.
5. **Benefit Articulation:** Explain the benefits of implementing the suggested behavior. Focus on how it would improve the user experience, address the identified issue, or enhance the application's functionality.
6. **Bug Report Formatting:** Structure the bug report as follows:

    \`\`\`
    **Bug Report**

    **Title:** [Concise and descriptive title of the issue]

    **User Story:**
    [As a ..., I want to ..., so that ...]

    **Current Behavior:**
    [Detailed description of the observed behavior, including steps taken and outcomes.]

    **Suggested Behavior:**
    [Clear and actionable description of the desired behavior.]

    **Benefits:**
    [Explanation of the advantages of implementing the suggested behavior.]

    **Video/Audio Reference:**
    [Provide a timestamp or specific section of the video that demonstrates the issue.]
    \`\`\`

7. **Clarity and Conciseness:** Use clear, concise, and professional language. Avoid jargon or technical terms that may not be universally understood by software engineers.
8. **Objectivity:** Maintain an objective and neutral tone throughout the report. Focus on factual observations and avoid subjective opinions or assumptions.
9. **Completeness:** Ensure that the bug report is complete and contains all the necessary information for a software engineer to understand and address the issue.
10. **Reproducility:** Ensure that the report states if the feature or bug is reproducible and outlines the steps to do so. If you have an environment that this is happening, summarize the environment information.`;

export function detectVideoMimeType(base64: string, fallbackMime: string, fileName: string = ""): string {
  try {
    // Slicing first 32 base64 characters is enough to extract 16-24 bytes
    const sliceLen = Math.ceil(24 * 4 / 3);
    const prefixBase64 = base64.slice(0, sliceLen);
    const binaryString = atob(prefixBase64);
    
    const bytes: number[] = [];
    for (let i = 0; i < Math.min(binaryString.length, 16); i++) {
      bytes.push(binaryString.charCodeAt(i));
    }

    // 1. WebM / Matroska EBML: [0x1A, 0x45, 0xDF, 0xA3]
    if (bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3) {
      return "video/webm";
    }

    // 2. MP4 ftyp box: 'ftyp' (0x66, 0x74, 0x79, 0x70) at offset 4
    if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
      return "video/mp4";
    }
  } catch (e) {
    console.warn("MIME type magic detection failed:", e);
  }

  // Fallback to filename extension
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".webm") || lowerName.endsWith(".mkv")) {
    return "video/webm";
  }
  if (lowerName.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lowerName.endsWith(".mov") || lowerName.endsWith(".qt")) {
    return "video/quicktime";
  }

  // Fallback to browser reported MIME
  const lowerMime = (fallbackMime || "").toLowerCase();
  if (lowerMime && lowerMime !== "application/octet-stream" && lowerMime.startsWith("video/")) {
    return lowerMime;
  }

  return "video/mp4"; // ultimate default
}

export async function generateBugReport(videoBase64: string, mimeType: string, fileName: string = ""): Promise<{ text: string; promptId: number | null }> {
  // 1. Try server-side endpoint first (keeps API key secure and uses runtime environment variables)
  try {
    const backendRes = await fetch('/api/generate-report', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoBase64, mimeType, fileName }),
    });

    if (backendRes.ok) {
      const data = await backendRes.json();
      return { text: data.text, promptId: data.promptId };
    }

    const errData = await backendRes.json().catch(() => null);
    if (errData && errData.error) {
      throw new Error(errData.error);
    }
  } catch (backendErr: any) {
    console.warn("Backend report generation endpoint failed or unavailable, checking client fallback:", backendErr);
    // If backend gave a descriptive API error, propagate it
    if (backendErr.message && !backendErr.message.includes('fetch') && !backendErr.message.includes('Failed to fetch')) {
      throw backendErr;
    }
  }

  // 2. Client-side fallback
  const actualMimeType = detectVideoMimeType(videoBase64, mimeType, fileName);
  console.log(`MIME Correction: Original browser MIME type is "${mimeType}" for file "${fileName}". Actual detected MIME type sent to Gemini is "${actualMimeType}".`);

  let activePrompt = SYSTEM_PROMPT;
  let promptId: number | null = null;
  try {
    const res = await fetch('/api/prompt');
    if (res.ok) {
      const data = await res.json();
      activePrompt = data.promptText;
      promptId = data.id;
    }
  } catch (err) {
    console.warn("Failed to fetch dynamic prompt, falling back to static prompt:", err);
  }

  const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY as string,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
  
  const response: GenerateContentResponse = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: [
      {
        parts: [
          { text: "Analyze this screen recording and generate a highly detailed bug report. Use bolding, bullet points, and clear sections to highlight key findings, errors, and critical steps. Ensure the output is in clean Markdown (.md) format." },
          {
            inlineData: {
              data: videoBase64,
              mimeType: actualMimeType,
            },
          },
        ],
      },
    ],
    config: {
      systemInstruction: activePrompt + "\n\n**Additional Formatting Instruction:** Use Markdown syntax effectively. Use `code blocks` for technical details, **bold text** for emphasis on critical issues, and clear headers. Ensure the report is professional and easy for a developer to scan quickly.",
    },
  });

  return {
    text: response.text || "Failed to generate bug report.",
    promptId
  };
}
