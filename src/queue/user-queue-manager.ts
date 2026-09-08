import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from '../storage/constants.js';

const QUEUE_FILE = join(DATA_DIR, 'user-queues.json');

export interface QueueEntry {
  userId: string;
  message: string;
  timestamp: number;
}

export class UserQueueManager {
  public loadQueues(): Record<string, QueueEntry[]> {
    if (!existsSync(QUEUE_FILE)) {
      return {};
    }
    try {
      const content = readFileSync(QUEUE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      console.error(`[UserQueueManager] Failed to load queues: ${(error as Error).message}`);
      return {};
    }
  }

  private saveQueues(queues: Record<string, QueueEntry[]>): void {
    try {
      writeFileSync(QUEUE_FILE, JSON.stringify(queues, null, 2), 'utf-8');
    } catch (error) {
      console.error(`[UserQueueManager] Failed to save queues: ${(error as Error).message}`);
    }
  }

  /**
   * Unconditional assign: always write queues[userId] so persist/proxy traps fire.
   * Fixes the duplicate-queue bug where `if (!q) q = []` never assigned.
   */
  public enqueue(userId: string, message: string): void {
    const queues = this.loadQueues();
    const next = Array.isArray(queues[userId]) ? queues[userId].slice() : [];
    next.push({ userId, message, timestamp: Date.now() });
    queues[userId] = next;
    this.saveQueues(queues);
  }

  public dequeue(userId: string): QueueEntry | null {
    const queues = this.loadQueues();
    const current = queues[userId];
    if (!Array.isArray(current) || current.length === 0) {
      return null;
    }
    const entry = current.shift();
    if (!entry) return null;
    if (current.length === 0) {
      delete queues[userId];
    } else {
      queues[userId] = current;
    }
    this.saveQueues(queues);
    return entry;
  }

  public getQueue(userId: string): QueueEntry[] {
    const q = this.loadQueues()[userId];
    return Array.isArray(q) ? q : [];
  }
}

export const userQueueManager = new UserQueueManager();
