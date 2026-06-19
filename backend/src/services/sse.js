const clients = new Map()

const addClient = (userId, res) => {
  if (!clients.has(userId)) clients.set(userId, new Set())
  clients.get(userId).add(res)
}

const removeClient = (userId, res) => {
  if (clients.has(userId)) {
    clients.get(userId).delete(res)
    if (clients.get(userId).size === 0) clients.delete(userId)
  }
}

const sendToCircleMembers = async (circleId, event, data) => {
  const { query } = require('../config/db')
  const result = await query('SELECT user_id FROM circle_members WHERE circle_id = $1', [circleId])
  for (const row of result.rows) {
    sendToUser(row.user_id, event, data)
  }
}

const sendToUser = (userId, event, data) => {
  if (!clients.has(userId)) return
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients.get(userId)) {
    try { res.write(message) } catch (e) { removeClient(userId, res) }
  }
}

const sendToAllConnected = (event, data) => {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const [userId, resSet] of clients.entries()) {
    for (const res of resSet) {
      try { res.write(message) } catch (e) { removeClient(userId, res) }
    }
  }
}

const getConnectedCount = () => {
  let count = 0
  for (const resSet of clients.values()) count += resSet.size
  return count
}

module.exports = { addClient, removeClient, sendToCircleMembers, sendToUser, sendToAllConnected, getConnectedCount }
