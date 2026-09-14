// SSE client management — supports account-level and user-level routing
const sseClients = new Map() // accountId -> Set<res>
const userClients = new Map() // userId -> Set<res>

export function addSSEClient(accountId, res) {
  if (!sseClients.has(accountId)) sseClients.set(accountId, new Set())
  sseClients.get(accountId).add(res)
}

export function removeSSEClient(accountId, res) {
  sseClients.get(accountId)?.delete(res)
}

export function addSSEUserClient(userId, res) {
  if (!userClients.has(userId)) userClients.set(userId, new Set())
  userClients.get(userId).add(res)
}

export function removeSSEUserClient(userId, res) {
  userClients.get(userId)?.delete(res)
}

export function broadcastSSE(accountId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const clients = sseClients.get(accountId)
  if (clients) for (const client of clients) client.write(payload)
  const adminClients = sseClients.get('admin')
  if (adminClients) for (const client of adminClients) client.write(payload)
}

export function sendToUser(userId, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  const clients = userClients.get(userId)
  if (clients) for (const client of clients) client.write(payload)
}
