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

type PayrollSummary = {
  today: { count: number; total_sol: number; total_usd: number }
  week: { count: number; total_sol: number; total_usd: number }
  month: { count: number; total_sol: number; total_usd: number }
  allTime: { count: number; total_sol: number; total_usd: number }
  perWorker: { recipient_discord_id: string; username: string; pay_count: number; total_sol: number; total_usd: number; last_paid: string }[]
  dailyBreakdown: { date: string; count: number; total_sol: number; total_usd: number }[]
}

type PayoutRecord = {
  id: number
  recipient_discord_id: string
  recipient_username: string
  recipient_address: string
  amount_sol: number
  amount_usd: number | null
  sol_price_at_time: number | null
  tx_signature: string | null
  status: string
  memo: string | null
  paid_by: string
  paid_at: string
}

type Props = { guildId: string; isOwner?: boolean; userRole?: string }

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

export default function Workers({ guildId, isOwner, userRole }: Props) {
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
  // Payroll state
  const [tab, setTab] = useState<'workers' | 'payroll'>('workers')
  const [showPayModal, setShowPayModal] = useState(false)
  const [payTarget, setPayTarget] = useState<WorkerDetail | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMemo, setPayMemo] = useState('')
  const [payLoading, setPayLoading] = useState(false)
  const [payError, setPayError] = useState('')
  const [paySuccess, setPaySuccess] = useState<{ signature: string; amount_sol: number; amount_usd: number | null } | null>(null)
  const [payTargetWallet, setPayTargetWallet] = useState<string | null>(null)
  const [payrollSummary, setPayrollSummary] = useState<PayrollSummary | null>(null)
  const [payrollHistory, setPayrollHistory] = useState<PayoutRecord[]>([])
  const [payrollPeriod, setPayrollPeriod] = useState<'day' | 'week' | 'month' | 'all'>('month')
  const [payrollLoading, setPayrollLoading] = useState(false)
  const strictOwner = userRole === 'owner'

  const fetchWorkers = useCallback(() => {
    if (!guildId) return
    setLoading(true)
    api.get(`/admin/guilds/${guildId}/workers?days=${days}`)
      .then(r => setWorkers(r.data || []))
      .catch(() => setWorkers([]))
      .finally(() => setLoading(false))
  }, [guildId, days])

  useEffect(() => { fetchWorkers() }, [fetchWorkers])

  // Fetch payroll data when payroll tab is active
  const fetchPayroll = useCallback(() => {
    if (!guildId) return
    setPayrollLoading(true)
    Promise.all([
      api.get(`/admin/guilds/${guildId}/payroll?period=${payrollPeriod}`),
      api.get(`/admin/guilds/${guildId}/payroll/history?limit=100`)
    ])
      .then(([summaryRes, historyRes]) => {
        setPayrollSummary(summaryRes.data)
        setPayrollHistory(historyRes.data || [])
      })
      .catch(() => {})
      .finally(() => setPayrollLoading(false))
  }, [guildId, payrollPeriod])

  useEffect(() => {
    if (tab === 'payroll') fetchPayroll()
  }, [tab, fetchPayroll])

  const openPayModal = async (worker: WorkerDetail) => {
    setPayTarget(worker)
    setPayAmount('')
    setPayMemo('')
    setPayError('')
    setPaySuccess(null)
    setPayTargetWallet(null)
    setShowPayModal(true)
    // Fetch wallet status
    try {
      const r = await api.get(`/admin/guilds/${guildId}/workers/${worker.discord_id}/wallet`)
      setPayTargetWallet(r.data?.wallet_address || null)
    } catch { setPayTargetWallet(null) }
  }

  const handlePay = async () => {
    if (!payTarget || !payAmount) return
    setPayLoading(true)
    setPayError('')
    setPaySuccess(null)
    try {
      const r = await api.post(`/admin/guilds/${guildId}/workers/${payTarget.discord_id}/pay`, {
        amount: Number(payAmount),
        memo: payMemo || undefined
      })
      setPaySuccess({ signature: r.data.signature, amount_sol: r.data.amount_sol, amount_usd: r.data.amount_usd })
      fetchWorkers()
      fetchPayroll()
    } catch (e: any) {
      setPayError(e?.response?.data?.message || e?.response?.data?.error || 'Payment failed')
    }
    setPayLoading(false)
  }

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
          {tab === 'workers' && (
            <>
              <select className="form-select" value={days} onChange={e => setDays(Number(e.target.value))}>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={90}>Last 90 days</option>
              </select>
              <button className="btn btn-primary" onClick={openAddModal}>+ Add Worker</button>
            </>
          )}
          {tab === 'payroll' && (
            <select className="form-select" value={payrollPeriod} onChange={e => setPayrollPeriod(e.target.value as any)}>
              <option value="day">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="payroll-tabs">
        <button className={`payroll-tab ${tab === 'workers' ? 'payroll-tab-active' : ''}`} onClick={() => setTab('workers')}>
          👥 Workers
        </button>
        <button className={`payroll-tab ${tab === 'payroll' ? 'payroll-tab-active' : ''}`} onClick={() => setTab('payroll')}>
          💰 Payroll
        </button>
      </div>

      {tab === 'workers' && (
        <>
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
                    onPay={strictOwner ? openPayModal : undefined}
                    isOwner={strictOwner}
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
        </>
      )}

      {tab === 'payroll' && (
        <PayrollPanel
          summary={payrollSummary}
          history={payrollHistory}
          loading={payrollLoading}
          period={payrollPeriod}
        />
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

      {/* Pay worker modal */}
      {showPayModal && payTarget && (
        <div className="modal-overlay" onClick={() => { if (!payLoading) setShowPayModal(false) }}>
          <div className="modal-card payroll-pay-modal" onClick={e => e.stopPropagation()}>
            {paySuccess ? (
              <div className="payroll-success">
                <span style={{ fontSize: 48 }}>✅</span>
                <h3>Payment Sent!</h3>
                <p>◎ {paySuccess.amount_sol.toFixed(4)} SOL sent to {payTarget.display_name || payTarget.username}</p>
                {paySuccess.amount_usd != null && <p className="text-muted">≈ ${paySuccess.amount_usd.toFixed(2)} USD</p>}
                <a
                  href={`https://solscan.io/tx/${paySuccess.signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-secondary"
                  style={{ marginTop: 12 }}
                >
                  View on Solscan ↗
                </a>
                <button className="btn btn-primary" onClick={() => setShowPayModal(false)} style={{ marginTop: 8 }}>Close</button>
              </div>
            ) : (
              <>
                <h3>💸 Pay Worker</h3>
                <p className="text-muted">Send SOL from guild treasury to {payTarget.display_name || payTarget.username}</p>
                {payError && <div className="form-error">{payError}</div>}

                <div className="payroll-pay-recipient">
                  <div className="worker-avatar-wrap">
                    {payTarget.avatar ? (
                      <img src={payTarget.avatar} alt="" className="worker-avatar" />
                    ) : (
                      <div className="worker-avatar worker-avatar-placeholder">{(payTarget.display_name || payTarget.username || '?')[0].toUpperCase()}</div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payTarget.display_name || payTarget.username}</div>
                    <span className={`worker-role-badge worker-role-badge-${payTarget.role}`}>
                      {payTarget.role === 'admin' ? '🔴 Admin' : '🔵 Staff'}
                    </span>
                  </div>
                </div>

                <div className="payroll-wallet-status">
                  {payTargetWallet ? (
                    <div className="payroll-wallet-connected">
                      <span>🟢 Wallet Connected</span>
                      <code>{payTargetWallet.slice(0, 6)}...{payTargetWallet.slice(-4)}</code>
                    </div>
                  ) : (
                    <div className="payroll-wallet-missing">
                      <span>🔴 No Wallet Connected</span>
                      <span className="text-muted">Worker must run <code>/user-wallet connect</code></span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
                  <div>
                    <label className="payroll-label">Amount (SOL)</label>
                    <input
                      type="number"
                      className="form-input"
                      placeholder="0.00"
                      step="0.0001"
                      min="0.0001"
                      max="1000"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      disabled={payLoading}
                    />
                  </div>
                  <div>
                    <label className="payroll-label">Memo (optional)</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Weekly salary, Bonus, etc."
                      value={payMemo}
                      onChange={e => setPayMemo(e.target.value)}
                      disabled={payLoading}
                      maxLength={100}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                    <button className="btn btn-secondary" onClick={() => setShowPayModal(false)} disabled={payLoading}>Cancel</button>
                    <button
                      className="btn btn-pay"
                      onClick={handlePay}
                      disabled={payLoading || !payAmount || Number(payAmount) <= 0 || !payTargetWallet}
                    >
                      {payLoading ? '⏳ Sending...' : `💸 Send ◎${payAmount || '0'} SOL`}
                    </button>
                  </div>
                </div>
              </>
            )}
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

function WorkerDetailPanel({ worker, onRoleChange, onRemove, onPay, isOwner }: { worker: WorkerDetail; onRoleChange: (id: string, role: 'staff' | 'admin') => void; onRemove: (id: string) => void; onPay?: (w: WorkerDetail) => void; isOwner?: boolean }) {
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
          {onPay && isOwner && (
            <button className="btn btn-pay btn-sm" onClick={() => onPay(worker)}>💸 Pay</button>
          )}
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
    case 'payout_received': return '💰'
    case 'role_assigned': return '✨'
    case 'role_removed': return '🚫'
    case 'role_promoted': return '⬆️'
    case 'role_demoted': return '⬇️'
    case 'role_changed': return '🔄'
    case 'message': return '💬'
    default: return '📋'
  }
}

// ---- Payroll Panel ----

function PayrollPanel({ summary, history, loading, period }: {
  summary: PayrollSummary | null
  history: PayoutRecord[]
  loading: boolean
  period: string
}) {
  if (loading) return <div className="loading-state">Loading payroll data...</div>
  if (!summary) return <div className="empty-state"><h3>No Payroll Data</h3><p>Pay your staff from the Workers tab to see payroll reports here.</p></div>

  const periodLabel = period === 'day' ? 'Today' : period === 'week' ? 'This Week' : period === 'month' ? 'This Month' : 'All Time'

  return (
    <div className="payroll-panel">
      {/* Period summary cards */}
      <div className="payroll-summary-grid">
        <div className={`payroll-summary-card ${period === 'day' ? 'payroll-summary-card-active' : ''}`}>
          <span className="payroll-summary-card-icon">📅</span>
          <span className="payroll-summary-card-label">Today</span>
          <span className="payroll-summary-card-value">◎ {(summary.today.total_sol || 0).toFixed(4)}</span>
          <span className="payroll-summary-card-sub">{summary.today.count} payment{summary.today.count !== 1 ? 's' : ''}{summary.today.total_usd ? ` · $${summary.today.total_usd.toFixed(2)}` : ''}</span>
        </div>
        <div className={`payroll-summary-card ${period === 'week' ? 'payroll-summary-card-active' : ''}`}>
          <span className="payroll-summary-card-icon">📆</span>
          <span className="payroll-summary-card-label">This Week</span>
          <span className="payroll-summary-card-value">◎ {(summary.week.total_sol || 0).toFixed(4)}</span>
          <span className="payroll-summary-card-sub">{summary.week.count} payment{summary.week.count !== 1 ? 's' : ''}{summary.week.total_usd ? ` · $${summary.week.total_usd.toFixed(2)}` : ''}</span>
        </div>
        <div className={`payroll-summary-card ${period === 'month' ? 'payroll-summary-card-active' : ''}`}>
          <span className="payroll-summary-card-icon">🗓️</span>
          <span className="payroll-summary-card-label">This Month</span>
          <span className="payroll-summary-card-value">◎ {(summary.month.total_sol || 0).toFixed(4)}</span>
          <span className="payroll-summary-card-sub">{summary.month.count} payment{summary.month.count !== 1 ? 's' : ''}{summary.month.total_usd ? ` · $${summary.month.total_usd.toFixed(2)}` : ''}</span>
        </div>
        <div className={`payroll-summary-card ${period === 'all' ? 'payroll-summary-card-active' : ''}`}>
          <span className="payroll-summary-card-icon">🏦</span>
          <span className="payroll-summary-card-label">All Time</span>
          <span className="payroll-summary-card-value">◎ {(summary.allTime.total_sol || 0).toFixed(4)}</span>
          <span className="payroll-summary-card-sub">{summary.allTime.count} payment{summary.allTime.count !== 1 ? 's' : ''}{summary.allTime.total_usd ? ` · $${summary.allTime.total_usd.toFixed(2)}` : ''}</span>
        </div>
      </div>

      {/* Per-worker breakdown */}
      {summary.perWorker.length > 0 && (
        <div className="payroll-section">
          <h4>👥 Per-Worker Breakdown ({periodLabel})</h4>
          <div className="payroll-table">
            <div className="payroll-table-header">
              <span>Worker</span>
              <span>Payments</span>
              <span>Total SOL</span>
              <span>Total USD</span>
              <span>Last Paid</span>
            </div>
            {summary.perWorker.map(pw => (
              <div key={pw.recipient_discord_id} className="payroll-table-row">
                <span className="payroll-table-name">{pw.username || pw.recipient_discord_id}</span>
                <span>{pw.pay_count}</span>
                <span className="payroll-sol">◎ {(pw.total_sol || 0).toFixed(4)}</span>
                <span>{pw.total_usd ? `$${pw.total_usd.toFixed(2)}` : '—'}</span>
                <span className="text-muted">{pw.last_paid ? timeAgo(pw.last_paid) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Daily breakdown chart (text-based) */}
      {summary.dailyBreakdown.length > 0 && (
        <div className="payroll-section">
          <h4>📊 Daily Spending (Last 30 Days)</h4>
          <div className="payroll-daily-chart">
            {summary.dailyBreakdown.slice(0, 14).map(d => {
              const maxSol = Math.max(...summary.dailyBreakdown.map(dd => dd.total_sol), 0.0001)
              const pct = Math.min(100, (d.total_sol / maxSol) * 100)
              return (
                <div key={d.date} className="payroll-daily-row">
                  <span className="payroll-daily-date">{new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                  <div className="payroll-daily-bar-wrap">
                    <div className="payroll-daily-bar" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="payroll-daily-amount">◎ {d.total_sol.toFixed(4)}</span>
                  <span className="payroll-daily-count">{d.count}x</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Recent payout history */}
      <div className="payroll-section">
        <h4>📜 Payout History</h4>
        {history.length === 0 ? (
          <p className="text-muted">No payouts yet.</p>
        ) : (
          <div className="payroll-history-list">
            {history.map(h => (
              <div key={h.id} className={`payroll-history-item payroll-history-${h.status}`}>
                <div className="payroll-history-left">
                  <span className="payroll-history-icon">{h.status === 'confirmed' ? '✅' : h.status === 'pending' ? '⏳' : '❌'}</span>
                  <div>
                    <div className="payroll-history-name">{h.recipient_username || h.recipient_discord_id}</div>
                    {h.memo && <div className="payroll-history-memo">{h.memo}</div>}
                  </div>
                </div>
                <div className="payroll-history-right">
                  <span className="payroll-history-amount">◎ {h.amount_sol.toFixed(4)}</span>
                  {h.amount_usd != null && <span className="payroll-history-usd">${h.amount_usd.toFixed(2)}</span>}
                  <span className="payroll-history-time">{timeAgo(h.paid_at)}</span>
                  {h.tx_signature && (
                    <a href={`https://solscan.io/tx/${h.tx_signature}`} target="_blank" rel="noopener noreferrer" className="payroll-history-tx" title="View on Solscan">↗</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
