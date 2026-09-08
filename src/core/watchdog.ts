// src/core/watchdog.ts
/**
 * WatchdogManager - monitors agent activity and sends reminders for stalled work
 * 
 * Features:
 * - Tracks stream activity per agent (resets on each stream:chunk)
 * - If no stream activity for 30s AND task not completed → send reminder
 * - If agent idle for 15s AND task not completed → send reminder
 * 
 * Integrates with:
 * - StreamController (via stream:chunk events to reset activity timer)
 * - AgentStatusManager (via status changes to detect idle)
 * - Storage (to check task completion status)
 */

import { storage } from '../storage.js';
import type { Agent } from '../agents/agent-manager.js';

const getStorage = () => storage;

// Reminder message templates
const REMINDER_MESSAGES = {
  streamInactivity: (agentId: string, taskDescription: string) =>
    `[WATCHDOG] Agent ${agentId} has been idle (no stream activity) for 30s. Current task: "${taskDescription}". Please provide an update or continue working.`,
  
  idleTimeout: (agentId: string, taskDescription: string) =>
    `[WATCHDOG] Agent ${agentId} has been idle for 15s. Current task: "${taskDescription}". Please provide an update or continue working.`
};

export class WatchdogManager {
  private streamActivityTimers = new Map<string, NodeJS.Timeout>();
  private idleTimers = new Map<string, NodeJS.Timeout>();
  private lastStreamActivity = new Map<string, number>(); // timestamp of last stream chunk
  private checkInterval: NodeJS.Timeout | null = null;
  private broadcastFn: (type: string, data: any) => void = () => {};
  private storageRef: any = null;

  constructor(broadcastFn?: (type: string, data: any) => void) {
    if (broadcastFn) {
      this.broadcastFn = broadcastFn;
    }
    // Start periodic check every 5s to evaluate conditions
    this.checkInterval = setInterval(() => this.checkAllAgents(), 5000);
  }

  public setBroadcast(fn: (type: string, data: any) => void): void {
    this.broadcastFn = fn;
  }

  public setStorage(storage: any): void {
    this.storageRef = storage;
  }

  /**
   * Call when stream activity occurs (resets 30s stream inactivity timer)
   */
  public onStreamActivity(agentId: string): void {
    this.lastStreamActivity.set(agentId, Date.now());
    
    // Clear existing stream inactivity timer
    const streamTimer = this.streamActivityTimers.get(agentId);
    if (streamTimer) {
      clearTimeout(streamTimer);
      this.streamActivityTimers.delete(agentId);
    }
  }

  /**
   * Call when agent becomes idle (starts 15s idle timer)
   */
  public onAgentIdle(agentId: string): void {
    // Clear existing idle timer
    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }

    // Start new 15s idle timer
    const timeout = setTimeout(() => {
      this.handleIdleTimeout(agentId);
    }, 15000); // 15s
    
