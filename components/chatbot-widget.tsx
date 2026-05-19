'use client'

import { useState, useRef, useEffect } from 'react'
import { MessageSquare, Mic, Square, X, Send, Bot, User, Sparkles } from 'lucide-react'
import { siteConfig } from '@/lib/site'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: Array<{
    content: string
    category: string
    similarity: number
  }>
}

type RecorderState = 'idle' | 'requesting_permission' | 'recording' | 'transcribing' | 'error'

const SUGGESTED_QUESTIONS = [
  'What is your experience with AWS?',
  'Tell me about your projects',
  'What skills do you have?',
  'How can I contact you?',
  'What is your educational background?',
]

export function ChatbotWidget() {
  const [isOpen, setIsOpen] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Hi! I am ${siteConfig.name}'s AI assistant. Ask me anything about his experience, skills, projects, or how to connect!`,
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [recorderError, setRecorderError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioChunksRef = useRef<Blob[]>([])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    setShowTooltip(true)
    const timer = setTimeout(() => setShowTooltip(false), 3000)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (isOpen) {
      setShowTooltip(false)
    }
  }, [isOpen])

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stop()
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const appendAssistantMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: (Date.now() + Math.random()).toString(),
        role: 'assistant',
        content,
      },
    ])
  }

  const resetRecorderResources = () => {
    mediaRecorderRef.current = null
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
    mediaStreamRef.current = null
    audioChunksRef.current = []
  }

  const transcribeAudioBlob = async (audioBlob: Blob) => {
    const fileExtension = audioBlob.type.split('/')[1]?.split(';')[0] || 'webm'
    const audioFile = new File([audioBlob], `chatbot-recording.${fileExtension}`, {
      type: audioBlob.type || 'audio/webm',
    })
    const formData = new FormData()
    formData.append('audio', audioFile)

    const response = await fetch('/api/chat/transcribe', {
      method: 'POST',
      body: formData,
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to transcribe audio')
    }

    if (!data.text || typeof data.text !== 'string') {
      throw new Error('No speech could be transcribed from that recording.')
    }

    setInput(data.text)
    setRecorderState('idle')
    setRecorderError('')
  }

  const stopRecording = async () => {
    const recorder = mediaRecorderRef.current

    if (!recorder) {
      setRecorderState('idle')
      return
    }

    setRecorderState('transcribing')

    await new Promise<void>((resolve, reject) => {
      recorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunksRef.current, {
            type: recorder.mimeType || 'audio/webm',
          })
          resetRecorderResources()

          if (!audioBlob.size) {
            throw new Error('Audio recording is empty.')
          }

          await transcribeAudioBlob(audioBlob)
          resolve()
        } catch (error) {
          reject(error)
        }
      }

      recorder.onerror = () => {
        reject(new Error('Recording failed. Please try again.'))
      }

      recorder.stop()
    })
  }

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('Audio recording is not supported in this browser.')
    }

    setRecorderState('requesting_permission')
    setRecorderError('')
    audioChunksRef.current = []

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStreamRef.current = stream

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunksRef.current.push(event.data)
      }
    }

    recorder.start()
    setRecorderState('recording')
  }

  const handleMicToggle = async () => {
    if (isLoading || recorderState === 'requesting_permission' || recorderState === 'transcribing') {
      return
    }

    try {
      if (recorderState === 'recording') {
        await stopRecording()
        return
      }

      await startRecording()
    } catch (error) {
      resetRecorderResources()
      setRecorderState('error')
      const message =
        error instanceof Error
          ? error.message
          : 'Microphone access failed. Please try again.'
      setRecorderError(message)
      appendAssistantMessage(message)
    }
  }

  const handleSend = async (messageText?: string) => {
    const text = messageText || input.trim()
    if (!text || isLoading || recorderState === 'requesting_permission' || recorderState === 'recording' || recorderState === 'transcribing') return

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const conversationHistory = messages.filter(m => m.id !== 'welcome')

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          conversationHistory,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response')
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.response,
        sources: data.sources,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Chat error:', error)
      const fallbackMessage =
        error instanceof Error
          ? error.message
          : 'Sorry, I encountered an error. Please try again.'

      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: fallbackMessage,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isRecording = recorderState === 'recording'
  const isTranscribing = recorderState === 'transcribing'
  const isMicBusy = recorderState === 'requesting_permission' || isRecording || isTranscribing
  const inputPlaceholder = isRecording
    ? 'Listening... tap stop when finished'
    : isTranscribing
      ? 'Transcribing your audio...'
      : 'Type your question...'

  return (
    <div className="fixed bottom-14 right-2 z-50 md:bottom-[78px] md:right-6">
      {isOpen && (
        <div className="fixed bottom-28 left-1/2 flex w-[380px] max-w-[calc(100vw-2rem)] -translate-x-1/2 max-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl transition-all duration-300 origin-bottom md:absolute md:bottom-20 md:left-auto md:right-0 md:max-w-[calc(100vw-3rem)] md:max-h-[calc(100vh-10rem)] md:translate-x-0 md:origin-bottom-right">
          <div className="bg-primary text-primary-foreground p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Bot className="w-5 h-5" />
                <Sparkles className="w-3 h-3 absolute -top-1 -right-1 text-yellow-300" />
              </div>
              <div>
                <h3 className="font-semibold text-sm">
                  {siteConfig.name}&apos;s AI
                </h3>
                <p className="text-xs opacity-80">Ask about portfolio</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="Close chat"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-3 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                    msg.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-md'
                      : 'bg-background border rounded-bl-md'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  {msg.sources && msg.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border/50">
                      <p className="text-xs opacity-60">
                        From {msg.sources.length} source{msg.sources.length > 1 ? 's' : ''}
                      </p>
                    </div>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                    <User className="w-4 h-4 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex gap-3 justify-start">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="flex min-h-11 min-w-16 items-center justify-center rounded-2xl rounded-bl-md border bg-background px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="h-1.5 w-1.5 rounded-full bg-white animate-bounce"
                      style={{ animationDuration: '0.9s' }}
                    />
                    <div
                      className="h-1.5 w-1.5 rounded-full bg-white animate-bounce"
                      style={{ animationDelay: '0.15s', animationDuration: '0.9s' }}
                    />
                    <div
                      className="h-1.5 w-1.5 rounded-full bg-white animate-bounce"
                      style={{ animationDelay: '0.3s', animationDuration: '0.9s' }}
                    />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {messages.length === 1 && (
            <div className="p-4 border-t border-border">
              <p className="text-xs text-muted-foreground mb-2">
                Try asking:
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.slice(0, 3).map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSend(q)}
                    className="text-xs px-3 py-1.5 bg-muted hover:bg-muted/80 rounded-full transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="p-4 border-t border-border">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder={inputPlaceholder}
                className="flex-1 bg-background border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                disabled={isLoading || isTranscribing}
              />
              <button
                onClick={() => void handleMicToggle()}
                disabled={isLoading || recorderState === 'requesting_permission' || isTranscribing}
                className={`p-2 rounded-lg border transition-colors ${
                  isRecording
                    ? 'bg-red-500 text-white border-red-500 hover:bg-red-600'
                    : 'bg-background text-foreground hover:bg-muted'
                } disabled:opacity-50`}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording ? <Square className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              <button
                onClick={() => handleSend()}
                disabled={!input.trim() || isLoading || isMicBusy}
                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                aria-label="Send message"
              >
                <Send className="w-5 h-5" />
              </button>
            </div>
            {(isMicBusy || recorderError) && (
              <p className={`mt-2 text-xs ${recorderState === 'error' ? 'text-red-400' : 'text-muted-foreground'}`}>
                {isRecording
                  ? 'Listening... tap the stop button when you finish speaking.'
                  : isTranscribing
                    ? 'Transcribing your audio...'
                    : recorderState === 'requesting_permission'
                      ? 'Waiting for microphone permission...'
                      : recorderError}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="relative inline-block">
        <button
          onClick={() => setIsOpen(!isOpen)}
          onMouseEnter={() => setShowTooltip(false)}
          className="w-14 h-14 bg-primary text-primary-foreground rounded-full shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-center hover:scale-110 relative group"
          aria-label={isOpen ? 'Close chat' : 'Open chat'}
        >
          {isOpen ? (
            <X className="w-6 h-6" />
          ) : (
            <span className="relative flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
              <span
                className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-green-500 border-2 border-background shadow-sm"
                aria-hidden="true"
              />
            </span>
          )}
          {/* Pulse ring effect */}
          {!isOpen && (
            <div className="absolute inset-0 rounded-full bg-primary opacity-0 group-hover:opacity-20 animate-ping" />
          )}
        </button>

        {/* Tooltip */}
        {showTooltip && (
          <div className="absolute right-full mr-4 top-1/2 -translate-y-1/2 whitespace-nowrap bg-foreground text-background px-4 py-2 rounded-lg shadow-xl text-sm font-medium animate-in fade-in slide-in-from-right-5 duration-300">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              <span>Chat with portfolio assistant</span>
            </div>
            {/* Arrow */}
            <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 rotate-45 w-2 h-2 bg-foreground" />
          </div>
        )}
      </div>
    </div>
  )
}
