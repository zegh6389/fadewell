import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { CONSULTATION_ROUTE_PATTERN, PRIVATE_CSP, PRIVATE_PERMISSIONS, STAFF_PERMISSIONS } from './security-headers.ts'

export async function registerWeb(app: FastifyInstance, root: string) {
  // The private-route headers are set in app.ts's onRequest hook. This hook only
  // has to cover the public bundle, so it reuses the same constants rather than
  // repeating the policy strings.
  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) return
    reply.header('Cache-Control', 'no-store')
    reply.header('Content-Security-Policy', PRIVATE_CSP)
    reply.header(
      'Permissions-Policy',
      CONSULTATION_ROUTE_PATTERN.test(request.url) ? PRIVATE_PERMISSIONS : STAFF_PERMISSIONS
    )
  })
  await app.register(fastifyStatic, { root, index: 'index.html', dotfiles: 'ignore' })
}
