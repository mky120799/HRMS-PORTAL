import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