    this.idleTimers.set(agentId, timeout);
  }

  /**
   * Call when agent becomes active (stops idle timer)
   */
  public onAgentActive(agentId: string): void {
    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }
  }

  /**
   * Call when task is completed (stops all timers for agent)
   */
  public onTaskCompleted(agentId: string): void {
    this.clearAgentTimers(agentId);
  }

  /**
   * Clear all timers for an agent
   */
  private clearAgentTimers(agentId: string): void {
    const streamTimer = this.streamActivityTimers.get(agentId);
    if (streamTimer) {
      clearTimeout(streamTimer);
      this.streamActivityTimers.delete(agentId);
    }

    const idleTimer = this.idleTimers.get(agentId);
    if (idleTimer) {
      clearTimeout(idleTimer);
      this.idleTimers.delete(agentId);
    }

    this.lastStreamActivity.delete(agentId);
  }

  /**
   * Check all agents for reminder conditions
   */
  private async checkAllAgents(): Promise<void> {
    const agents = storage.getAllAgents() || [];
    
    for (const agent of agents) {
      // Skip orchestrator and stopped/error agents
      if (agent.type === 'orchestrator' || 
          agent.status === 'stopped' || 
          agent.status === 'error') {
        continue;
      }

      // Check if agent has any incomplete tasks
      const hasIncompleteTasks = this.hasIncompleteTasks(agent);
      if (!hasIncompleteTasks) {
        // Clear timers if all tasks are completed
        this.clearAgentTimers(agent.id);
        continue;
      }

      // Check stream inactivity (30s)
      await this.checkStreamInactivity(agent);
      
      // Note: Idle timeout is handled by onAgentIdle -> setTimeout -> handleIdleTimeout
    }
  }

  /**
   * Check if agent has any incomplete tasks
   */
  private hasIncompleteTasks(agent: Agent): boolean {
    // Check agent.task (single task)
    if (agent.task && typeof agent.task === 'string' && agent.task.trim().length > 0) {
      return true;
    }

    // Check agent.tasks (array of tasks)
    if (Array.isArray(agent.tasks) && agent.tasks.length > 0) {
      return agent.tasks.some(task => 
        task.status !== 'completed' && 
        task.task && 
        typeof task.task === 'string' && 
        task.task.trim().length > 0
      );
    }

    return false;
  }

  /**
   * Check stream inactivity for an agent (30s threshold)
   */
  private async checkStreamInactivity(agent: Agent): Promise<void> {
    const lastActivity = this.lastStreamActivity.get(agent.id);
    if (!lastActivity) return;

    const inactiveFor = Date.now() - lastActivity;
    if (inactiveFor >= 30000) { // 30s
      // Check if we already sent a reminder recently (avoid spam)
      const lastReminder = this.getLastReminderTime(agent.id, 'stream');
      if (!lastReminder || (Date.now() - lastReminder) > 60000) { // 1min cooldown
        await this.sendReminder(agent, 'stream');
        this.setLastReminderTime(agent.id, 'stream');
      }
      
      // Restart timer after sending reminder
      this.lastStreamActivity.set(agent.id, Date.now());
    }
  }

  /**
   * Handle idle timeout (15s threshold)
   */
  private async handleIdleTimeout(agentId: string): Promise<void> {
    const agent = storage.getAgent(agentId);
    if (!agent) return;

    // Skip if not worker or if in error/stopped state
    if (agent.type === 'orchestrator' || 
        agent.status === 'stopped' || 
        agent.status === 'error') {
      return;
    }

    // Check if agent has any incomplete tasks
    if (!this.hasIncompleteTasks(agent)) {
      return; // All tasks completed, no reminder needed
    }

    // Check if we already sent a reminder recently (avoid spam)
    const lastReminder = this.getLastReminderTime(agentId, 'idle');
    if (!lastReminder || (Date.now() - lastReminder) > 60000) { // 1min cooldown
      await this.sendReminder(agent, 'idle');
      this.setLastReminderTime(agentId, 'idle');
    }
  }

  /**
   * Send reminder to agent
   */
  private async sendReminder(agent: Agent, type: 'stream' | 'idle'): Promise<void> {
    try {
      // Get the agent's current task description
      let taskDescription = 'No active task';
      
      if (agent.task && typeof agent.task === 'string' && agent.task.trim().length > 0) {
        taskDescription = agent.task;
      } else if (Array.isArray(agent.tasks) && agent.tasks.length > 0) {
        // Find first incomplete task
        const incompleteTask = agent.tasks.find(task => 
          task.status !== 'completed' && 
          task.task && 
          typeof task.task === 'string' && 
          task.task.trim().length > 0
        );
        if (incompleteTask) {
          taskDescription = incompleteTask.task;
        }
      }

      // Select appropriate reminder message
      const messageTemplate = REMINDER_MESSAGES[
        type === 'stream' ? 'streamInactivity' : 'idleTimeout'
      ];
      
      const reminderMessage = messageTemplate(agent.id, taskDescription);

      // Send task_update reminder via AgentStatusManager
      const { AgentStatusManager } = await import('./state-machine.js');
      const statusManager = new AgentStatusManager();
      
      const taskId = `watchdog-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      await statusManager.dispatchTaskUpdate(
        agent.id,
        'working', // status
        taskId,
        `<task_update agent="${agent.id}" task="${reminderMessage}" status="working" />`
      );
 
      // Also broadcast as system message for visibility
      this.broadcastFn('system:watchdog', {
        agentId: agent.id,
        teamId: agent.teamId,
        type,
        message: reminderMessage,
        timestamp: Date.now()
      });

      console.log(`[Watchdog] Sent ${type} reminder to agent ${agent.id}`);
    } catch (error) {
      console.error(`[Watchdog] Failed to send reminder to agent ${agent.id}:`, error);
    }
  }

  private lastReminders = new Map<string, number>();

  /**
   * Get last reminder time for agent and type
   */
  private getLastReminderTime(agentId: string, type: 'stream' | 'idle'): number | null {
    const key = `${agentId}:${type}`;
    return this.lastReminders.get(key) || null;
  }

  /**
   * Set last reminder time for agent and type
   */
  private setLastReminderTime(agentId: string, type: 'stream' | 'idle'): void {
    const key = `${agentId}:${type}`;
    this.lastReminders.set(key, Date.now());
  }

  /**
   * Cleanup when shutting down
   */
  public destroy(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    // Clear all timers
    for (const timer of this.streamActivityTimers.values()) {
      clearTimeout(timer);
    }
    this.streamActivityTimers.clear();

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    this.lastStreamActivity.clear();
  }
}

// Export a singleton instance
export const watchdogManager = new WatchdogManager();