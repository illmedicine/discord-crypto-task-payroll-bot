import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { api } from '../api'
import TaskRow from '../components/TaskRow'
import { FixedSizeList as List } from 'react-window'

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
        <div className="table">
          <div className="table-head">
            <div className="col col-id">ID</div>
            <div className="col col-title">Recipient</div>
            <div className="col col-prize">Amount</div>
            <div className="col col-status">Status</div>
            <div className="col col-actions">Actions</div>
          </div>
          <List
            height={300}
            itemCount={tasks.length}
            itemSize={56}
            width={'100%'}
            itemKey={index => tasks[index].id}
          >
            {({ index, style }) => (
              <TaskRow task={tasks[index]} style={style} onExecute={async (id) => { await api.post(`/tasks/${id}/execute`); setLoading(true); api.get('/tasks').then(r => setTasks(r.data)).finally(() => setLoading(false)); }} />
            )}
          </List>
        </div>
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
