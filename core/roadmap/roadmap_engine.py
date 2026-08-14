"""OpenCodeWEB OS — Autonomous Roadmap Engine.

AiA-driven autonomous roadmap item lifecycle, dynamic poll generator, and
24-hour leaderboard manager. Powers https://pocwu.pages.dev/roadmap and
syncs state through the Cloudflare edge (opencodeweb.xup.workers.dev).

Zero-Constraint Policy: no token limits, no hard timeouts, no artificial
quotas, no throttling. Platform caps are respected via single-key writes
and graceful degradation (proven pattern from the AiA connector).

Maintainers: ABsUP & ABsUPs
"""

from __future__ import annotations

import json
import logging
import os
import platform
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

_logger = logging.getLogger("opencodeweb.roadmap")

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------

EDGE_GATEWAY: str = os.environ.get("OPENCODE_GATEWAY", "https://opencodeweb.xup.workers.dev")
SYNC_ENDPOINT: str = os.environ.get("OPENCODE_ROADMAP_SYNC", f"{EDGE_GATEWAY}/api/roadmap/sync")
SYNC_TOKEN: str = os.environ.get("OPENCODE_ROADMAP_TOKEN", "")

MIN_MENTIONS: int = int(os.environ.get("ROADMAP_MIN_MENTIONS", "3"))
DEDUPE_THRESHOLD: float = float(os.environ.get("ROADMAP_DEDUPE_THRESHOLD", "0.55"))
POLL_TTL_HOURS: int = int(os.environ.get("ROADMAP_POLL_TTL_HOURS", "48"))
LEADERBOARD_WINDOW_HOURS: int = int(os.environ.get("ROADMAP_LEADERBOARD_HOURS", "24"))
MAX_TOPICS_PER_INGEST: int = int(os.environ.get("ROADMAP_MAX_TOPICS", "8"))

# Founder lock: ABsUP is permanently Rank #1; ABsUPs (co-founder) #2.
FOUNDER_LOCK: tuple[str, ...] = tuple(
    os.environ.get("ROADMAP_FOUNDER_LOCK", "ABsUP,ABsUPs").split(",")
)

# Contribution point weights (24h rolling window)
POINTS: dict[str, int] = {
    "chat": 1,
    "upvote": 2,
    "vote": 3,
    "item": 5,
    "contribution": 10,
}

# ---------------------------------------------------------------------------
# Default state directory: /opt/opencode/core/roadmap/state (D: on Windows)
# ---------------------------------------------------------------------------


def _default_state_dir() -> Path:
    override = os.environ.get("OPENCODE_STATE_DIR")
    if override:
        return Path(override)
    if platform.system() == "Windows":
        return Path("D:/opt/opencode/core/roadmap/state")
    return Path("/opt/opencode/core/roadmap/state")


STATE_DIR: Path = _default_state_dir()

STOPWORDS: frozenset[str] = frozenset(
    """a an and are as at be but by for from has have how i if in is it its
    not of on or our so that the their them there they this to was we what
    when where which who will with would you your please can could should
    just like get make want need also really let us discuss think idea
    talk things support needed essential here""".split()
)

# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------


@dataclass
class ChatMessage:
    """A single chat/feedback message from the web portal."""

    author: str
    text: str
    ts: float = field(default_factory=time.time)
    id: str = field(default_factory=lambda: f"msg-{int(time.time() * 1000)}")

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class RoadmapItem:
    """A roadmap item with full lifecycle state."""

    title: str
    summary: str = ""
    status: str = "draft"  # draft | proposed | in_progress | done | shipped | archived
    score: int = 0
    mentions: int = 1
    source: str = "autonomous"
    tags: list[str] = field(default_factory=list)
    id: str = field(default_factory=lambda: f"item-{int(time.time() * 1000)}")
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    votes: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RoadmapItem:
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class Poll:
    """A live dynamic poll spawned from chat topic clustering."""

    topic: str
    options: list[str]
    id: str = field(default_factory=lambda: f"poll-{int(time.time() * 1000)}")
    created_at: float = field(default_factory=time.time)
    expires_at: float = field(default_factory=lambda: time.time() + POLL_TTL_HOURS * 3600)
    votes: dict[str, int] = field(default_factory=dict)
    active: bool = True

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Poll:
        known = {f.name for f in cls.__dataclass_fields__.values()}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class LeaderboardEntry:
    """A contributor's rolling 24h point total."""

    user: str
    points: int = 0
    actions: dict[str, int] = field(default_factory=dict)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Topic extraction (AiA insight layer)
# ---------------------------------------------------------------------------


