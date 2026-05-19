# Portfolio Chatbot Setup Guide

This guide will help you set up the RAG-based chatbot for your portfolio using Supabase pgVector and Google's Gemini AI.

## Prerequisites

- A Supabase project with pgVector extension
- A Google AI API key for Gemini

## Step 1: Get Your API Keys

### Supabase

1. Go to [supabase.com](https://supabase.com)
2. Create a new project or use an existing one
3. Go to Project Settings → API
4. Copy these values:
   - Project URL
   - anon public key
   - service_role secret (for admin operations)

### Google AI (Gemini)

1. Go to [ai.google.dev](https://ai.google.dev)
2. Sign in and create a new API key
3. Copy the API key

## Step 2: Configure Environment Variables

Add the following to your `.env.local` file:

```env
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Google AI (Gemini) Configuration
GOOGLE_GENERATIVE_AI_API_KEY=your_gemini_api_key
```

## Step 3: Set Up Supabase Database

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Run the SQL from `supabase/setup.sql`

This will:
- Enable the pgVector extension
- Create the `portfolio_documents` table
- Set up similarity search functions
- Configure Row Level Security policies

## Step 4: Index Your Portfolio Data

Once your database is set up, you need to embed and store your portfolio data:

```bash
# POST request to /api/embed
curl -X POST http://localhost:3000/api/embed
```

Or use this curl command:
```bash
curl -X POST http://localhost:3000/api/embed
```

This will:
- Read data from `data/portfolio.json`
- Generate embeddings using Gemini
- Store chunks in Supabase with vector embeddings

You can also check the indexed documents:
```bash
curl http://localhost:3000/api/embed
```

## Step 5: Test the Chatbot

1. Start your development server:
   ```bash
   npm run dev
   ```

2. Open your browser and navigate to `http://localhost:3000`

3. Click the floating chat button in the bottom-right corner

4. Try asking questions like:
   - "What is your experience with AWS?"
   - "Tell me about your projects"
   - "What skills do you have?"
   - "How can I contact you?"

## How It Works

1. **Embedding**: Portfolio data is chunked and converted to vector embeddings
2. **Storage**: Embeddings are stored in Supabase with pgVector
3. **Retrieval**: When you ask a question, the API searches for similar documents
4. **Generation**: Gemini generates contextual answers based on retrieved documents

## API Endpoints

### POST `/api/embed`
Index portfolio data into vector database.

### GET `/api/embed`
Check indexed documents count and metadata.

### POST `/api/chat`
Chat with the portfolio assistant.

Request body:
```json
{
  "message": "Your question here",
  "conversationHistory": [] // optional
}
```

## Troubleshooting

### Chatbot not responding
- Check that environment variables are set correctly
- Ensure portfolio data has been indexed (`POST /api/embed`)
- Check browser console for errors
- Verify Supabase connection and database setup

### Embedding fails
- Ensure Google AI API key is valid
- Check Supabase connection
- Verify pgVector extension is enabled in Supabase

### Similarity search returns empty
- Ensure documents are indexed
- Check the match_threshold in the search function
- Verify embedding dimensions match (768 for Google embeddings)

## Customization

You can customize:
- Chatbot UI in `components/chatbot-widget.tsx`
- System prompt in `app/api/chat/route.ts`
- Document chunking logic in `lib/embeddings.ts`
- Similarity threshold in `supabase/setup.sql`

## Deployment

For Vercel deployment:

1. Add environment variables in Vercel project settings
2. Deploy your Supabase schema to production
3. Run the `/api/embed` POST endpoint once to index data
4. Deploy your app

For the `/api/embed` endpoint to work in production, you may want to:
- Add authentication to prevent unauthorized indexing
- Create a separate admin route with auth protection
- Or run it manually after deployment