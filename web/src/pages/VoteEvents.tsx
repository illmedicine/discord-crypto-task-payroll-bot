import React, { useState } from 'react'
import VoteEventRow from '../components/VoteEventRow'

type VoteEvent = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
}

export default function VoteEvents() {
  const [events, setEvents] = useState<VoteEvent[]>([])
  const [title, setTitle] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [minParticipants, setMinParticipants] = useState('')
  const [maxParticipants, setMaxParticipants] = useState('')
  const [durationMinutes, setDurationMinutes] = useState('')
  const [generatedCommand, setGeneratedCommand] = useState('')

  const handleCreate = (ev: React.FormEvent) => {
    ev.preventDefault()
    const command = `/vote-event create title:"${title}" prize_amount:${prizeAmount} currency:${currency} min_participants:${minParticipants} max_participants:${maxParticipants} duration_minutes:${durationMinutes}`
    setGeneratedCommand(command)
    // Optionally add to local state
    const newEvent: VoteEvent = {
      id: Date.now(),
      title,
      prize_amount: parseFloat(prizeAmount),
      currency,
      status: 'pending'
    }
    setEvents(prev => [newEvent, ...prev])
    setTitle('')
    setPrizeAmount('')
    setMinParticipants('')
    setMaxParticipants('')
    setDurationMinutes('')
  }

  return (
    <div className="container">
      <h2>Vote Events</h2>
      <table>
        <thead>
          <tr><th>ID</th><th>Title</th><th>Prize</th><th>Status</th></tr>
        </thead>
        <tbody>
          {events.map(e => (
            <VoteEventRow key={e.id} event={e} />
          ))}
        </tbody>
      </table>

      <h3>Create Vote Event</h3>
      <form onSubmit={handleCreate} className="mini-form">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
        <input value={prizeAmount} onChange={e => setPrizeAmount(e.target.value)} placeholder="Prize Amount" type="number" required />
        <select value={currency} onChange={e => setCurrency(e.target.value)}>
          <option value="SOL">SOL</option>
          <option value="USD">USD</option>
        </select>
        <input value={minParticipants} onChange={e => setMinParticipants(e.target.value)} placeholder="Min Participants" type="number" required />
        <input value={maxParticipants} onChange={e => setMaxParticipants(e.target.value)} placeholder="Max Participants" type="number" required />
        <input value={durationMinutes} onChange={e => setDurationMinutes(e.target.value)} placeholder="Duration (minutes)" type="number" required />
        <button type="submit">Generate Command</button>
      </form>

      {generatedCommand && (
        <div>
          <h4>Copy this command to Discord:</h4>
          <textarea value={generatedCommand} readOnly style={{ width: '100%', height: '50px' }} />
          <button onClick={() => navigator.clipboard.writeText(generatedCommand)}>Copy to Clipboard</button>
        </div>
      )}
    </div>
  )
}
