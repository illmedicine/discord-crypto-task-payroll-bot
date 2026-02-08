import React, { useState } from 'react'
import VoteEventRow from '../components/VoteEventRow'
import { FixedSizeList as List } from 'react-window'

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
      <div className="table">
        <div className="table-head">
          <div className="col col-id">ID</div>
          <div className="col col-title">Title</div>
          <div className="col col-prize">Prize</div>
          <div className="col col-status">Status</div>
        </div>
        <List
          height={300}
          itemCount={events.length}
          itemSize={48}
          width={'100%'}
          itemKey={index => events[index].id}
        >
          {({ index, style }) => <VoteEventRow event={events[index]} style={style} />}
        </List>
      </div>

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