class TopicExtractor:
    """Extracts and scores topics from chat streams.

    Uses simple TF scoring with stopword filtering and bigram capture.
    No external embeddings required (Zero-Constraint: works offline).
    """

    _TOKEN_RE = re.compile(r"[a-z][a-z0-9_\-]{2,}")

    @classmethod
    def tokenize(cls, text: str) -> list[str]:
        return [
            t
            for t in cls._TOKEN_RE.findall(text.lower())
            if t not in STOPWORDS and len(t) > 2
        ]

    @classmethod
    def extract_topics(cls, messages: list[ChatMessage], limit: int = MAX_TOPICS_PER_INGEST) -> list[tuple[str, int]]:
        """Return (topic, mention_count) pairs sorted by score.

        Ranking: count desc, then specificity (multi-token topics first).
        A candidate is dropped if it SHARES a token with an already-kept,
        higher-ranked topic — this prevents "vector sync" + "sync needed"
        from becoming near-duplicate items/polls.
        """
        counter: Counter[str] = Counter()
        for msg in messages:
            tokens = cls.tokenize(msg.text)
            counter.update(tokens)
            # Bigrams add signal for feature-style topics ("sync node", "kv quota")
            for pair in zip(tokens, tokens[1:], strict=False):
                counter.update([f"{pair[0]} {pair[1]}"])

        ranked = counter.most_common()
        # Stable, specificity-first: same count -> more tokens ranked earlier.
        ranked.sort(key=lambda item: (-item[1], -len(item[0].split())))

        kept: list[tuple[str, int]] = []
        # Chain-drop: a candidate is a fragment of an already-processed
        # contiguous phrase when it is token-adjacent to ANY processed topic
        # (kept or dropped). Without this, "edge auto scale nodes" would
        # spawn two polls: "edge auto" AND "scale nodes" (bridge "auto scale"
        # gets dropped for overlap, but "scale nodes" is disjoint yet part of
        # the same run). Transitive adjacency closes that gap.
        processed_edges: set[tuple[str, str]] = set()
        for topic, count in ranked:
            topic_tokens = list(cls.tokenize(topic))
            if not topic_tokens:
                continue
            token_set = set(topic_tokens)
            first, last = topic_tokens[0], topic_tokens[-1]
            overlaps = any(token_set & set(cls.tokenize(kept_topic)) for kept_topic, _ in kept)
            if overlaps:
                processed_edges.add((first, last))
                continue
            adjacent = any(
                first == prev_last or last == prev_first
                for prev_first, prev_last in processed_edges
            )
            if adjacent:
                processed_edges.add((first, last))
                continue
            kept.append((topic, count))
            processed_edges.add((first, last))
            if len(kept) >= limit:
                break
        return kept

    @classmethod
    def similarity(cls, a: str, b: str) -> float:
        """Token Jaccard similarity for dedupe (0..1)."""
        ta, tb = set(cls.tokenize(a)), set(cls.tokenize(b))
        if not ta or not tb:
            return 0.0
        return len(ta & tb) / len(ta | tb)


# ---------------------------------------------------------------------------
# Leaderboard (24h rolling, founder lock)
# ---------------------------------------------------------------------------


class Leaderboard:
    """Calculates 24-hour contribution points with ABsUP locked at Rank #1.

    Founder lock semantics: ABsUP is permanently #1. ABsUPs (co-founder) is
    locked at #2. All other users compete for ranks 3+.
    """

    def __init__(self, window_hours: int = LEADERBOARD_WINDOW_HOURS) -> None:
        self.window_seconds = window_hours * 3600
        self._entries: dict[str, LeaderboardEntry] = {}
        self._events: list[dict[str, Any]] = []  # {user, action, ts}

    # -- event ingestion -----------------------------------------------------

    def record_action(self, user: str, action: str, ts: float | None = None) -> None:
        if action not in POINTS:
            _logger.warning("unknown action type %r ignored", action)
            return
        self._events.append({"user": user, "action": action, "ts": ts or time.time()})

    # -- computation ---------------------------------------------------------

    def _prune(self, now: float) -> None:
        cutoff = now - self.window_seconds
        self._events = [e for e in self._events if e["ts"] >= cutoff]

    def standings(self, now: float | None = None) -> list[LeaderboardEntry]:
        now = now or time.time()
        self._prune(now)
        points: dict[str, Counter[str]] = {}
        for event in self._events:
            bucket = points.setdefault(event["user"], Counter())
            bucket[event["action"]] += 1

        entries: list[LeaderboardEntry] = []
        for user, actions in points.items():
            total = sum(POINTS[a] * n for a, n in actions.items())
            entries.append(LeaderboardEntry(user=user, points=total, actions=dict(actions), updated_at=now))
        entries.sort(key=lambda e: (-e.points, e.user.lower()))

        # Founder lock re-rank: ABsUP #1, ABsUPs #2, everyone else follows.
        # Founders are ALWAYS present (zero-point entries if no events),
        # satisfying the permanent founder-lock requirement.
        locked = [e for e in entries if e.user in FOUNDER_LOCK]
        unlocked = [e for e in entries if e.user not in FOUNDER_LOCK]
        locked_sorted = sorted(locked, key=lambda e: FOUNDER_LOCK.index(e.user))
        for founder in FOUNDER_LOCK:
            if not any(e.user == founder for e in locked_sorted):
                locked_sorted.append(LeaderboardEntry(user=founder, points=0, updated_at=now))
        return locked_sorted + unlocked

    def rank_of(self, user: str, now: float | None = None) -> int:
        for idx, entry in enumerate(self.standings(now)):
            if entry.user == user:
                return idx + 1
        return 0

    # -- persistence ----------------------------------------------------------

    def to_dict(self) -> dict[str, Any]:
        return {"events": self._events, "entries": [e.to_dict() for e in self._entries.values()]}

    def to_snapshot(self, now: float | None = None) -> dict[str, Any]:
        return {
            "generated_at": now or time.time(),
            "window_hours": LEADERBOARD_WINDOW_HOURS,
            "standings": [e.to_dict() for e in self.standings(now)],
        }

    def load_dict(self, data: dict[str, Any]) -> None:
        self._events = data.get("events", [])
        entries = data.get("entries", {})
        if isinstance(entries, dict):
            self._entries = {k: LeaderboardEntry(**v) for k, v in entries.items()}
        elif isinstance(entries, list):
            self._entries = {e.get("user", str(i)): LeaderboardEntry(**e) for i, e in enumerate(entries)}
        else:
            self._entries = {}


