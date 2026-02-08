import React from 'react'

type Post = { id: number, content: string, scheduled_at: string, status: string }

export default React.memo(function PostRow({ post, style }: { post: Post, style?: React.CSSProperties }) {
  return (
    <div className="table-row" style={style}>
      <div className="col col-id">{post.id}</div>
      <div className="col col-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.content}</div>
      <div className="col col-prize">{post.scheduled_at}</div>
      <div className="col col-status">{post.status}</div>
    </div>
  )
})
