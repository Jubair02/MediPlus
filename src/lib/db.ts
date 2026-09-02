import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Query logging is noisy and costs throughput — keep it out of production.
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['query', 'warn', 'error'],
    // Prisma's 5s default assumes a local database. Against a remote Postgres every
    // statement costs a network round trip, so a multi-statement interactive
    // transaction (order placement runs a dozen) exceeds it and the transaction is
    // closed mid-flight — surfacing as "Transaction not found".
    transactionOptions: {
      maxWait: 10_000,
      timeout: 30_000,
    },
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db