import type { FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

export async function registerWeb(app: FastifyInstance, root: string) {
  app.addHook('onSend', async (request, reply) => {
    if (!request.url.startsWith('/api/')) {
      const rendersConsultationRoom = /^\/(patient|portal)(?:[/?]|$)/.test(request.url)
      reply.header('Cache-Control', 'no-store')
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.telnyx.com wss://video.telnyx.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
      )
      reply.header(
        'Permissions-Policy',
        rendersConsultationRoom
          ? 'camera=(self), microphone=(self), geolocation=()'
          : 'camera=(), microphone=(), geolocation=()'
      )
    }
  })
  await app.register(fastifyStatic, { root, index: 'index.html', dotfiles: 'ignore' })
}
