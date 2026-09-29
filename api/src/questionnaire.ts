import { z } from 'zod'
import type { Sql } from './db.ts'

export const questionSchema = z.object({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(2000),
  required: z.boolean()
})

export const questionnaireSchema = z.object({
  version: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  questions: z.array(questionSchema).min(1).superRefine((questions, context) => {
    const ids = new Set<string>()
    questions.forEach((question, index) => {
      if (ids.has(question.id)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'Question IDs must be unique'
        })
      }
      ids.add(question.id)
    })
  })
})

export type Question = z.infer<typeof questionSchema>
export type Questionnaire = z.infer<typeof questionnaireSchema>

type RawRow = { version: string; definition: Record<string, unknown> }

function hydrate(row: RawRow): Questionnaire {
  // `version` lives in both the PK column and inside the JSON definition; the column wins on parse.
  return questionnaireSchema.parse({ ...row.definition, version: row.version })
}

export async function loadQuestionnaire(version: string, sql: Sql): Promise<Questionnaire | null> {
  const rows = (
    await sql.query('SELECT version, definition FROM questionnaires WHERE version = $1', [version])
  ).rows as RawRow[]
  return rows[0] ? hydrate(rows[0]) : null
}

export async function loadLatestQuestionnaire(sql: Sql): Promise<Questionnaire | null> {
  const rows = (
    await sql.query(
      'SELECT version, definition FROM questionnaires ORDER BY created_at DESC LIMIT 1'
    )
  ).rows as RawRow[]
  return rows[0] ? hydrate(rows[0]) : null
}
