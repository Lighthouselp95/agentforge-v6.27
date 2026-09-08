import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { DATA_DIR } from './constants.js';

const STATE_FILE = join(DATA_DIR, 'state.json');

export interface StateStoreData {
  agentStatuses?: Record<string, any>;
  agentTimestamps?: Record<string, number>;
  teamStates?: Record<string, any>;
  [key: string]: any;
}

export class StateStore {
  // Load state from file
  public loadState(): StateStoreData {
    if (!existsSync(STATE_FILE)) {
      return {};
    }
    try {
      const content = readFileSync(STATE_FILE, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.error(`[StateStore] Failed to load state: ${(error as Error).message}`);
      return {};
    }
  }

  // Save state to file atomically
  public saveState(data: StateStoreData): void {
    try {
      const content = JSON.stringify(data, null, 2);
      writeFileSync(STATE_FILE, content, 'utf-8');
    } catch (error) {
      console.error(`[StateStore] Failed to save state: ${(error as Error).message}`);
    }
  }

  public updateField(key: string, value: any): void {
    const state = this.loadState();
    state[key] = value;
    this.saveState(state);
  }

  public updateAgentStatus(agentId: string, status: any, timestamp: number = Date.now()): void {
    const state = this.loadState();
    if (!state.agentStatuses) state.agentStatuses = {};
    if (!state.agentTimestamps) state.agentTimestamps = {};
    state.agentStatuses[agentId] = status;
    state.agentTimestamps[agentId] = timestamp;
    this.saveState(state);
  }
}

export const stateStore = new StateStore();
