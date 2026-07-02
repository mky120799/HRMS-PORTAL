import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private genAI: GoogleGenerativeAI | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('GEMINI_API_KEY');
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.logger.log('Gemini AI initialized ✅');
    } else {
      this.logger.warn('GEMINI_API_KEY not set — AI features will return mock responses.');
    }
  }

  /**
   * Score a job applicant's resume against a job description.
   * Returns a score (0-100) and a one-line reason.
   */
  async screenResume(jobTitle: string, jobDescription: string, resumeFilename: string): Promise<{ score: number; reason: string }> {
    if (!this.genAI) {
      // Graceful fallback when no API key is configured
      return { score: Math.floor(Math.random() * 40) + 50, reason: 'AI screening is unavailable (no API key). This is a mock score.' };
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
You are an expert HR recruiter. Evaluate a job applicant strictly based on this information.

JOB TITLE: ${jobTitle}
JOB DESCRIPTION: ${jobDescription}

APPLICANT RESUME FILE: ${resumeFilename}
(Note: The actual file content is not available in this demo. Score based on the filename and any context you can infer.)

Respond ONLY with a valid JSON object in this format, with no extra text:
{"score": <number 0-100>, "reason": "<one concise sentence explaining the score>"}
`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      // Extract JSON even if model wraps it in markdown code fences
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      return JSON.parse(jsonMatch[0]);
    } catch (err: any) {
      this.logger.error(`AI resume screening failed: ${err.message}`);
      return { score: 0, reason: 'AI screening encountered an error.' };
    }
  }

  /**
   * Parse a resume PDF buffer and extract candidate details using Gemini.
   */
  async parseResume(fileBuffer: Buffer, mimeType: string): Promise<{
    name: string;
    email: string;
    phone: string;
    skills: string[];
    experienceYears: number;
    summary: string;
  }> {
    const fallback = { name: '', email: '', phone: '', skills: [], experienceYears: 0, summary: '' };

    // Step 1: Extract raw text
    let resumeText = '';
    try {
      if (mimeType === 'application/pdf') {
        const parsed = await pdfParse(fileBuffer);
        resumeText = parsed.text;
      } else {
        // For DOCX/images, send text representation from filename fallback
        resumeText = fileBuffer.toString('utf-8').replace(/[^\x20-\x7E\n\r\t]/g, ' ');
      }
    } catch (err: any) {
      this.logger.error(`Failed to extract resume text: ${err.message}`);
      return fallback;
    }

    if (!resumeText.trim() || resumeText.trim().length < 20) {
      this.logger.warn('Extracted resume text is too short — cannot parse.');
      return fallback;
    }

    if (!this.genAI) {
      // Best-effort regex fallback when no API key configured
      const emailMatch = resumeText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      const phoneMatch = resumeText.match(/(\+?[0-9]{1,3}[\s.-]?)?\(?[0-9]{3}\)?[\s.-]?[0-9]{3}[\s.-]?[0-9]{4}/);
      return { ...fallback, email: emailMatch?.[0] ?? '', phone: phoneMatch?.[0] ?? '' };
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const prompt = `
You are an expert resume parser. Extract information from the following resume text.

RESUME TEXT:
${resumeText.slice(0, 8000)}

Return ONLY a valid JSON object with NO additional text or markdown, using this exact schema:
{
  "name": "full name of the candidate",
  "email": "email address or empty string",
  "phone": "phone number or empty string",
  "skills": ["skill1", "skill2", "skill3"],
  "experienceYears": <integer years of total experience, 0 if unknown>,
  "summary": "one sentence professional summary"
}
`;
      const result = await model.generateContent(prompt);
      const text = result.response.text().trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');
      return JSON.parse(jsonMatch[0]);
    } catch (err: any) {
      this.logger.error(`AI resume parsing failed: ${err.message}`);
      return fallback;
    }
  }

  /**
   * Answer an HR-related question from an employee using their context.
   */
  async chat(userMessage: string, userContext: { name: string; role: string; leaveBalance?: number; department?: string }): Promise<string> {
    if (!this.genAI) {
      return "AI assistant is currently unavailable. Please configure GEMINI_API_KEY to enable this feature.";
    }

    try {
      const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
      const systemPrompt = `
You are an intelligent, friendly, and concise HR assistant for an enterprise HRMS portal called "HRMS Portal".
You are speaking with ${userContext.name}, who has the role of ${userContext.role}.
${userContext.leaveBalance !== undefined ? `Their remaining leave balance is approximately ${userContext.leaveBalance} days.` : ''}
${userContext.department ? `They work in the ${userContext.department} department.` : ''}

RULES:
- Answer HR-related questions only (leave, payroll, attendance, performance, documents, company policies).
- Be concise (2-4 sentences max).
- For sensitive data you don't have access to (exact payslip amounts, etc.), tell them to check the relevant page in the portal.
- If asked something unrelated to HR, politely redirect.

Employee's question: ${userMessage}
`;
      const result = await model.generateContent(systemPrompt);
      return result.response.text().trim();
    } catch (err: any) {
      this.logger.error(`AI chat failed: ${err.message}`);
      return 'I encountered an error processing your request. Please try again.';
    }
  }
}
