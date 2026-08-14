"""Tests for the OpenCodeWEB OS Autonomous Roadmap Engine.

Covers: autonomous item generation, dedupe, dynamic poll generation + TTL
expiry, 24h leaderboard with ABsUP founder lock, voting, persistence, and
edge sync (dry-run + failure tolerance).
"""

from __future__ import annotations

import json
import time

import pytest

from core.roadmap.roadmap_engine import (
    ChatMessage,
    Leaderboard,
    PollGenerator,
    RoadmapEngine,
    RoadmapItem,
    TopicExtractor,
)

# ---------------------------------------------------------------------------
# Topic extraction
# ---------------------------------------------------------------------------


class TestTopicExtractor:
    def test_extracts_topics_with_counts(self) -> None:
        messages = [
            ChatMessage(author="user1", text="we need vector sync support"),
            ChatMessage(author="user2", text="vector sync is essential"),
            ChatMessage(author="user3", text="vector sync please"),
        ]
        topics = TopicExtractor.extract_topics(messages)
        assert any(t == "vector sync" and c >= 3 for t, c in topics)

    def test_similarity_threshold(self) -> None:
        assert TopicExtractor.similarity("vector sync", "vector sync") == 1.0
        assert TopicExtractor.similarity("vector sync", "vector sync support") > 0.5
        assert TopicExtractor.similarity("vector sync", "dark mode ui") < 0.1

    def test_stopwords_filtered(self) -> None:
        topics = TopicExtractor.extract_topics([ChatMessage(author="a", text="the and of or we want it")])
        assert topics == []


# ---------------------------------------------------------------------------
# Leaderboard
# ---------------------------------------------------------------------------


class TestLeaderboard:
    def test_founder_lock_absup_rank_one(self) -> None:
        lb = Leaderboard(window_hours=24)
        now = time.time()
        # Community member earns more points than ABsUP
        for _ in range(100):
            lb.record_action("community_member", "contribution", now - 100)
        lb.record_action("ABsUP", "chat", now - 50)
        standings = lb.standings(now)
        assert standings[0].user == "ABsUP"
        assert standings[1].user == "ABsUPs"

    def test_rolling_24h_window(self) -> None:
        lb = Leaderboard(window_hours=24)
        now = time.time()
        lb.record_action("user1", "chat", now - 25 * 3600)  # outside window
        lb.record_action("user1", "chat", now - 3600)  # inside window
        standings = lb.standings(now)
        user1 = next(e for e in standings if e.user == "user1")
        assert user1.points == 1  # only the in-window event counts

    def test_point_weights(self) -> None:
        lb = Leaderboard(window_hours=24)
        now = time.time()
        lb.record_action("user1", "chat", now)
        lb.record_action("user1", "vote", now)
        lb.record_action("user1", "contribution", now)
        standings = lb.standings(now)
        user1 = next(e for e in standings if e.user == "user1")
        assert user1.points == 1 + 3 + 10

    def test_rank_of(self) -> None:
        lb = Leaderboard(window_hours=24)
        lb.record_action("ABsUP", "chat")
        assert lb.rank_of("ABsUP") == 1
        assert lb.rank_of("nobody") == 0


# ---------------------------------------------------------------------------
# Poll generator
# ---------------------------------------------------------------------------


class TestPollGenerator:
    def test_spawns_poll_above_threshold(self) -> None:
        gen = PollGenerator(min_mentions=3)
        now = time.time()
        polls = gen.generate([("vector sync", 5)], [], now)
        assert len(polls) == 1
        assert polls[0].topic == "vector sync"
        assert len(polls[0].options) == 3
        assert polls[0].expires_at > now

    def test_no_poll_below_threshold(self) -> None:
        gen = PollGenerator(min_mentions=3)
        assert gen.generate([("tiny topic", 2)], [], time.time()) == []

    def test_no_duplicate_poll_for_open_topic(self) -> None:
        gen = PollGenerator(min_mentions=3)
        now = time.time()
        existing = gen.generate([("vector sync", 5)], [], now)
        more = gen.generate([("vector sync", 7)], existing, now)
        assert more == []

    def test_ttl_expiry(self) -> None:
        gen = PollGenerator(ttl_hours=1)
        now = time.time()
        poll = gen.generate([("topic", 5)], [], now)[0]
        expired = PollGenerator.expire([poll], now + 3601)
        assert expired[0].active is False


# ---------------------------------------------------------------------------
# Roadmap engine
# ---------------------------------------------------------------------------


