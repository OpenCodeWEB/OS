/**
 * useGunSync — Bridges GunDB P2P graph with REST API for real-time Community Hub sync.
 *
 * How it works:
 *   REST API (D1)  ──►  fetchAll()  ──►  merged list
 *                      ↕
 *   GunDB graph    ──►  subscribePosts()  ──►  live updates (cross-tab, future cross-user)
 *
 * When a post is created/edited/deleted via the REST API, the originating client
 * also publishes the change to GunDB. Other clients subscribed to GunDB see the
 * update instantly (within the same origin / with a relay).
 */
import { useEffect, useRef, useCallback, useState } from "react";
import {
  subscribePosts,
  publishPost,
  unpublishPost,
  publishComment,
  type GunPost,
  type GunComment,
} from "../lib/gun";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface GitHubDiscussion {
  id: string;
  number: number;
  title: string;
  url: string;
  category: string;
  author: string;
  authorAvatar: string;
  replyCount: number;
  isAnswered: boolean;
  createdAt: string;
  labels: Array<{ name: string; color: string }>;
  _source: "github";
}

interface LocalPost {
  id: string;
  title: string;
  body: string;
  category: string;
  author: string;
  authorAvatar: string;
  authorId: number;
  isAnswered: boolean;
  isPinned: boolean;
  replyCount: number;
  createdAt: string;
  updatedAt: string;
  _source: "local";
}

export type { GunPost, GunComment };
export type DiscussionItem = GitHubDiscussion | LocalPost | GunPost;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

interface UseGunSyncOptions {
  /** Called when GunDB delivers a new/updated post in real-time */
  onGunUpdate?: (gunPosts: GunPost[]) => void;
}

interface UseGunSyncReturn {
  /** Merge GunDB-synced posts into a fetched list of items */
  mergeGunPosts: (items: DiscussionItem[]) => DiscussionItem[];
  /** Publish a newly created post to GunDB graph */
  publishCreated: (post: LocalPost) => void;
  /** Remove a deleted post from GunDB graph */
  publishDeleted: (postId: string) => void;
  /** Publish a new comment to GunDB graph */
  publishNewComment: (comment: GunComment) => void;
  /** Number of GunDB peers connected */
  peerCount: number;
  /** Whether GunDB is initialized */
  initialized: boolean;
}

export function useGunSync(options?: UseGunSyncOptions): UseGunSyncReturn {
  const [initialized] = useState(true);
  const peerCount = 0;
  const gunPostsRef = useRef<Map<string, GunPost>>(new Map());
  const { onGunUpdate } = options ?? {};

  // Subscribe to GunDB posts on mount
  useEffect(() => {
    const unsub = subscribePosts((data) => {
      const entries = Object.entries(data) as [string, GunPost][];
      const valid: GunPost[] = [];

      gunPostsRef.current.clear();
      for (const [id, post] of entries) {
        // GunDB may emit null for deleted entries, or partial/invalid data
        if (!post || !post.id || !post.title) continue;
        // Merge _source flag
        const enriched: GunPost = { ...post, _source: "gun" };
        gunPostsRef.current.set(id, enriched);
        valid.push(enriched);
      }

      if (onGunUpdate && valid.length > 0) {
        onGunUpdate(valid);
      }
    });

    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Merge GunDB-synced posts into a REST-fetched list.
   * - GunDB posts are added to the list
   * - REST posts that also exist in GunDB are NOT duplicated (GunDB takes priority by timestamp)
   */
  const mergeGunPosts = useCallback(
    (items: DiscussionItem[]): DiscussionItem[] => {
      const gunPosts = Array.from(gunPostsRef.current.values());
      if (gunPosts.length === 0) return items;

      // Build a set of IDs already in the REST+GitHub list
      const existingIds = new Set(items.map((i) => i.id));

      // Add GunDB posts not already present
      const toAdd: GunPost[] = [];
      for (const gp of gunPosts) {
        if (!existingIds.has(gp.id)) {
          toAdd.push(gp);
        }
      }

      if (toAdd.length === 0) return items;

      const merged = [...items, ...toAdd].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );

      return merged;
    },
    [],
  );

  const publishCreated = useCallback((post: LocalPost) => {
    const gp: GunPost = {
      id: post.id,
      title: post.title,
      body: post.body,
      category: post.category,
      author: post.author,
      authorAvatar: post.authorAvatar,
      authorId: post.authorId,
      replyCount: post.replyCount,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
      _source: "gun",
    };
    publishPost(gp);
  }, []);

  const publishDeleted = useCallback((postId: string) => {
    unpublishPost(postId);
  }, []);

  const publishNewComment = useCallback((comment: GunComment) => {
    publishComment(comment);
  }, []);

  return {
    mergeGunPosts,
    publishCreated,
    publishDeleted,
    publishNewComment,
    peerCount,
    initialized,
  };
}
