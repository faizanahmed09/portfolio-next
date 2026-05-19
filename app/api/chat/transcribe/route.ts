import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenAI, createPartFromUri } from '@google/genai'

export const runtime = 'nodejs'

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY! })
const transcriptionModel = process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-flash'

const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/m4a',
  'audio/x-m4a',
])

const MAX_AUDIO_BYTES = 10 * 1024 * 1024

function getNormalizedMimeType(file: File) {
  const rawType = file.type?.toLowerCase().trim() || ''
  const baseType = rawType.split(';')[0].trim()

  if (baseType) {
    return baseType
  }

  const extension = file.name.split('.').pop()?.toLowerCase()
  const extensionMap: Record<string, string> = {
    webm: 'audio/webm',
    wav: 'audio/wav',
    mp4: 'audio/mp4',
    mpeg: 'audio/mpeg',
    mp3: 'audio/mpeg',
    m4a: 'audio/m4a',
  }

  return extension ? extensionMap[extension] || '' : ''
}

function getErrorStatus(error: unknown) {
  return typeof error === 'object' && error !== null ? (error as { status?: number }).status : undefined
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function buildServiceError(error: unknown) {
  const message = getErrorMessage(error)
  const status = getErrorStatus(error)

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return 'Transcription service is not configured right now.'
  }

  if (status === 429 || /RESOURCE_EXHAUSTED|quota exceeded|rate limit/i.test(message)) {
    return 'Audio transcription is temporarily rate limited. Please try again shortly.'
  }

  if (status === 503 || /UNAVAILABLE|high demand|try again later|temporarily unavailable/i.test(message)) {
    return 'Audio transcription is temporarily unavailable due to high demand. Please try again shortly.'
  }

  if (status === 401 || status === 403 || /API key|authentication|permission/i.test(message)) {
    return 'Audio transcription is unavailable because the API configuration is invalid.'
  }

  return 'Failed to transcribe audio. Please try again.'
}

export async function POST(req: NextRequest) {
  let uploadedFileName: string | undefined

  try {
    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return NextResponse.json(
        { error: 'Transcription service is not configured right now.' },
        { status: 500 }
      )
    }

    const formData = await req.formData()
    const audioFile = formData.get('audio')

    if (!(audioFile instanceof File)) {
      return NextResponse.json(
        { error: 'Audio file is required.' },
        { status: 400 }
      )
    }

    if (!audioFile.size) {
      return NextResponse.json(
        { error: 'Audio recording is empty.' },
        { status: 400 }
      )
    }

    if (audioFile.size > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { error: 'Audio recording is too large. Please keep it under 10 MB.' },
        { status: 400 }
      )
    }

    const normalizedMimeType = getNormalizedMimeType(audioFile)

    if (!ALLOWED_MIME_TYPES.has(normalizedMimeType)) {
      return NextResponse.json(
        { error: 'Unsupported audio format.' },
        { status: 400 }
      )
    }

    const uploadedFile = await ai.files.upload({
      file: audioFile,
      config: {
        mimeType: normalizedMimeType,
        displayName: audioFile.name || 'chatbot-audio-input',
      },
    })
    uploadedFileName = uploadedFile.name

    const result = await ai.models.generateContent({
      model: transcriptionModel,
      contents: [
        createPartFromUri(uploadedFile.uri!, uploadedFile.mimeType!),
        'Generate a transcript of the speech only. Do not summarize. Return only the spoken words.',
      ],
    })

    const text = result.text?.trim() || ''

    if (!text) {
      return NextResponse.json(
        { error: 'No speech could be transcribed from that recording.' },
        { status: 400 }
      )
    }

    return NextResponse.json({ text })
  } catch (error) {
    console.error('Transcription API error:', error)

    return NextResponse.json(
      { error: buildServiceError(error) },
      { status: 500 }
    )
  } finally {
    if (uploadedFileName) {
      try {
        await ai.files.delete({ name: uploadedFileName })
      } catch (cleanupError) {
        console.error('Transcription file cleanup error:', cleanupError)
      }
    }
  }
}
