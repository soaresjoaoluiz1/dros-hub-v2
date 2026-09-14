import db from './db.js'
import { sendToUser } from './sse.js'

export function notify(userId, type, title, message, taskId, triggeredBy) {
  if (userId === triggeredBy) return null // don't self-notify
  const result = db.prepare('INSERT INTO notifications (user_id, type, title, message, task_id, triggered_by) VALUES (?, ?, ?, ?, ?, ?)').run(userId, type, title, message || null, taskId || null, triggeredBy || null)
  const notification = db.prepare('SELECT n.*, u.name as triggered_by_name FROM notifications n LEFT JOIN users u ON n.triggered_by = u.id WHERE n.id = ?').get(result.lastInsertRowid)
  sendToUser(userId, 'notification:new', notification)
  return notification
}

export function notifyMany(userIds, type, title, message, taskId, triggeredBy) {
  for (const uid of userIds) notify(uid, type, title, message, taskId, triggeredBy)
}

export function getDonoUsers() {
  return db.prepare("SELECT id FROM users WHERE role IN ('dono', 'gerente') AND is_active = 1").all()
}

export function getClientUsers(clientId) {
  return db.prepare("SELECT id FROM users WHERE role = 'cliente' AND client_id = ? AND is_active = 1").all(clientId)
}
