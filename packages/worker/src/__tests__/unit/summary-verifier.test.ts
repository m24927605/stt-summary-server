import { describe, it, expect } from 'vitest';
import { verifySummaryAgainstTranscript } from '../../verification/summary-verifier';

describe('summary-verifier', () => {
  const baseTranscript = 'The company had 150 employees and revenue of 2.5 million dollars last quarter.';

  it('passes when summary numbers all exist in transcript', () => {
    const summary = 'The company has 150 employees with 2.5 million in revenue.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('fails when summary introduces unseen numbers', () => {
    const summary = 'The company has 200 employees and made 3.7 million.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('200'))).toBe(true);
  });

  it('fails on empty summary', () => {
    const result = verifySummaryAgainstTranscript('', baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('empty'))).toBe(true);
  });

  it('fails on whitespace-only summary', () => {
    const result = verifySummaryAgainstTranscript('   \n\t  ', baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('empty'))).toBe(true);
  });

  it('fails on secret-like output', () => {
    const summary = 'Summary with key sk-proj-abc123def456ghi789jkl012 leaked.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('secret-like'))).toBe(true);
  });

  it('fails when summary exceeds max length', () => {
    const longSummary = 'A'.repeat(200);
    const result = verifySummaryAgainstTranscript(longSummary, baseTranscript, 100);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('maximum length'))).toBe(true);
  });

  it('fails when summary contains URLs not in transcript', () => {
    const summary = 'See details at https://evil.example.com/leak for more info.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('URL'))).toBe(true);
  });

  it('passes when summary URLs exist in transcript', () => {
    const transcript = 'Visit https://company.com/report for details. Revenue was 5 million.';
    const summary = 'Report available at https://company.com/report with 5 million revenue.';
    const result = verifySummaryAgainstTranscript(summary, transcript);
    expect(result.isConsistent).toBe(true);
  });

  it('ignores bullet label numbers (e.g., "1." at line start)', () => {
    const transcript = 'The team discussed budget cuts of 500 thousand.';
    const summary = '1. Budget cuts of 500 thousand were discussed.\n2. More details to follow.';
    const result = verifySummaryAgainstTranscript(summary, transcript);
    // "1" and "2" are bullet labels and should be ignored; "500" is in transcript
    expect(result.isConsistent).toBe(true);
  });

  it('returns multiple issues at once', () => {
    const summary = 'Revenue was 999 million. Visit https://bad.example.com for sk-proj-abc123def456ghi789jkl012.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('fails when summary contains assistant refusal language', () => {
    const summary = 'I cannot comply with that request, but the company had 150 employees.';
    const result = verifySummaryAgainstTranscript(summary, baseTranscript);
    expect(result.isConsistent).toBe(false);
    expect(result.issues.some((i) => i.includes('meta-response'))).toBe(true);
  });

  describe('copy-through detection', () => {
    it('fails when summary exactly equals transcript', () => {
      const transcript = 'The company had 150 employees and revenue of 2.5 million dollars last quarter.';
      const result = verifySummaryAgainstTranscript(transcript, transcript);
      expect(result.isConsistent).toBe(false);
      expect(result.issues.some((i) => i.includes('too similar'))).toBe(true);
    });

    it('fails when summary is a near-copy of a long transcript', () => {
      const longTranscript =
        'The quarterly review meeting covered several important topics. ' +
        'First, the engineering team reported that the new authentication system is now live in production. ' +
        'Second, the marketing department shared results from the recent campaign, showing a 25 percent increase in user engagement. ' +
        'Third, the finance team confirmed that operating costs were reduced by 12 percent compared to the previous quarter. ' +
        'Finally, the product manager outlined the roadmap for the next quarter, including plans for a mobile app release and API improvements.';
      // Near-copy: minor rewording but essentially the same content and length
      const nearCopySummary =
        'The quarterly review meeting covered several important topics. ' +
        'First the engineering team reported that the new authentication system is now live in production. ' +
        'Second the marketing department shared results from the recent campaign showing a 25 percent increase in user engagement. ' +
        'Third the finance team confirmed that operating costs were reduced by 12 percent compared to the previous quarter. ' +
        'Finally the product manager outlined the roadmap for the next quarter including plans for a mobile app release and API improvements.';
      const result = verifySummaryAgainstTranscript(nearCopySummary, longTranscript);
      expect(result.isConsistent).toBe(false);
      expect(result.issues.some((i) => i.includes('too similar'))).toBe(true);
    });

    it('passes for a valid concise summary with overlapping terms', () => {
      const longTranscript =
        'The quarterly review meeting covered several important topics. ' +
        'First, the engineering team reported that the new authentication system is now live in production. ' +
        'Second, the marketing department shared results from the recent campaign, showing a 25 percent increase in user engagement. ' +
        'Third, the finance team confirmed that operating costs were reduced by 12 percent compared to the previous quarter. ' +
        'Finally, the product manager outlined the roadmap for the next quarter, including plans for a mobile app release and API improvements.';
      const conciseSummary =
        '- New auth system is live in production\n' +
        '- Marketing campaign drove 25 percent user engagement increase\n' +
        '- Operating costs down 12 percent vs previous quarter\n' +
        '- Next quarter: mobile app release and API improvements planned';
      const result = verifySummaryAgainstTranscript(conciseSummary, longTranscript);
      expect(result.isConsistent).toBe(true);
    });

    it('does not false-fail for a short transcript with natural overlap', () => {
      const shortTranscript = 'Budget was 500 thousand for the project.';
      const summary = 'Budget was 500 thousand.';
      const result = verifySummaryAgainstTranscript(summary, shortTranscript);
      expect(result.isConsistent).toBe(true);
    });
  });
});
