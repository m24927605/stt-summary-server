export interface STTProvider {
  readonly name: string;
  transcribe(filePath: string, filename: string): Promise<string>;
}

export interface LLMProvider {
  readonly name: string;
  summarize(transcript: string): Promise<string>;
}
