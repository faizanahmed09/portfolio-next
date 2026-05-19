import { NextResponse } from 'next/server'
import { indexPortfolioData, storeDocuments } from '@/lib/embeddings'
import { supabaseAdmin } from '@/lib/supabase'
import portfolioData from '@/data/portfolio.json'

export async function POST() {
  try {
    const { error: deleteError } = await supabaseAdmin
      .from('portfolio_documents')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')

    if (deleteError) {
      console.error('Error clearing existing documents:', deleteError)
    }

    const documents = await indexPortfolioData(portfolioData)
    const results = await storeDocuments(documents)

    return NextResponse.json({
      success: true,
      message: `Indexed ${results.length} documents`,
      documents: results,
    })
  } catch (error) {
    console.error('Embedding error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to embed portfolio data' },
      { status: 500 }
    )
  }
}

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from('portfolio_documents')
      .select('id, category, metadata')
      .limit(10)

    if (error) throw error

    return NextResponse.json({
      count: data?.length || 0,
      documents: data,
    })
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch documents' },
      { status: 500 }
    )
  }
}