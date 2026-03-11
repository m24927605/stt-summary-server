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
          'You are a helpful assistant. Provide a concise summary of the following transcript. Respond in the same language as the transcript.',
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