# ---------------------------------------------------------------------------
# Poll generator
# ---------------------------------------------------------------------------


class PollGenerator:
    """Spawns structured polls from active chat discussions."""

    DEFAULT_OPTIONS = ["Yes — prioritize it", "Neutral / maybe later", "No — not needed"]

    def __init__(self, ttl_hours: int = POLL_TTL_HOURS, min_mentions: int = MIN_MENTIONS) -> None:
        self.ttl_hours = ttl_hours
        self.min_mentions = min_mentions

    def generate(
        self,
        topics: list[tuple[str, int]],
        existing_polls: list[Poll],
        now: float | None = None,
    ) -> list[Poll]:
        now = now or time.time()
        open_topics = {p.topic.lower() for p in existing_polls if p.active and p.expires_at > now}
        spawned: list[Poll] = []
        for topic, count in topics:
            if count < self.min_mentions:
                continue
            if topic.lower() in open_topics:
                continue
            poll = Poll(topic=topic, options=list(self.DEFAULT_OPTIONS))
            poll.expires_at = now + self.ttl_hours * 3600
            spawned.append(poll)
            open_topics.add(topic.lower())
        return spawned

    @classmethod
    def expire(cls, polls: list[Poll], now: float | None = None) -> list[Poll]:
        now = now or time.time()
        for poll in polls:
            if poll.expires_at <= now:
                poll.active = False
        return polls


# ---------------------------------------------------------------------------
# Autonomous roadmap engine
# ---------------------------------------------------------------------------


