CREATE TABLE IF NOT EXISTS miner_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS miner_days (
  date TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  problem TEXT,
  late_noted_at TEXT,
  dropped_at TEXT,
  drop_noted_at TEXT
);
CREATE TABLE IF NOT EXISTS miner_dates (
  date TEXT PRIMARY KEY,
  featured_count INTEGER NOT NULL,
  fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS launches (
  post_id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES miner_dates(date),
  rank INTEGER NOT NULL,
  launch TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS launches_by_date ON launches(date, rank);
CREATE TABLE IF NOT EXISTS judgments (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  date TEXT NOT NULL,
  fit INTEGER NOT NULL CHECK (fit BETWEEN 0 AND 10),
  not_a_product INTEGER NOT NULL,
  reason TEXT NOT NULL,
  rules_applied TEXT NOT NULL,
  run_id TEXT NOT NULL,
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  request_id INTEGER NOT NULL REFERENCES model_requests(id),
  judged_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS corrections (
  id INTEGER PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES launches(post_id),
  date TEXT NOT NULL,
  text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  fit INTEGER CHECK (fit BETWEEN 0 AND 10),
  not_a_product INTEGER,
  reason TEXT,
  rules_applied TEXT,
  run_id TEXT,
  role TEXT,
  provider TEXT,
  model TEXT,
  request_id INTEGER REFERENCES model_requests(id),
  judged_at TEXT,
  unjudged TEXT,
  problem TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS corrections_by_date ON corrections(date, id);
CREATE TABLE IF NOT EXISTS sorts (
  correction TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  outcome TEXT NOT NULL,
  hard_limit TEXT,
  proposal TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  why TEXT,
  rules_applied TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  sorted_at TEXT NOT NULL,
  shown_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  keep_tapped_at TEXT,
  not_kept TEXT,
  kept_at TEXT,
  kept_path TEXT,
  discarded_at TEXT,
  settled_at TEXT
);
CREATE TABLE IF NOT EXISTS day_lines (
  date TEXT PRIMARY KEY,
  featured_count INTEGER NOT NULL,
  line INTEGER NOT NULL,
  floor INTEGER NOT NULL,
  k INTEGER NOT NULL,
  kth INTEGER,
  eligible_count INTEGER NOT NULL,
  drawn_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS day_posts (
  date TEXT PRIMARY KEY,
  title TEXT,
  thread_id TEXT,
  messages_intended INTEGER NOT NULL DEFAULT 0,
  posted_at TEXT
);
CREATE TABLE IF NOT EXISTS day_post_messages (
  date TEXT NOT NULL,
  idx INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (date, idx)
);
CREATE TABLE IF NOT EXISTS miner_retries (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL REFERENCES miner_dates(date),
  post_ids TEXT NOT NULL,
  capped_runs TEXT NOT NULL,
  after_retry INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  tapped_at TEXT,
  ran_at TEXT
);
CREATE INDEX IF NOT EXISTS miner_retries_by_date ON miner_retries(date, id);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  root_domain TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  post_intended INTEGER NOT NULL DEFAULT 0,
  thread_id TEXT,
  withdrawn_at TEXT
);
CREATE TABLE IF NOT EXISTS product_launches (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  added_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dossiers (
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  dossier TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  model TEXT,
  written_at TEXT NOT NULL,
  PRIMARY KEY (product_id, version)
);
CREATE TABLE IF NOT EXISTS dossier_tries (
  post_id TEXT PRIMARY KEY REFERENCES launches(post_id),
  tries INTEGER NOT NULL,
  why TEXT NOT NULL,
  unwritten_at TEXT NOT NULL,
  stop_noted_at TEXT,
  unshown INTEGER NOT NULL DEFAULT 0,
  waiting INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS signup_tags (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  tag TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS walkthroughs (
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  walkthrough TEXT NOT NULL,
  hash TEXT NOT NULL,
  read TEXT NOT NULL,
  cause TEXT NOT NULL,
  run_id TEXT REFERENCES runs(id),
  prepared_at TEXT NOT NULL,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  copy_intended INTEGER NOT NULL DEFAULT 0,
  copy_message_id TEXT,
  shown_at TEXT,
  dismissed_at TEXT,
  lapsed_at TEXT,
  again_tapped_at TEXT,
  end_shown_at TEXT,
  PRIMARY KEY (product_id, version)
);
CREATE TABLE IF NOT EXISTS no_walkthroughs (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  why TEXT NOT NULL,
  found_at TEXT NOT NULL,
  shown_at TEXT
);
CREATE TABLE IF NOT EXISTS walkthrough_corrections (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  redone_version INTEGER,
  withdrawn TEXT,
  unapplied TEXT,
  done_at TEXT,
  of_approved TEXT
);
CREATE TABLE IF NOT EXISTS approvals (
  item TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  version INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  interaction_id TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  PRIMARY KEY (item, version_hash)
);
CREATE TABLE IF NOT EXISTS registrations (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  version INTEGER NOT NULL,
  state TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  status_intended INTEGER NOT NULL DEFAULT 0,
  status_message_id TEXT,
  shown_at TEXT,
  vault_item_intended INTEGER NOT NULL DEFAULT 0,
  vault_item_id TEXT,
  page INTEGER NOT NULL DEFAULT 0,
  fill_runs INTEGER NOT NULL DEFAULT 0,
  sessions_opened INTEGER NOT NULL DEFAULT 0,
  session_id TEXT,
  plain_address INTEGER NOT NULL DEFAULT 0,
  replacement_intended TEXT,
  replaced_items TEXT NOT NULL DEFAULT '[]',
  stop_at TEXT,
  stop_cause TEXT,
  waits_on TEXT,
  button TEXT,
  submitted_at TEXT,
  ended_at TEXT,
  end_note TEXT,
  uncertain TEXT,
  uncertain_told INTEGER NOT NULL DEFAULT 0,
  start_again_from INTEGER,
  shown_key TEXT,
  refill TEXT NOT NULL DEFAULT '[]',
  history TEXT NOT NULL DEFAULT '[]',
  handed_off_at TEXT
);
CREATE TABLE IF NOT EXISTS presses (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  version INTEGER NOT NULL,
  session TEXT NOT NULL,
  page INTEGER NOT NULL,
  button TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  final INTEGER NOT NULL,
  intended_at TEXT NOT NULL,
  done_at TEXT,
  uncertain TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  role TEXT NOT NULL,
  item TEXT NOT NULL,
  started_at TEXT NOT NULL,
  rules_commit TEXT NOT NULL,
  ended_at TEXT,
  outcome TEXT
);
CREATE INDEX IF NOT EXISTS runs_by_item ON runs(role, item);
CREATE TABLE IF NOT EXISTS model_requests (
  id INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  role TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  status INTEGER NOT NULL,
  input_tokens INTEGER,
  cached_tokens INTEGER,
  output_tokens INTEGER,
  dollars REAL NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS model_requests_by_run ON model_requests(run_id);
CREATE TABLE IF NOT EXISTS provider_dropouts (
  id INTEGER PRIMARY KEY,
  provider TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  since TEXT NOT NULL,
  until TEXT NOT NULL,
  reset_known INTEGER NOT NULL,
  noted_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  card_shrunk_at TEXT,
  back_at TEXT,
  back_noted_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS provider_dropouts_open ON provider_dropouts(provider, role) WHERE back_at IS NULL;
CREATE TABLE IF NOT EXISTS raw_inputs (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  item TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS raw_inputs_by_expiry ON raw_inputs(expires_at);
CREATE TABLE IF NOT EXISTS personal_database_writes (
  path TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  message TEXT NOT NULL,
  create_only INTEGER NOT NULL DEFAULT 0,
  queued_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS personal_database_divergences (
  id INTEGER PRIMARY KEY,
  found_at TEXT NOT NULL,
  ours TEXT NOT NULL,
  theirs TEXT NOT NULL,
  branch TEXT NOT NULL,
  branch_pushed_at TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  rejoined_at TEXT
);
CREATE TABLE IF NOT EXISTS ping_write (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  written_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mailbox (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  history_id TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mail (
  message_id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  spam INTEGER NOT NULL,
  bulk INTEGER NOT NULL,
  product_id INTEGER REFERENCES products(id),
  matched_by TEXT,
  counted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS mail_by_product ON mail(product_id, received_at);
CREATE TABLE IF NOT EXISTS mail_dispositions (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES mail(message_id),
  disposition TEXT NOT NULL,
  reason TEXT,
  cause TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_dispositions_by_message ON mail_dispositions(message_id);
CREATE TABLE IF NOT EXISTS mail_alerts (
  message_id TEXT PRIMARY KEY REFERENCES mail(message_id),
  name TEXT NOT NULL,
  sender TEXT NOT NULL,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  ended_at TEXT,
  ended_by TEXT,
  shrunk_at TEXT
);
CREATE TABLE IF NOT EXISTS verifications (
  product_id INTEGER PRIMARY KEY REFERENCES products(id),
  message_id TEXT NOT NULL REFERENCES mail(message_id),
  received_at TEXT NOT NULL,
  spam INTEGER NOT NULL,
  delay_seconds REAL NOT NULL,
  way TEXT NOT NULL,
  why TEXT,
  button TEXT,
  fingerprint TEXT,
  intended_at TEXT,
  done_at TEXT,
  uncertain TEXT,
  uncertain_told INTEGER NOT NULL DEFAULT 0,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  card_done_at TEXT
);
CREATE TABLE IF NOT EXISTS mail_corrections (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES mail(message_id),
  text TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  unapplied TEXT,
  done_at TEXT
);
CREATE INDEX IF NOT EXISTS mail_corrections_by_message ON mail_corrections(message_id);
CREATE TABLE IF NOT EXISTS mail_sorts (
  id INTEGER PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES mail(message_id),
  kind TEXT NOT NULL,
  gist TEXT,
  wants TEXT,
  invite INTEGER,
  rules_applied TEXT NOT NULL DEFAULT '[]',
  run_id TEXT NOT NULL,
  correction_id INTEGER REFERENCES mail_corrections(id),
  sorted_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mail_sorts_by_message ON mail_sorts(message_id);
CREATE TABLE IF NOT EXISTS mail_items (
  message_id TEXT PRIMARY KEY REFERENCES mail(message_id),
  no_reply INTEGER NOT NULL DEFAULT 0,
  post_intended INTEGER NOT NULL DEFAULT 0,
  post_message_id TEXT,
  card_intended INTEGER NOT NULL DEFAULT 0,
  card_message_id TEXT,
  card_posted_at TEXT,
  card_ended_at TEXT,
  card_ended_by TEXT,
  notice_intended INTEGER NOT NULL DEFAULT 0,
  notice_message_id TEXT,
  stopped_why TEXT,
  retry_tapped_at TEXT,
  shown_key TEXT
);
CREATE TABLE IF NOT EXISTS reply_draft_queue (
  message_id TEXT PRIMARY KEY REFERENCES mail(message_id),
  cause TEXT NOT NULL,
  queued_at TEXT NOT NULL
);
