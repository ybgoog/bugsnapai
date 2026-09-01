import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import db from './db.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function detectVideoMimeType(base64, fallbackMime = '', fileName = '') {
  try {
    const sliceLen = Math.ceil(24 * 4 / 3);
    const prefixBase64 = base64.slice(0, sliceLen);
    const binaryBuffer = Buffer.from(prefixBase64, 'base64');
    
    // 1. WebM / Matroska EBML: [0x1A, 0x45, 0xDF, 0xA3]
    if (binaryBuffer[0] === 0x1A && binaryBuffer[1] === 0x45 && binaryBuffer[2] === 0xDF && binaryBuffer[3] === 0xA3) {
      return 'video/webm';
    }

    // 2. MP4 ftyp box: 'ftyp' (0x66, 0x74, 0x79, 0x70) at offset 4
    if (binaryBuffer[4] === 0x66 && binaryBuffer[5] === 0x79 && binaryBuffer[6] === 0x79 && binaryBuffer[7] === 0x70) {
      return 'video/mp4';
    }
  } catch (e) {
    console.warn('MIME type magic detection failed on server:', e);
  }

  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.webm') || lowerName.endsWith('.mkv')) {
    return 'video/webm';
  }
  if (lowerName.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (lowerName.endsWith('.mov') || lowerName.endsWith('.qt')) {
    return 'video/quicktime';
  }

  const lowerMime = (fallbackMime || '').toLowerCase();
  if (lowerMime && lowerMime !== 'application/octet-stream' && lowerMime.startsWith('video/')) {
    return lowerMime;
  }

  return 'video/mp4';
}

// Generate bug report from video
app.post('/api/generate-report', async (req, res) => {
  const { videoBase64, mimeType, fileName } = req.body;
  if (!videoBase64) {
    return res.status(400).json({ error: 'videoBase64 is required' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in .env' });
  }

  try {
    const actualMimeType = detectVideoMimeType(videoBase64, mimeType, fileName);
    
    let activePromptText = '';
    let promptId = null;
    try {
      const activePrompt = db.prepare('SELECT id, version, prompt_text FROM prompts WHERE is_active = 1 LIMIT 1').get();
      if (activePrompt) {
        activePromptText = activePrompt.prompt_text;
        promptId = activePrompt.id;
      }
    } catch (dbErr) {
      console.warn('Failed to query prompt from db:', dbErr);
    }

    const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await aiClient.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        {
          parts: [
            { text: 'Analyze this screen recording and generate a highly detailed bug report. Use bolding, bullet points, and clear sections to highlight key findings, errors, and critical steps. Ensure the output is in clean Markdown (.md) format.' },
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
        systemInstruction: (activePromptText ? activePromptText + '\n\n' : '') + '**Additional Formatting Instruction:** Use Markdown syntax effectively. Use `code blocks` for technical details, **bold text** for emphasis on critical issues, and clear headers. Ensure the report is professional and easy for a developer to scan quickly.',
      },
    });

    const reportText = response.text || 'Failed to generate bug report.';
    res.json({ text: reportText, promptId });
  } catch (err) {
    console.error('Failed to generate bug report:', err);
    res.status(500).json({ 
      error: err.message || 'Internal server error while generating report',
      details: err.status || err.code || null
    });
  }
});

// Fetch active system prompt
app.get('/api/prompt', (req, res) => {
  try {
    const activePrompt = db.prepare('SELECT id, version, prompt_text FROM prompts WHERE is_active = 1 LIMIT 1').get();
    if (!activePrompt) {
      return res.status(404).json({ error: 'No active prompt found' });
    }
    res.json({
      id: activePrompt.id,
      version: activePrompt.version,
      promptText: activePrompt.prompt_text
    });
  } catch (err) {
    console.error('Failed to query active prompt:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log user feedback edits
app.post('/api/feedback', (req, res) => {
  const { promptId, originalReport, finalReport, videoMetadata } = req.body;
  if (!originalReport || !finalReport) {
    return res.status(400).json({ error: 'originalReport and finalReport are required fields' });
  }
  try {
    const metaStr = videoMetadata ? JSON.stringify(videoMetadata) : null;
    db.prepare('INSERT INTO feedback_logs (prompt_id, original_report, final_report, video_metadata) VALUES (?, ?, ?, ?)').run(
      promptId || null,
      originalReport,
      finalReport,
      metaStr
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to log feedback:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger dynamic prompt optimization using meta-LLM
app.post('/api/optimize-prompt', async (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT f.original_report, f.final_report, p.prompt_text 
      FROM feedback_logs f
      JOIN prompts p ON f.prompt_id = p.id
      WHERE f.original_report != f.final_report
      ORDER BY f.created_at DESC
      LIMIT 10
    `).all();

    if (logs.length === 0) {
      return res.status(400).json({ error: 'Not enough feedback data to run optimization.' });
    }

    const currentPromptText = logs[0].prompt_text;

    let correctionList = '';
    logs.forEach((log, index) => {
      correctionList += `--- CORRECTION #${index + 1} ---\n`;
      correctionList += `[Original Generated Output]\n${log.original_report}\n\n`;
      correctionList += `[User Edited Final Output]\n${log.final_report}\n\n`;
    });

    const metaPrompt = `You are a Principal Prompt Engineer. Your task is to analyze user edits made to generated bug reports and optimize the system instructions (system prompt) to minimize the need for manual edits in the future.

**CURRENT_PROMPT:**
"""
${currentPromptText}
"""

**USER_CORRECTIONS:**
${correctionList}

Analyze the differences. Identify:
- Formatting fixes (e.g., user constantly adds bolding, removes extra sections, changes titles).
- Missing contents (e.g., user manually adds steps that were omitted).
- Styling changes (e.g., changing passive voice to active voice).

Generate an IMPROVED_PROMPT that incorporates these learnings. Output ONLY the new prompt text inside plain text, without any explanations, introductory text, or markdown code fences (like \`\`\`markdown).`;

    const aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await aiClient.models.generateContent({
      model: "gemini-2.5-pro",
      contents: metaPrompt,
    });

    const optimizedPrompt = response.text ? response.text.trim() : null;
    if (!optimizedPrompt) {
      throw new Error('Gemini API returned an empty prompt.');
    }

    db.transaction(() => {
      db.prepare('UPDATE prompts SET is_active = 0').run();
      const latestVersionRow = db.prepare('SELECT MAX(version) as max_ver FROM prompts').get();
      const nextVersion = (latestVersionRow.max_ver || 1) + 1;
      db.prepare('INSERT INTO prompts (version, prompt_text, is_active) VALUES (?, ?, 1)').run(nextVersion, optimizedPrompt);
    })();

    res.json({ success: true, optimizedPrompt });
  } catch (err) {
    console.error('Failed to run prompt optimization:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Serve static assets from 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

// Serve config endpoint for client-side Firebase initialization
app.get('/api/config', (req, res) => {
  res.json({
    firebaseConfig: {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID
    }
  });
});

// Fallback all requests to index.html for Single Page App routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});

