import OpenAI from 'openai';
import { config } from '../config';

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function summarizeText(transcript: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: config.gptModel,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that creates concise summaries. Summarize the following transcript in a clear, structured format. Include key points, decisions, and action items if any. Respond in the same language as the transcript.',
      },
      {
        role: 'user',
        content: transcript,
      },
    ],
    temperature: 0.3,
    max_tokens: 1024,
  });

  return response.choices[0]?.message?.content || 'No summary generated.';
}
