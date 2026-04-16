import fp from 'fastify-plugin'

export default fp(async function authorizePlugin(app) {

  app.decorate('requireRole', function (...roles) {
    return async function (req, reply) {
      await req.jwtVerify()
      if (!roles.includes(req.user.role)) {
        return reply.status(403).send({ error: 'Permesso negato' })
      }
    }
  })

  app.decorate('requireOwnerOrRole', function (...roles) {
    return async function (req, reply) {
      await req.jwtVerify()
      req.allowedRoles = roles
    }
  })

})