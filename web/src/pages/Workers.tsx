import React, { useEffect, useState, useCallback } from 'react'
import { api } from '../api'

type Worker = {
  discord_id: string
  username: string
  display_name: string
  role: 'admin' | 'staff'
  avatar: string | null
  status: string
  added_at: string
  joined_guild_at: string | null
  account_created_at: string | null
  last_active: string | null
  total_commands: number
  total_messages: number
  total_payouts_issued: number
  total_payout_amount: number
  total_proofs_reviewed: number
  total_online_minutes: number
  active_days: number
}

type WorkerDetail = Worker & {
  activity: Activity[]
}

type Activity = {
  id: number
  action_type: string
  detail: string
  amount: number | null
  currency: string | null
  channel_id: string | null
  created_at: string
}

type GuildMember = {
  id: string
  username: string
  display_name: string
  avatar: string | null
}

type Props = { guildId: string }

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

function formatMinutes(mins: number): string {
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 24) return `${h}h ${m}m`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

const STATUS_COLORS: Record<string, string> = {
  online: '#10b981',
  idle: '#f59e0b',
  dnd: '#ef4444',
  offline: '#64748b',
}

export default function Workers({ guildId }: Props) {
  const [workers, setWorkers] = useState<Worker[]>([])
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [selectedWorker, setSelectedWorker] = useState<WorkerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [members, setMembers] = useState<GuildMember[]>([])
  const [addId, setAddId] = useState('')
  const [addRole, setAddRole] = useState<'staff' | 'admin'>('staff')
  const [error, setError] = useState('')

  const fetchWorkers = useCallback(() => {
    if (!guildId) return
    setLoading(true)
    api.get(`/admin/guilds/${guildId}/workers?days=${days}`)
      .then(r => setWorkers(r.data || []))
      .catch(() => setWorkers([]))
      .finally(() => setLoading(false))
  }, [guildId, days])

  useEffect(() => { fetchWorkers() }, [fetchWorkers])

  const openDetail = async (discordId: string) => {
    setDetailLoading(true)
    setSelectedWorker(null)
    try {
      const r = await api.get(`/admin/guilds/${guildId}/workers/${discordId}`)
      setSelectedWorker(r.data)
    } catch { setSelectedWorker(null) }
    setDetailLoading(false)
  }

  const handleAdd = async () => {
    if (!addId) return
    setError('')
    try {
      await api.post(`/admin/guilds/${guildId}/workers`, { discord_id: addId, role: addRole })
      setShowAddModal(false)
      setAddId('')
      fetchWorkers()
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to add worker')
    }
  }

  const handleRemove = async (discordId: string) => {
    if (!confirm('Remove this worker?')) return
    try {
      await api.delete(`/admin/guilds/${guildId}/workers/${discordId}`)
      setSelectedWorker(null)
      fetchWorkers()
    } catch {}
  }

  const handleRoleChange = async (discordId: string, newRole: 'staff' | 'admin') => {
    try {
      await api.patch(`/admin/guilds/${guildId}/workers/${discordId}`, { role: newRole })
      fetchWorkers()
      if (selectedWorker?.discord_id === discordId) {
        setSelectedWorker(prev => prev ? { ...prev, role: newRole } : null)
      }
    } catch {}
  }

  const openAddModal = async () => {
    setShowAddModal(true)
    setMembers([])
    try {
      const r = await api.get(`/admin/guilds/${guildId}/members`)
      const existingIds = new Set(workers.map(w => w.discord_id))
      setMembers((r.data || []).filter((m: GuildMember) => !existingIds.has(m.id)))
    } catch {}
  }

  const admins = workers.filter(w => w.role === 'admin')
  const staff = workers.filter(w => w.role === 'staff')

  // Summary stats
  const totalCommands = workers.reduce((s, w) => s + w.total_commands, 0)
  const totalPayouts = workers.reduce((s, w) => s + w.total_payouts_issued, 0)
  const totalPayoutAmt = workers.reduce((s, w) => s + w.total_payout_amount, 0)
  const totalMessages = workers.reduce((s, w) => s + w.total_messages, 0)

  return (
    <div className="workers-page">
      <div className="page-header">
        <div>
          <h2>👥 Workers</h2>
          <p className="text-muted">Manage DCB Staff & Admins — track activity, payouts, and engagement</p>
        </div>
        <div className="page-header-actions">
          <select className="form-select" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="btn btn-primary" onClick={openAddModal}>+ Add Worker</button>
        </div>
      </div>

      {/* Summary stats bar */}
      <div className="workers-summary-bar">
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{workers.length}</span>
          <span className="workers-summary-label">Total Workers</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{admins.length}</span>
          <span className="workers-summary-label">Admins</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{staff.length}</span>
          <span className="workers-summary-label">Staff</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{totalCommands.toLocaleString()}</span>
          <span className="workers-summary-label">Commands Run</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{totalPayouts}</span>
          <span className="workers-summary-label">Payouts Issued</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">◎ {totalPayoutAmt.toFixed(2)}</span>
          <span className="workers-summary-label">Total Paid Out</span>
        </div>
        <div className="workers-summary-stat">
          <span className="workers-summary-value">{totalMessages.toLocaleString()}</span>
          <span className="workers-summary-label">Messages</span>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">Loading workers...</div>
      ) : workers.length === 0 ? (
        <div className="empty-state">
          <h3>No Workers Configured</h3>
          <p>Use the <strong>+ Add Worker</strong> button above or the <code>/dcb-role assign</code> command in Discord to add staff members.</p>
        </div>
      ) : (
        <div className="workers-layout">
          {/* Workers list */}
          <div className="workers-list">
            {admins.length > 0 && (
              <>
                <div className="workers-section-label"><span className="role-dot role-dot-admin" /> DCB Admins ({admins.length})</div>
                {admins.map(w => (
                  <WorkerCard key={w.discord_id} worker={w} onSelect={openDetail} selected={selectedWorker?.discord_id === w.discord_id} />
                ))}
              </>
            )}
            {staff.length > 0 && (
              <>
                <div className="workers-section-label"><span className="role-dot role-dot-staff" /> DCB Staff ({staff.length})</div>
                {staff.map(w => (
                  <WorkerCard key={w.discord_id} worker={w} onSelect={openDetail} selected={selectedWorker?.discord_id === w.discord_id} />
                ))}
              </>
            )}
          </div>

          {/* Detail panel */}
          <div className="workers-detail">
            {detailLoading ? (
              <div className="loading-state">Loading details...</div>
            ) : selectedWorker ? (
              <WorkerDetailPanel
                worker={selectedWorker}
                onRoleChange={handleRoleChange}
                onRemove={handleRemove}
              />
            ) : (
              <div className="workers-detail-placeholder">
                <span style={{ fontSize: 48 }}>👤</span>
                <p>Select a worker to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add worker modal */}
      {showAddModal && (
        <div className="modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h3>Add Worker</h3>
            <p className="text-muted">Select a guild member and assign a DCB role</p>
            {error && <div className="form-error">{error}</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <select className="form-select" value={addId} onChange={e => setAddId(e.target.value)}>
                <option value="">Select member...</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.display_name} ({m.username})</option>
                ))}
              </select>
              <select className="form-select" value={addRole} onChange={e => setAddRole(e.target.value as any)}>
                <option value="staff">DCB Staff</option>
                <option value="admin">DCB Admin</option>
              </select>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setShowAddModal(false)}>Cancel</button>
                <button className="btn btn-primary" onClick={handleAdd} disabled={!addId}>Add Worker</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---- Sub-components ----

function WorkerCard({ worker, onSelect, selected }: { worker: Worker; onSelect: (id: string) => void; selected: boolean }) {
  return (
    <div className={`worker-card ${selected ? 'worker-card-selected' : ''}`} onClick={() => onSelect(worker.discord_id)}>
      <div className="worker-card-left">
        <div className="worker-avatar-wrap">
          {worker.avatar ? (
            <img src={worker.avatar} alt="" className="worker-avatar" />
          ) : (
            <div className="worker-avatar worker-avatar-placeholder">{(worker.display_name || worker.username || '?')[0].toUpperCase()}</div>
          )}
          <span className="worker-status-dot" style={{ background: STATUS_COLORS[worker.status] || STATUS_COLORS.offline }} title={worker.status} />
        </div>
        <div className="worker-card-info">
          <div className="worker-card-name">
            {worker.display_name || worker.username}
            <span className={`worker-role-badge worker-role-badge-${worker.role}`}>{worker.role === 'admin' ? '🔴 Admin' : '🔵 Staff'}</span>
          </div>
          <div className="worker-card-meta">
            Last active: {timeAgo(worker.last_active)} · {worker.total_commands} cmds · {worker.total_payouts_issued} payouts
          </div>
        </div>
      </div>
      <div className="worker-card-right">
        <div className="worker-card-stat">
          <span className="worker-card-stat-value">{formatMinutes(worker.total_online_minutes)}</span>
          <span className="worker-card-stat-label">Online</span>
        </div>
        <div className="worker-card-stat">
          <span className="worker-card-stat-value">{worker.active_days}d</span>
          <span className="worker-card-stat-label">Active</span>
        </div>
      </div>
    </div>
  )
}

function WorkerDetailPanel({ worker, onRoleChange, onRemove }: { worker: WorkerDetail; onRoleChange: (id: string, role: 'staff' | 'admin') => void; onRemove: (id: string) => void }) {
  return (
    <div className="worker-detail-content">
      <div className="worker-detail-header">
        <div className="worker-avatar-wrap worker-avatar-wrap-lg">
          {worker.avatar ? (
            <img src={worker.avatar} alt="" className="worker-avatar worker-avatar-lg" />
          ) : (
            <div className="worker-avatar worker-avatar-lg worker-avatar-placeholder">{(worker.display_name || worker.username || '?')[0].toUpperCase()}</div>
          )}
          <span className="worker-status-dot worker-status-dot-lg" style={{ background: STATUS_COLORS[worker.status] || STATUS_COLORS.offline }} />
        </div>
        <div>
          <h3 className="worker-detail-name">{worker.display_name || worker.username}</h3>
          <span className={`worker-role-badge worker-role-badge-${worker.role}`}>{worker.role === 'admin' ? '🔴 DCB Admin' : '🔵 DCB Staff'}</span>
        </div>
        <div className="worker-detail-actions">
          <select className="form-select form-select-sm" value={worker.role} onChange={e => onRoleChange(worker.discord_id, e.target.value as any)}>
            <option value="staff">DCB Staff</option>
            <option value="admin">DCB Admin</option>
          </select>
          <button className="btn btn-sm btn-danger" onClick={() => onRemove(worker.discord_id)}>Remove</button>
        </div>
      </div>

      {/* Meta info */}
      <div className="worker-detail-meta">
        {worker.joined_guild_at && (
          <span>Joined server: {new Date(worker.joined_guild_at).toLocaleDateString()}</span>
        )}
        {worker.account_created_at && (
          <span>Account age: {Math.floor((Date.now() - new Date(worker.account_created_at).getTime()) / 86400000)}d</span>
        )}
        <span>DCB role since: {new Date(worker.added_at).toLocaleDateString()}</span>
        <span>Last active: {timeAgo(worker.last_active)}</span>
      </div>

      {/* Stats grid */}
      <div className="worker-stats-grid">
        <StatBox label="Commands Run" value={worker.total_commands?.toLocaleString() || '0'} icon="⌨️" />
        <StatBox label="Messages Sent" value={worker.total_messages?.toLocaleString() || '0'} icon="💬" />
        <StatBox label="Payouts Issued" value={String(worker.total_payouts_issued || 0)} icon="💸" />
        <StatBox label="Payout Volume" value={`◎ ${(worker.total_payout_amount || 0).toFixed(2)}`} icon="💰" />
        <StatBox label="Proofs Reviewed" value={String(worker.total_proofs_reviewed || 0)} icon="✅" />
        <StatBox label="Online Time" value={formatMinutes(worker.total_online_minutes || 0)} icon="🟢" />
        <StatBox label="Active Days" value={`${worker.active_days || 0}d / 30d`} icon="📅" />
        <StatBox label="Status" value={worker.status || 'offline'} icon={worker.status === 'online' ? '🟢' : worker.status === 'idle' ? '🌙' : worker.status === 'dnd' ? '⛔' : '⚫'} />
      </div>

      {/* Activity feed */}
      <div className="worker-activity-section">
        <h4>Recent Activity</h4>
        {(!worker.activity || worker.activity.length === 0) ? (
          <p className="text-muted">No recent activity recorded</p>
        ) : (
          <div className="worker-activity-list">
            {worker.activity.slice(0, 30).map(a => (
              <div key={a.id} className="worker-activity-item">
                <span className="worker-activity-type">{activityIcon(a.action_type)}</span>
                <span className="worker-activity-detail">{a.detail || a.action_type}</span>
                {a.amount != null && <span className="worker-activity-amount">◎ {a.amount}</span>}
                <span className="worker-activity-time">{timeAgo(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="worker-stat-box">
      <span className="worker-stat-icon">{icon}</span>
      <span className="worker-stat-value">{value}</span>
      <span className="worker-stat-label">{label}</span>
    </div>
  )
}

function activityIcon(type: string): string {
  switch (type) {
    case 'command': return '⌨️'
    case 'payout': return '💸'
    case 'role_assigned': return '✨'
    case 'role_removed': return '🚫'
    case 'role_promoted': return '⬆️'
    case 'role_demoted': return '⬇️'
    case 'role_changed': return '🔄'
    case 'message': return '💬'
    default: return '📋'
  }
}
