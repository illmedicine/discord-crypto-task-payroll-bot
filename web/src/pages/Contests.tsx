import React, { useState } from 'react'
import ContestRow from '../components/ContestRow'
import { FixedSizeList as List } from 'react-window'

type Contest = {
  id: number
  title: string
  prize_amount: number
  currency: string
  status: string
}

export default function Contests() {
  const [contests, setContests] = useState<Contest[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prizeAmount, setPrizeAmount] = useState('')
  const [currency, setCurrency] = useState('SOL')
  const [numWinners, setNumWinners] = useState('')
  const [maxEntries, setMaxEntries] = useState('')
  const [durationHours, setDurationHours] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [generatedCommand, setGeneratedCommand] = useState('')

  const handleCreate = (ev: React.FormEvent) => {
    ev.preventDefault()
    const command = `/contest create title:"${title}" description:"${description}" prize_amount:${prizeAmount} currency:${currency} num_winners:${numWinners} max_entries:${maxEntries} duration_hours:${durationHours} reference_url:"${referenceUrl}"`
    setGeneratedCommand(command)
    // Optionally add to local state
    const newContest: Contest = {
      id: Date.now(),
      title,
      prize_amount: parseFloat(prizeAmount),
      currency,
      status: 'pending'
    }
    setContests(prev => [newContest, ...prev])
    setTitle('')
    setDescription('')
    setPrizeAmount('')
    setNumWinners('')
    setMaxEntries('')
    setDurationHours('')
    setReferenceUrl('')
  }

  return (
    <div className="container">
      <h2>Contests</h2>
      <div className="table">
        <div className="table-head">
          <div className="col col-id">ID</div>
          <div className="col col-title">Title</div>
          <div className="col col-prize">Prize</div>
          <div className="col col-status">Status</div>
        </div>
        <List
          height={300}
          itemCount={contests.length}
          itemSize={48}
          width={'100%'}
          itemKey={index => contests[index].id}
        >
          {({ index, style }) => <ContestRow contest={contests[index]} style={style} />}
        </List>
      </div>

      <h3>Create Contest</h3>
      <form onSubmit={handleCreate} className="mini-form">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" required />
        <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description" required />
        <input value={prizeAmount} onChange={e => setPrizeAmount(e.target.value)} placeholder="Prize Amount" type="number" required />
        <select value={currency} onChange={e => setCurrency(e.target.value)}>
          <option value="SOL">SOL</option>
          <option value="USD">USD</option>
        </select>
        <input value={numWinners} onChange={e => setNumWinners(e.target.value)} placeholder="Number of Winners" type="number" required />
        <input value={maxEntries} onChange={e => setMaxEntries(e.target.value)} placeholder="Max Entries" type="number" required />
        <input value={durationHours} onChange={e => setDurationHours(e.target.value)} placeholder="Duration (hours)" type="number" required />
        <input value={referenceUrl} onChange={e => setReferenceUrl(e.target.value)} placeholder="Reference URL" />
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