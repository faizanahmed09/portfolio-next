import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI } from '@google/genai'
import { searchSimilarDocuments } from '@/lib/embeddings'
import portfolioData from '@/data/portfolio.json'

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! })
const chatModel = process.env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash-lite'

type SimilarDoc = {
  content: string
  similarity?: number
  metadata?: {
    category?: string
  }
}

function formatSources(similarDocs: SimilarDoc[]) {
  return similarDocs.map((doc) => ({
    content: doc.content.substring(0, 150),
    category: doc.metadata?.category,
    similarity: doc.similarity,
  }))
}

function getErrorStatus(error: unknown) {
  return typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isQuotaExceededError(error: unknown) {
  const status = getErrorStatus(error)
  const message = getErrorMessage(error)

  return status === 429 || /RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(message)
}

function isTemporaryModelUnavailableError(error: unknown) {
  const status = getErrorStatus(error)
  const message = getErrorMessage(error)

  return status === 503 || /UNAVAILABLE|high demand|try again later|temporarily unavailable/i.test(message)
}

function buildDegradedResponse(reason: 'quota' | 'unavailable', similarDocs: SimilarDoc[]) {
  const topMatches = similarDocs
    .slice(0, 2)
    .map((doc) => doc.content.trim())
    .filter(Boolean)

  const intro =
    reason === 'quota'
      ? "I'm temporarily hitting AI rate limits, but here's a quick answer based on the portfolio data I already found:"
      : "The AI model is temporarily under heavy demand, but here's a quick answer based on the portfolio data I already found:"

  if (topMatches.length > 0) {
    return `${intro}\n\n${topMatches.join('\n\n')}\n\nIf you want, try again in a little while for a more polished AI-generated response.`
  }

  const { personalInfo, highlights } = portfolioData

  if (reason === 'quota') {
    return `I'm temporarily hitting AI rate limits right now. ${personalInfo.name} is a ${personalInfo.role} based in ${personalInfo.location} with ${highlights?.yearsExperience || '4+'} years of experience. You can still explore the portfolio or contact ${personalInfo.name} at ${personalInfo.email}${personalInfo.phone ? ` or ${personalInfo.phone}` : ''} while the AI quota resets.`
  }

  return `The AI model is temporarily under heavy demand right now. ${personalInfo.name} is a ${personalInfo.role} based in ${personalInfo.location} with ${highlights?.yearsExperience || '4+'} years of experience. You can still explore the portfolio or contact ${personalInfo.name} at ${personalInfo.email}${personalInfo.phone ? ` or ${personalInfo.phone}` : ''} while the service settles down.`
}

export async function POST(req: NextRequest) {
  let message = ''
  let conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
  let similarDocs: SimilarDoc[] = []

  try {
    const payload = await req.json()
    message = payload.message
    conversationHistory = payload.conversationHistory || []

    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    similarDocs = await searchSimilarDocuments(message, 5)

    const context = similarDocs
      .map((doc) => doc.content)
      .join('\n\n')

    const { personalInfo, socialLinks, experience, highlights } = portfolioData

    const systemPrompt = `You are ${personalInfo.name}'s AI assistant. You help visitors learn about ${personalInfo.name}'s portfolio, skills, experience, and projects.

Key Information:
- Name: ${personalInfo.name}
- Role: ${personalInfo.role}
- Location: ${personalInfo.location}
- Email: ${personalInfo.email}
- Phone: ${personalInfo.phone}
- LinkedIn: ${socialLinks.linkedin}
- GitHub: ${socialLinks.github}

Current Company: ${experience[0]?.company || 'Hashlogics'}
Experience: ${personalInfo.name} has ${highlights?.yearsExperience || '4+'} years of experience.

Guidelines:
1. Be friendly, professional, and conversational
2. Use the provided context to answer questions about ${personalInfo.name}'s background
3. If information isn't in the context, admit it but suggest what visitors can explore
4. Encourage visitors to check out the portfolio website for more details
5. Keep responses concise (2-4 sentences usually)
6. Format responses clearly with line breaks if needed
7. For technical skills questions, mention relevant experience
8. For project questions, describe key achievements

Context from portfolio:
${context || 'No relevant context found. Use your general knowledge of the portfolio structure.'}

If someone asks about contacting ${personalInfo.name}, provide: ${personalInfo.email} and ${personalInfo.phone}`

    let fullPrompt = systemPrompt + '\n\n'

    if (conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-6)
      fullPrompt += 'Previous conversation:\n'
      for (const msg of recentHistory) {
        fullPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`
      }
      fullPrompt += '\n'
    }

    fullPrompt += `User: ${message}`

    const result = await ai.models.generateContent({
      model: chatModel,
      contents: fullPrompt,
    })

    const response = result.text || ''

    return NextResponse.json({
      response,
      sources: formatSources(similarDocs),
      finishReason: result.finishReason,
    })
  } catch (error) {
    console.error('Chat API error:', error)

    if (isQuotaExceededError(error)) {
      return NextResponse.json({
        response: buildDegradedResponse('quota', similarDocs),
        sources: formatSources(similarDocs),
        degraded: true,
        error: 'AI quota exceeded',
      })
    }

    if (isTemporaryModelUnavailableError(error)) {
      return NextResponse.json({
        response: buildDegradedResponse('unavailable', similarDocs),
        sources: formatSources(similarDocs),
        degraded: true,
        error: 'AI model temporarily unavailable',
      })
    }

    return NextResponse.json(
      { error: 'Failed to generate response' },
      { status: 500 }
    )
  }
}
