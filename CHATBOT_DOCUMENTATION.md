# Portfolio Chatbot Documentation

## Overview

This document explains the current portfolio chatbot implementation.

The chatbot now supports:

- text chat with Retrieval-Augmented Generation (RAG)
- semantic retrieval using Supabase pgVector
- Gemini-based response generation
- microphone audio input with Gemini transcription

The voice flow is speech-to-text only in v1. Users record audio in the browser, the audio is transcribed by Gemini, and the transcript is inserted into the existing text input before sending.

---

## Architecture

```text
Chat Widget (Frontend)
  -> /api/chat
     -> Supabase vector search
     -> Gemini chat generation

Chat Widget (Frontend)
  -> /api/chat/transcribe
     -> Gemini Files upload
     -> Gemini audio transcription
```

### Main parts

- `components/chatbot-widget.tsx`
  - floating chat UI
  - text input
  - microphone recording flow
  - loading and recording states

- `app/api/chat/route.ts`
  - handles text chat requests
  - performs vector retrieval
  - generates Gemini responses
  - degrades gracefully on quota and temporary model issues

- `app/api/chat/transcribe/route.ts`
  - accepts recorded audio
  - validates upload size and format
  - uploads audio to Gemini Files
  - requests transcript-only output from Gemini

- `lib/embeddings.ts`
  - generates embeddings
  - queries similar documents from Supabase

---

## File Structure

```text
portfolio/
|- app/
|  |- api/
|  |  |- chat/
|  |  |  |- route.ts
|  |  |  \- transcribe/
|  |  |     \- route.ts
|  |  \- embed/
|  |     \- route.ts
|- components/
|  \- chatbot-widget.tsx
|- lib/
|  |- embeddings.ts
|  \- supabase.ts
|- data/
|  \- portfolio.json
\- supabase/
   \- setup.sql
```

---

## Text Chat Flow

### 1. User sends a text message

The widget posts JSON to `/api/chat`:

```json
{
  "message": "What is your experience with AWS?",
  "conversationHistory": []
}
```

### 2. Relevant portfolio documents are retrieved

`lib/embeddings.ts` generates an embedding for the query and calls the Supabase RPC function:

```typescript
match_portfolio_documents(query_embedding, match_threshold, match_count)
```

### 3. Gemini generates the final answer

The chat route builds a prompt containing:

- core portfolio identity data
- retrieved document context
- recent conversation history

It then calls Gemini chat generation.

### 4. Graceful degradation

If Gemini chat fails because of:

- quota exhaustion
- rate limiting
- temporary high demand / model unavailability

the route returns a degraded but usable response based on the retrieved portfolio documents instead of hard-failing with a broken chat experience.

---

## Audio Input Flow

## Frontend Behavior

Audio recording is implemented in `components/chatbot-widget.tsx`.

### Recorder states

The widget tracks:

- `idle`
- `requesting_permission`
- `recording`
- `transcribing`
- `error`

### User interaction

1. User taps the mic button.
2. Browser asks for microphone permission.
3. `getUserMedia({ audio: true })` opens the microphone.
4. `MediaRecorder` starts capturing audio.
5. User taps again to stop.
6. Audio is posted to `/api/chat/transcribe`.
7. Transcript is returned and inserted into the existing input box.
8. User can edit the text and send it through the normal chat flow.

### Current UX rules

- microphone uses tap-to-start / tap-to-stop
- transcript is not auto-sent
- send is disabled while recording or transcribing
- placeholder text changes during listening/transcribing
- microphone errors are surfaced back into chat UI

---

## Transcription Route

Audio transcription is implemented in `app/api/chat/transcribe/route.ts`.

### Request format

`POST /api/chat/transcribe`

Content type:

- `multipart/form-data`

Expected field:

- `audio`

### Validation

The route rejects:

- missing files
- empty recordings
- files larger than `10 MB`
- unsupported audio formats

### Supported audio types

The normalized accepted MIME types are:

- `audio/webm`
- `audio/wav`
- `audio/mp4`
- `audio/mpeg`
- `audio/mp3`
- `audio/m4a`
- `audio/x-m4a`

### MIME normalization

Some browsers, especially Chromium-based ones, send audio MIME types like:

```text
audio/webm;codecs=opus
```

The route normalizes those values before validation and Gemini upload. If the MIME type is missing, it also falls back to the file extension.

### Gemini transcription flow

1. The uploaded audio file is validated.
2. The audio file is uploaded with `ai.files.upload(...)`.
3. The route calls Gemini with:
   - the uploaded audio file part
   - a strict instruction to return transcript only
4. The response text is trimmed and returned as JSON.
5. The uploaded Gemini file is deleted in `finally`.

### Prompt used for transcription

The transcription request tells Gemini:

```text
Generate a transcript of the speech only. Do not summarize. Return only the spoken words.
```

---

## API Endpoints

### POST `/api/chat`

Chat with the portfolio assistant.

