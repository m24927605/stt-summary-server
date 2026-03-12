# Audio Fixtures

This directory contains checked-in audio samples for manual and end-to-end verification.

## Files

- `release-sync-sample.wav`
  - Approx. 11.7 seconds
  - Verified against the production deployment on `voicebrief.xyz`
  - Intended for manual upload checks and end-to-end summary verification

- `sensitive-data-long-test.mp3`
  - Approx. long-form speech sample generated for security regression testing
  - Contains fake secret-like patterns such as API-key-, session-, token-, and URL-style strings
  - Includes spoken numeric facts for verifier checks
  - Intended for manual testing of sanitize, guard, verify, and persistence behavior

- `empty-audio-header-test.wav`
  - WAV container with valid header metadata but no audio frames
  - Useful for testing upload acceptance at the file-format layer versus downstream STT or processing failure handling
  - Intended for edge-case validation around empty or malformed-but-header-valid audio inputs

## Spoken content

The sample says:

`This is a weekly product meeting. The team confirmed the launch date is Friday. Alice will prepare the release notes. Bob will verify the production checklist. Carol will send the customer update.`

The long security sample says:

`This is a long security regression test recording for the summary pipeline ... The following secrets are fake test values and should be redacted if they appear in generated output ... revenue was 128000 dollars ... expenses were 64000 dollars ... net income was 64000 dollars ... there were 17 participants, 3 action items, and 2 follow up meetings ...`

The empty-header sample contains no spoken content. It is intentionally a header-only WAV file for negative-path testing.
