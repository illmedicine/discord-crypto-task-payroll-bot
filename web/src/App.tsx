import React, { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Tasks from './pages/Tasks'
import VoteEvents from './pages/VoteEvents'
import Contests from './pages/Contests'

const ScheduledPosts = React.lazy(() => import('./pages/ScheduledPosts'))
const Proofs = React.lazy(() => import('./pages/Proofs'))

export default function App() {
  const [page, setPage] = useState<'dashboard' | 'tasks' | 'votes' | 'contests' | 'scheduled' | 'proofs'>('dashboard')

  return (
    <div>
      <header className="app-header">
        <h1>DCB Event Manager</h1>
        <nav style={{ marginTop: 8 }}>
          <button onClick={() => setPage('dashboard')} style={{ marginRight: 8 }}>Dashboard</button>
          <button onClick={() => setPage('tasks')} style={{ marginRight: 8 }}>Tasks</button>
          <button onClick={() => setPage('votes')} style={{ marginRight: 8 }}>Vote Events</button>
          <button onClick={() => setPage('contests')} style={{ marginRight: 8 }}>Contests</button>
          <button onClick={() => setPage('scheduled')} style={{ marginRight: 8 }}>Scheduled Posts</button>
          <button onClick={() => setPage('proofs')}>Proofs</button>
        </nav>
      </header>
      <main>
        {page === 'dashboard' && <Dashboard />}
        {page === 'tasks' && <Tasks />}
        {page === 'votes' && <VoteEvents />}
        {page === 'contests' && <Contests />}
        {page === 'scheduled' && <React.Suspense fallback={<div>Loading...</div>}><ScheduledPosts /></React.Suspense>}
        {page === 'proofs' && <React.Suspense fallback={<div>Loading...</div>}><Proofs /></React.Suspense>}
      </main>
    </div>
  )
}