class TestRoadmapEngine:
    @pytest.fixture()
    def engine(self, tmp_path) -> RoadmapEngine:
        eng = RoadmapEngine(state_dir=tmp_path / "state")
        eng.load()
        return eng

    def test_ingest_creates_item_after_threshold(self, engine: RoadmapEngine) -> None:
        messages = [
            ChatMessage(author="u1", text="we need vector sync support"),
            ChatMessage(author="u2", text="vector sync is essential"),
            ChatMessage(author="u3", text="vector sync please"),
        ]
        result = engine.ingest_chat(messages)
        assert len(result["items"]) == 1
        assert result["items"][0]["status"] == "draft"
        assert result["items"][0]["mentions"] >= 3

    def test_ingest_dedupes_existing_topic(self, engine: RoadmapEngine) -> None:
        msgs_a = [ChatMessage(author=f"u{i}", text="vector sync please") for i in range(3)]
        msgs_b = [ChatMessage(author=f"v{i}", text="vector sync needed") for i in range(3)]
        engine.ingest_chat(msgs_a)
        result = engine.ingest_chat(msgs_b)
        assert len(result["items"]) == 0  # dedupe by similarity

    def test_ingest_spawns_poll(self, engine: RoadmapEngine) -> None:
        messages = [
            ChatMessage(author=f"u{i}", text="let us discuss edge auto scale nodes") for i in range(4)
        ]
        result = engine.ingest_chat(messages)
        assert len(result["polls"]) == 1
        assert result["polls"][0]["active"] is True

    def test_ingest_records_leaderboard_points(self, engine: RoadmapEngine) -> None:
        engine.ingest_chat([ChatMessage(author="Alice", text="hello world feature")])
        assert engine.leaderboard.rank_of("Alice") >= 1

    def test_vote_updates_counts(self, engine: RoadmapEngine) -> None:
        engine.ingest_chat([ChatMessage(author=f"u{i}", text="vote test topic") for i in range(3)])
        poll = engine.polls[0]
        result = engine.vote(poll.id, poll.options[0], "voter1")
        assert result["ok"] is True
        assert poll.votes[poll.options[0]] == 1

    def test_vote_invalid_option(self, engine: RoadmapEngine) -> None:
        engine.ingest_chat([ChatMessage(author=f"u{i}", text="vote test topic") for i in range(3)])
        result = engine.vote(engine.polls[0].id, "bogus", "voter1")
        assert result["ok"] is False

    def test_upvote_item(self, engine: RoadmapEngine) -> None:
        engine.ingest_chat([ChatMessage(author=f"u{i}", text="upvote topic here") for i in range(3)])
        item = engine.items[0]
        result = engine.upvote_item(item.id, "voter1")
        assert result["ok"] is True
        assert item.votes == 1

    def test_persistence_round_trip(self, tmp_path) -> None:
        eng = RoadmapEngine(state_dir=tmp_path / "state")
        eng.load()
        eng.ingest_chat([ChatMessage(author=f"u{i}", text="persist topic now") for i in range(3)])
        eng.save()

        eng2 = RoadmapEngine(state_dir=tmp_path / "state")
        eng2.load()
        assert len(eng2.items) == 1
        # Topic extraction keeps the top bigram phrase ("persist topic");
        # the adjacent fragment "topic now" is dropped by the chain rule.
        assert eng2.items[0].title == "persist topic".title()

    def test_sync_dry_run_returns_ok(self, engine: RoadmapEngine) -> None:
        result = engine.sync(dry_run=True)
        assert result["ok"] is True
        assert result["dry_run"] is True
        assert result["bytes"] > 0

    def test_sync_failure_is_tolerated(self, engine: RoadmapEngine) -> None:
        engine.sync_endpoint = "http://127.0.0.1:1/unreachable"
        result = engine.sync(dry_run=False)
        assert result["ok"] is False
        assert "error" in result

    def test_snapshot_shape(self, engine: RoadmapEngine) -> None:
        snap = engine.snapshot()
        assert set(snap) == {"items", "polls", "leaderboard", "generated_at"}


# ---------------------------------------------------------------------------
# Model round-trips
# ---------------------------------------------------------------------------


class TestModels:
    @pytest.fixture()
    def engine(self, tmp_path) -> RoadmapEngine:
        eng = RoadmapEngine(state_dir=tmp_path / "state")
        eng.load()
        return eng

    def test_roadmap_item_round_trip(self) -> None:
        item = RoadmapItem(title="Test", summary="S", mentions=4)
        restored = RoadmapItem.from_dict(item.to_dict())
        assert restored.id == item.id
        assert restored.mentions == 4

    def test_snapshot_serializable(self, engine: RoadmapEngine) -> None:
        json.dumps(engine.snapshot())  # must not raise
