import { supabaseAdmin } from './supabase'

export interface PortfolioDocument {
  id?: string
  content: string
  metadata: {
    category: string
    title?: string
    company?: string
    institution?: string
    year?: string
    skills?: string[]
    technologies?: string[]
  }
  embedding?: number[]
}

export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2:embedContent?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
          outputDimensionality: 1536,
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('Embedding API error:', error)
      throw new Error(`Embedding API failed: ${response.status}`)
    }

    const data = await response.json()
    return data.embedding.values
  } catch (error) {
    console.error('Error generating embedding:', error)
    throw error
  }
}

export async function searchSimilarDocuments(query: string, limit = 5) {
  try {
    const queryEmbedding = await generateEmbedding(query)

    const { data, error } = await supabaseAdmin.rpc('match_portfolio_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: limit,
    })

    if (error) throw error
    return data || []
  } catch (error) {
    console.error('Error searching documents:', error)
    return []
  }
}

export async function indexPortfolioData(portfolioData: any) {
  const documents: PortfolioDocument[] = []

  const { personalInfo, skills, experience, education, certificates, awards, highlights } =
    portfolioData

  documents.push({
    content: `${personalInfo.name} is a ${personalInfo.role}. ${personalInfo.description}`,
    metadata: {
      category: 'personal_info',
      title: personalInfo.name,
    },
  })

  documents.push({
    content: `${personalInfo.name} is located in ${personalInfo.location} and can be reached at ${personalInfo.email} or ${personalInfo.phone}.`,
    metadata: {
      category: 'contact',
      title: 'Contact Information',
    },
  })

  for (const skillCategory of Object.keys(skills)) {
    const skillList = skills[skillCategory]
    if (Array.isArray(skillList) && skillList.length > 0) {
      documents.push({
        content: `${personalInfo.name} has experience with the following ${skillCategory} skills: ${skillList.join(', ')}.`,
        metadata: {
          category: 'skills',
          title: skillCategory.replace(/([A-Z])/g, ' $1').trim(),
          skills: skillList,
        },
      })
    }
  }

  for (const exp of experience) {
    for (const project of exp.projects || []) {
      const techList = project.technologies?.join(', ') || ''
      documents.push({
        content: `At ${exp.company}, worked on ${project.name}. ${project.description} Achievements: ${project.achievements?.join(' ')} Technologies used: ${techList}.`,
        metadata: {
          category: 'experience',
          title: project.name,
          company: exp.company,
          year: exp.duration,
          technologies: project.technologies,
        },
      })
    }
  }

  for (const edu of education) {
    documents.push({
      content: `${personalInfo.name} completed ${edu.degree} at ${edu.institution} in ${edu.location}. ${edu.status}`,
      metadata: {
        category: 'education',
        title: edu.degree,
        institution: edu.institution,
      },
    })
  }

  for (const cert of certificates) {
    documents.push({
      content: `${personalInfo.name} earned a certificate in ${cert.name} from ${cert.issuer} in ${cert.issueDate}.`,
      metadata: {
        category: 'certificate',
        title: cert.name,
        institution: cert.issuer,
        year: cert.issueDate,
      },
    })
  }

  for (const award of awards) {
    documents.push({
      content: `${personalInfo.name} received the ${award.title} award from ${award.organization} in ${award.year}. ${award.description}`,
      metadata: {
        category: 'award',
        title: award.title,
        institution: award.organization,
        year: award.year,
      },
    })
  }

  documents.push({
    content: `${personalInfo.name} has ${highlights?.yearsExperience || '4+'} years of experience, has completed ${highlights?.projectsCompleted || '9+'} projects, is proficient in ${highlights?.technologies || '30+'} technologies, and has built ${highlights?.sites || '5+'} sites.`,
    metadata: {
      category: 'highlights',
      title: 'Portfolio Highlights',
    },
  })

  return documents
}

export async function storeDocuments(documents: PortfolioDocument[]) {
  const results = []

  for (const doc of documents) {
    try {
      const embedding = await generateEmbedding(doc.content)

      const { data, error } = await supabaseAdmin
        .from('portfolio_documents')
        .insert({
          content: doc.content,
          metadata: doc.metadata,
          embedding,
        })
        .select()

      if (error) {
        console.error('Error storing document:', error)
      } else {
        results.push(data?.[0])
      }
    } catch (error) {
      console.error('Error processing document:', error)
    }
  }

  return results
}