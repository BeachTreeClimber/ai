export type MessageRole = 'user' | 'assistant'

export interface Conversation {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface Message {
  id: number
  conversation_id: string
  role: MessageRole
  content: string
  created_at: string
}
