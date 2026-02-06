import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '../api'

type Task = {
  id: number
  guild_id: string
  recipient_address: string
  amount: number
  status: string
}

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(false)
  const [addr, setAddr] = useState('')
  const [amount, setAmount] = useState('1')

  useEffect(() => {
    setLoading(true)
    api.get('/tasks').then(r => setTasks(r.data)).finally(() => setLoading(false))
  }, [])

  return (
    <div className="container">
      <h2>Tasks</h2>
      {loading ? <p>Loading...</p> : (
        <table>
          <thead>
            <tr><th>ID</th><th>Recipient</th><th>Amount</th><th>Status</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {tasks.map(t => (
              <tr key={t.id}>
                <td>{t.id}</td>
                <td>{t.recipient_address}</td>
                <td>{t.amount}</td>
                <td>{t.status}</td>
                <td>
                  <button onClick={async () => { await api.post(`/tasks/${t.id}/execute`); setLoading(true); api.get('/tasks').then(r => setTasks(r.data)).finally(() => setLoading(false)); }}>Execute</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Create Task</h3>
      <form className="mini-form" onSubmit={async (e) => {
        e.preventDefault();
        const res = await axios.post('/api/tasks', { guild_id: 'TEST_GUILD', recipient_address: addr, amount: parseFloat(amount) });
        setTasks(prev => [res.data, ...prev]); setAddr(''); setAmount('1');
      }}>
        <input placeholder="Recipient Solana Address" value={addr} onChange={e => setAddr(e.target.value)} required />
        <input placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} required />
        <button type="submit">Create</button>
      </form>
    </div>
  )
}