Example:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"What is your experience with AWS?\",\"conversationHistory\":[]}"
```

Example response:

```json
{
  "response": "Faizan has extensive experience with AWS...",
  "sources": [
    {
      "content": "At Hashlogics, worked on Forwood Safety...",
      "category": "experience",
      "similarity": 0.92
    }
  ]
}
```

### POST `/api/chat/transcribe`

Transcribe browser-recorded audio using Gemini.

Example:

```bash
curl -X POST http://localhost:3000/api/chat/transcribe \
  -F "audio=@sample.webm"
```

Success response:

```json
{
  "text": "What is your experience with AWS?"
}
```

Failure response:

```json
{
  "error": "Unsupported audio format."
}
```

### POST `/api/embed`

Index portfolio data into the vector database.

### GET `/api/embed`

Check indexed documents.

---

## Environment Variables

```env
NEXT_PUBLIC_SITE_URL=https://your-site-url

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Gemini
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key
GEMINI_CHAT_MODEL=gemini-2.5-flash-lite
GEMINI_TRANSCRIBE_MODEL=gemini-2.5-flash
```

---

## Models Used

| Model | Purpose |
| --- | --- |
| `gemini-embedding-2` | query/document embeddings |
| `gemini-2.5-flash-lite` | text chat generation |
| `gemini-2.5-flash` | audio transcription |

### Embedding configuration

The embeddings route uses:

```typescript
outputDimensionality: 1536
```

This keeps vector size below Postgres vector limits while preserving strong retrieval quality.

---

## Database Schema

### Table: `portfolio_documents`

```sql
CREATE TABLE portfolio_documents (
  id UUID PRIMARY KEY,
  content TEXT NOT NULL,
  metadata JSONB,
  embedding vector(1536),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Similarity search

The chatbot uses cosine similarity through the `match_portfolio_documents` RPC function and an HNSW index for fast retrieval.

---

## Error Handling

## Chat route

`/api/chat` handles:

- invalid input
- Gemini quota exhaustion
- Gemini temporary unavailability

When possible, it returns a degraded response based on retrieved portfolio context instead of failing completely.

## Transcription route

`/api/chat/transcribe` handles:

- missing audio file
- empty recording
- oversized recording
- unsupported audio type
- invalid Gemini API configuration
- Gemini quota/rate-limit issues
- Gemini temporary unavailability
- empty transcript output

Typical service-level transcription messages include:

- `Transcription service is not configured right now.`
- `Audio transcription is temporarily rate limited. Please try again shortly.`
- `Audio transcription is temporarily unavailable due to high demand. Please try again shortly.`

---

## Troubleshooting

### Unsupported audio format

Cause:

- browser sent an audio type outside the allowed list
- MIME type or extension could not be normalized

What to check:

- verify request includes `audio` in form-data
- verify browser recording type is `audio/webm` or another supported type
- verify server MIME normalization is active

### No speech could be transcribed

Cause:

- recording was too short
- microphone captured silence
- poor microphone permissions/device input

What to try:

- record a slightly longer clip
- speak clearly and closer to the mic
- confirm browser microphone permission

### Gemini transcription unavailable

Cause:

- quota exceeded
- temporary model overload
- API key/config issue

What to try:

- retry shortly
- verify `GOOGLE_GENERATIVE_AI_API_KEY`
- switch `GEMINI_TRANSCRIBE_MODEL` if needed

### Chat works but voice does not

Cause:

- browser supports text flow but not `MediaRecorder`
- mic permission denied
- upload validation failure on `/api/chat/transcribe`

What to try:

- use a modern Chromium browser first
- inspect network response for `/api/chat/transcribe`
- verify microphone permission at browser level

---

## Performance Notes

- vector search is fast and lightweight once documents are indexed
- text chat latency mostly depends on Gemini generation time
- audio transcription adds:
  - browser recording time
  - upload time
  - Gemini Files processing time
  - Gemini transcript generation time
- current transcription upload limit is `10 MB`

---

## Future Enhancements

1. Live partial transcription while recording
2. Auto-send option after transcription
3. Assistant voice playback (text-to-speech)
4. Better mobile recording controls
5. Retry UI for failed transcription
6. Audio duration indicator and waveform UI
7. Analytics for typed vs voice queries

---

## References

- [Google AI Embeddings](https://ai.google.dev/gemini-api/docs/embeddings)
- [Google AI Audio](https://ai.google.dev/gemini-api/docs/audio)
- [Supabase pgVector](https://supabase.com/docs/guides/ai/hybrid-search)
- [Matryoshka Embeddings](https://arxiv.org/abs/2205.13147)

---

## Quick Start

```bash
# 1. Create local env file
cp .env.example .env.local

# 2. Add your API keys to .env.local

# 3. Set up Supabase schema
# Run supabase/setup.sql in Supabase SQL editor

# 4. Index portfolio data
curl -X POST http://localhost:3000/api/embed

# 5. Start the app
npm run dev

# 6. Test text chat
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d "{\"message\":\"Hello!\",\"conversationHistory\":[]}"

# 7. Test audio transcription
curl -X POST http://localhost:3000/api/chat/transcribe \
  -F "audio=@sample.webm"
```

---

**Generated**: 2026-05-19  
**Chatbot Version**: 1.1.0
