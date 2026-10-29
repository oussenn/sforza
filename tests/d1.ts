import { DatabaseSync } from 'node:sqlite'

type Params = (string | number | null)[]

/** Enough of D1 for the Worker's queries, on Node's built-in SQLite in memory. */
export function memoryD1(): D1Database {
  const db = new DatabaseSync(':memory:')
  const plain = (row: unknown) => ({ ...(row as Record<string, unknown>) })
  const statement = (sql: string, params: Params = []) => ({
    bind: (...args: Params) => statement(sql, args),
    async first<T>(column?: string): Promise<T | null> {
      const row = db.prepare(sql).get(...params)
      return (row ? (column ? plain(row)[column] : plain(row)) : null) as T | null
    },
    async all<T>() {
      return { results: db.prepare(sql).all(...params).map(plain) as T[], success: true, meta: {} }
    },
    async run() {
      const { changes } = db.prepare(sql).run(...params)
      return { results: [], success: true, meta: { changes: Number(changes) } }
    },
  })
  return {
    prepare: (sql: string) => statement(sql),
    async batch(statements: ReturnType<typeof statement>[]) {
      db.exec('BEGIN')
      try {
        const results = []
        for (const s of statements) results.push(await s.all())
        db.exec('COMMIT')
        return results
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
    async exec(sql: string) {
      db.exec(sql)
      return { count: 1, duration: 0 }
    },
  } as unknown as D1Database
}
