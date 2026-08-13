-- OpenCodeABsUI/UX D1 Database Schema

CREATE TABLE IF NOT EXISTS orgs (
  name TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  logo TEXT,
  website TEXT,
  mission TEXT NOT NULL DEFAULT '',
  owner TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  agent_count INTEGER NOT NULL DEFAULT 0,
  storage_used INTEGER NOT NULL DEFAULT 0,
  storage_limit INTEGER NOT NULL DEFAULT 100,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orgs_owner ON orgs(owner);

-- Interactive Community Posts (created/edited from Community Hub)
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,                           -- UUID
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',                 -- Markdown content
  category TEXT NOT NULL DEFAULT 'Discussion',
  author TEXT NOT NULL,                          -- GitHub login
  author_avatar TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL DEFAULT 0,
  is_answered INTEGER NOT NULL DEFAULT 0,
  is_pinned INTEGER NOT NULL DEFAULT 0,
  reply_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author);
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);

-- Comments on Community Posts
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,                           -- UUID
  post_id TEXT NOT NULL,                         -- FK to posts.id
  body TEXT NOT NULL,                            -- Markdown content
  author TEXT NOT NULL,                          -- GitHub login
  author_avatar TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_comments_created ON comments(created_at ASC);
