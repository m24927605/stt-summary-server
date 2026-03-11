export interface STTProvider {
  readonly name: string;
  transcribe(buffer: Buffer, filename: string): Promise<string>;
}

export interface LLMProvider {
  readonly name: string;
  summarize(transcript: string): Promise<string>;
}
