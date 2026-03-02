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
          'You are a helpful assistant that creates concise summaries. Summarize the following transcript in a clear, structured format. Include: 1) key points, 2) decisions made, 3) to-do tasks with responsible person and deadline if mentioned. Respond in the same language as the transcript.',
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