class RoadmapEngine:
    """Orchestrates the full autonomous roadmap lifecycle.

    ingest_chat() -> topics -> new items + polls -> leaderboard events ->
    persistence (JSON) -> edge sync (Cloudflare gateway).
    """

    def __init__(
        self,
        state_dir: Path = STATE_DIR,
        sync_endpoint: str = SYNC_ENDPOINT,
        sync_token: str = SYNC_TOKEN,
    ) -> None:
        self.state_dir = Path(state_dir)
        self.sync_endpoint = sync_endpoint
        self.sync_token = sync_token
        self.items: list[RoadmapItem] = []
        self.polls: list[Poll] = []
        self.leaderboard = Leaderboard()
        self.extractor = TopicExtractor()
        self.poll_generator = PollGenerator()
        self._dirty = False

    # -- persistence ----------------------------------------------------------

    def load(self) -> None:
        try:
            state = json.loads((self.state_dir / "state.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            state = {}
        self.items = [RoadmapItem.from_dict(d) for d in state.get("items", [])]
        self.polls = [Poll.from_dict(d) for d in state.get("polls", [])]
        self.leaderboard.load_dict(state.get("leaderboard", {}))
        self._dirty = False

    def save(self) -> Path:
        self.state_dir.mkdir(parents=True, exist_ok=True)
        path = self.state_dir / "state.json"
        payload = {
            "items": [i.to_dict() for i in self.items],
            "polls": [p.to_dict() for p in self.polls],
            "leaderboard": self.leaderboard.to_dict(),
            "saved_at": time.time(),
        }
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        tmp.replace(path)  # atomic on POSIX and Windows (same volume)
        self._dirty = False
        return path

    # -- autonomous item generation -------------------------------------------

    def generate_items(self, topics: list[tuple[str, int]], now: float | None = None) -> list[RoadmapItem]:
        """Create draft roadmap items for sufficiently-mentioned new topics."""
        now = now or time.time()
        created: list[RoadmapItem] = []
        existing_titles = [item.title for item in self.items if item.status != "archived"]

        for topic, count in topics:
            if count < MIN_MENTIONS:
                continue
            if any(self.extractor.similarity(topic, t) >= DEDUPE_THRESHOLD for t in existing_titles):
                continue
            item = RoadmapItem(
                title=topic.title(),
                summary=self._summarize(topic, count),
                mentions=count,
                score=count * 10,
                source="autonomous",
                tags=["community", "ai-generated"],
                created_at=now,
                updated_at=now,
            )
            self.items.append(item)
            existing_titles.append(item.title)
            created.append(item)
            self._dirty = True
        return created

    @staticmethod
    def _summarize(topic: str, count: int) -> str:
        return (
            f"Autonomously generated from community discussion "
            f"({count} mentions in the last chat window). AiA insight: "
            f"users are asking for '{topic}'. Proposed for community vote."
        )

    # -- chat ingestion ---------------------------------------------------------

    def ingest_chat(self, messages: list[ChatMessage] | list[dict[str, Any]]) -> dict[str, Any]:
        """Ingest chat/feedback, extract topics, spawn items + polls."""
        now = time.time()
        parsed = [
            ChatMessage(**m) if isinstance(m, dict) else m
            for m in messages
        ]
        if not parsed:
            return {"items": [], "polls": [], "topics": []}

        # Leaderboard: every chat message earns a point
        for msg in parsed:
            self.leaderboard.record_action(msg.author, "chat", msg.ts)

        topics = self.extractor.extract_topics(parsed)
        new_items = self.generate_items(topics, now)
        new_polls = self.poll_generator.generate(topics, self.polls, now)
        if new_polls:
            self.polls.extend(new_polls)
            self._dirty = True

        self.save()
        return {
            "topics": [{"topic": t, "mentions": c} for t, c in topics],
            "items": [i.to_dict() for i in new_items],
            "polls": [p.to_dict() for p in new_polls],
        }

    # -- voting ------------------------------------------------------------------

    def vote(self, poll_id: str, option: str, user: str) -> dict[str, Any]:
        poll = next((p for p in self.polls if p.id == poll_id and p.active), None)
        if poll is None:
            return {"ok": False, "error": "poll not found or expired"}
        if option not in poll.options:
            return {"ok": False, "error": "invalid option"}
        poll.votes[option] = poll.votes.get(option, 0) + 1
        self.leaderboard.record_action(user, "vote")
        self.save()
        return {"ok": True, "poll_id": poll.id, "votes": dict(poll.votes)}

    def upvote_item(self, item_id: str, user: str) -> dict[str, Any]:
        item = next((i for i in self.items if i.id == item_id), None)
        if item is None:
            return {"ok": False, "error": "item not found"}
        item.votes += 1
        item.score += 1
        item.updated_at = time.time()
        self.leaderboard.record_action(user, "upvote")
        self.save()
        return {"ok": True, "item_id": item.id, "votes": item.votes}

    # -- edge sync ------------------------------------------------------------------

    def sync(self, dry_run: bool = True) -> dict[str, Any]:
        """Push full roadmap state to the Cloudflare edge gateway."""
        payload = json.dumps(
            {"roadmap": self.snapshot(), "source": "aia-roadmap-engine"}
        ).encode("utf-8")
        headers = {"Content-Type": "application/json", "User-Agent": "OpenCodeWEB-Roadmap/1.0"}
        if self.sync_token:
            headers["Authorization"] = f"Bearer {self.sync_token}"

        if dry_run:
            _logger.info("dry-run sync (%d bytes) to %s", len(payload), self.sync_endpoint)
            return {"ok": True, "dry_run": True, "bytes": len(payload)}

        request = urllib.request.Request(self.sync_endpoint, data=payload, method="POST", headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read().decode("utf-8", errors="replace")
            _logger.info("roadmap synced to %s: %s", self.sync_endpoint, body[:200])
            return {"ok": True, "response": body[:500]}
        except (urllib.error.URLError, OSError, TimeoutError) as exc:
            _logger.warning("roadmap sync failed (state kept locally): %s", exc)
            return {"ok": False, "error": str(exc)}

    # -- views -----------------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        return {
            "items": [i.to_dict() for i in self.items if i.status != "archived"],
            "polls": [p.to_dict() for p in self.polls if p.active],
            "leaderboard": self.leaderboard.to_snapshot(),
            "generated_at": time.time(),
        }

    def leaderboard_view(self) -> list[dict[str, Any]]:
        return [e.to_dict() for e in self.leaderboard.standings()]

    @property
    def dirty(self) -> bool:
        return self._dirty
